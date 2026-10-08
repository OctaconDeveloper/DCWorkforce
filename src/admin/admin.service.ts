import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { Admin } from '@prisma/client';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultAdmin();
  }

  private async seedDefaultAdmin() {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL', 'admin@church.com');
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD', 'admin123');
    const adminPhone = this.configService.get<string>('ADMIN_PHONE', '2348012345678');

    const existingAdmin = await this.prisma.admin.findUnique({
      where: { email: adminEmail.toLowerCase().trim() },
    });

    if (!existingAdmin) {
      const hashedPassword = await this.authService.hashPassword(adminPassword);
      await this.prisma.admin.create({
        data: {
          email: adminEmail.toLowerCase().trim(),
          password: hashedPassword,
          name: 'Head Church Admin',
          phone: adminPhone,
        },
      });
      this.logger.log(`Initialized default admin: ${adminEmail}`);
    }
  }

  async login(loginDto: LoginDto) {
    const email = loginDto.email.toLowerCase().trim();
    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await this.authService.comparePasswords(
      loginDto.password,
      admin.password,
    );

    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokenData = await this.authService.generateToken({
      id: admin.id,
      email: admin.email,
      name: admin.name,
    });

    return {
      message: 'Login successful',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        phone: admin.phone,
      },
      ...tokenData,
    };
  }

  async createAdmin(createAdminDto: CreateAdminDto) {
    const email = createAdminDto.email.toLowerCase().trim();
    const existing = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('Admin with this email already exists');
    }

    const hashedPassword = await this.authService.hashPassword(
      createAdminDto.password,
    );

    const admin = await this.prisma.admin.create({
      data: {
        email,
        password: hashedPassword,
        name: createAdminDto.name || 'Church Admin',
        phone: createAdminDto.phone,
      },
    });

    const { password, ...result } = admin;
    return result;
  }

  async findByPhone(phone: string): Promise<Admin | null> {
    const cleanPhone = phone.replace(/\D/g, '');
    return this.prisma.admin.findFirst({ where: { phone: cleanPhone } });
  }

  async findAll(): Promise<Omit<Admin, 'password'>[]> {
    const admins = await this.prisma.admin.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return admins.map(({ password, ...admin }) => admin);
  }

  async getStats() {
    const today = new Date().toISOString().split('T')[0];

    const [totalWorkers, activeWorkers, upcomingSchedules, activeAnnouncements, deptGroups] =
      await Promise.all([
        this.prisma.worker.count(),
        this.prisma.worker.count({ where: { isActive: true } }),
        this.prisma.schedule.count({
          where: {
            date: {
              gte: today,
            },
          },
        }),
        this.prisma.announcement.count(),
        this.prisma.worker.groupBy({
          by: ['department'],
          _count: {
            id: true,
          },
        }),
      ]);

    const workersByDepartment: Record<string, number> = {};
    for (const group of deptGroups) {
      if (group.department) {
        workersByDepartment[group.department] = group._count.id;
      }
    }

    return {
      totalWorkers,
      activeWorkers,
      upcomingSchedules,
      activeAnnouncements,
      workersByDepartment,
    };
  }
}
