import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
  QueryAnnouncementDto,
} from './dto/create-announcement.dto';
import { Announcement, Worker } from '@prisma/client';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createDto: CreateAnnouncementDto,
    creator?: { worker?: Worker | null; isAdmin?: boolean; name?: string },
  ): Promise<Announcement> {
    let scope = (createDto.targetScope || 'ALL').toUpperCase();
    let department = createDto.targetDepartment ? createDto.targetDepartment.toLowerCase() : null;
    let unit = createDto.targetUnit || null;
    let creatorRole = 'MEMBER';
    let createdBy = creator?.name || creator?.worker?.fullName || 'Church Admin';

    if (creator?.isAdmin) {
      creatorRole = 'ADMIN';
      if (!createDto.targetScope) {
        scope = department ? (unit ? 'UNIT' : 'DEPARTMENT') : 'ALL';
      }
    } else if (creator?.worker?.isHOD) {
      creatorRole = 'HOD';
      scope = 'DEPARTMENT';
      department = creator.worker.department.toLowerCase();
      unit = null;
    } else if (creator?.worker?.isUnitHead) {
      creatorRole = 'UNIT_HEAD';
      scope = 'UNIT';
      department = creator.worker.department.toLowerCase();
      unit = creator.worker.unit || null;
    }

    return this.prisma.announcement.create({
      data: {
        title: createDto.title,
        message: createDto.message,
        targetScope: scope,
        targetDepartment: department,
        targetUnit: unit,
        createdBy,
        creatorRole,
      },
    });
  }

  async findAll(query?: QueryAnnouncementDto): Promise<Announcement[]> {
    const where: any = {};
    if (query?.targetScope) {
      where.targetScope = query.targetScope.toUpperCase();
    }
    if (query?.targetDepartment) {
      where.targetDepartment = query.targetDepartment.toLowerCase();
    }
    if (query?.targetUnit) {
      where.targetUnit = query.targetUnit;
    }
    return this.prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find announcements visible to a worker based on church-wide + their department + their unit
   */
  async findVisibleForWorker(
    worker?: Worker | null,
    isAdmin = false,
    limit = 10,
  ): Promise<Announcement[]> {
    if (isAdmin) {
      return this.prisma.announcement.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    const orConditions: any[] = [{ targetScope: 'ALL' }];

    if (worker?.department) {
      const dept = worker.department.toLowerCase();
      orConditions.push({
        targetScope: 'DEPARTMENT',
        targetDepartment: dept,
      });

      if (worker.unit) {
        orConditions.push({
          targetScope: 'UNIT',
          targetDepartment: dept,
          targetUnit: worker.unit,
        });
      }
    }

    return this.prisma.announcement.findMany({
      where: { OR: orConditions },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Find announcements created by or within the scope of a leader for management/edit/delete
   */
  async findManagedByLeader(
    worker?: Worker | null,
    isAdmin = false,
    limit = 15,
  ): Promise<Announcement[]> {
    if (isAdmin) {
      return this.prisma.announcement.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    if (worker?.isHOD) {
      return this.prisma.announcement.findMany({
        where: {
          targetDepartment: worker.department.toLowerCase(),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    if (worker?.isUnitHead && worker.unit) {
      return this.prisma.announcement.findMany({
        where: {
          targetDepartment: worker.department.toLowerCase(),
          targetUnit: worker.unit,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    return [];
  }

  async findOne(id: string): Promise<Announcement> {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) {
      throw new NotFoundException(`Announcement with ID ${id} not found`);
    }
    return announcement;
  }

  async update(
    id: string,
    updateDto: UpdateAnnouncementDto,
    editor?: { worker?: Worker | null; isAdmin?: boolean },
  ): Promise<Announcement> {
    const announcement = await this.findOne(id);
    this.assertCanManage(announcement, editor);

    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...(updateDto.title && { title: updateDto.title }),
        ...(updateDto.message && { message: updateDto.message }),
        ...(updateDto.targetScope && { targetScope: updateDto.targetScope.toUpperCase() }),
        ...(updateDto.targetDepartment && { targetDepartment: updateDto.targetDepartment.toLowerCase() }),
        ...(updateDto.targetUnit && { targetUnit: updateDto.targetUnit }),
      },
    });
  }

  async remove(
    id: string,
    editor?: { worker?: Worker | null; isAdmin?: boolean },
  ): Promise<{ success: boolean; message: string }> {
    const announcement = await this.findOne(id);
    this.assertCanManage(announcement, editor);

    await this.prisma.announcement.delete({ where: { id } });
    return {
      success: true,
      message: `Announcement "${announcement.title}" deleted successfully`,
    };
  }

  private assertCanManage(
    announcement: Announcement,
    editor?: { worker?: Worker | null; isAdmin?: boolean },
  ) {
    if (editor?.isAdmin) return;

    const worker = editor?.worker;
    if (!worker) {
      throw new ForbiddenException('You do not have permission to manage this announcement');
    }

    const workerDept = worker.department.toLowerCase();
    const annDept = (announcement.targetDepartment || '').toLowerCase();

    if (worker.isHOD && annDept === workerDept && announcement.targetScope !== 'ALL') {
      return;
    }

    if (
      worker.isUnitHead &&
      annDept === workerDept &&
      announcement.targetUnit === worker.unit &&
      announcement.targetScope === 'UNIT'
    ) {
      return;
    }

    throw new ForbiddenException('You can only edit or delete announcements within your authorized scope');
  }
}
