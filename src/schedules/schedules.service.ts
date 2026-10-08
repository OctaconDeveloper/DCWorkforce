import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto, UpdateScheduleDto, QueryScheduleDto } from './dto/create-schedule.dto';
import { Schedule } from '@prisma/client';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createScheduleDto: CreateScheduleDto): Promise<Schedule> {
    return this.prisma.schedule.create({
      data: {
        ...createScheduleDto,
        department: createScheduleDto.department.toLowerCase(),
      },
    });
  }

  async findAll(query?: QueryScheduleDto): Promise<Schedule[]> {
    const where: any = {};

    if (query?.department) {
      where.department = query.department.toLowerCase();
    }

    if (query?.fromDate) {
      where.date = { gte: query.fromDate };
    }

    return this.prisma.schedule.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
  }

  async findUpcomingForDepartment(department: string, limit = 5): Promise<Schedule[]> {
    const today = new Date().toISOString().split('T')[0];

    return this.prisma.schedule.findMany({
      where: {
        department: department.toLowerCase(),
        date: { gte: today },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: limit,
    });
  }

  async findOne(id: string): Promise<Schedule> {
    const schedule = await this.prisma.schedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }
    return schedule;
  }

  async update(id: string, updateScheduleDto: UpdateScheduleDto): Promise<Schedule> {
    await this.findOne(id);
    return this.prisma.schedule.update({
      where: { id },
      data: {
        ...updateScheduleDto,
        ...(updateScheduleDto.department && {
          department: updateScheduleDto.department.toLowerCase(),
        }),
      },
    });
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const schedule = await this.findOne(id);
    await this.prisma.schedule.delete({ where: { id } });
    return { success: true, message: `Schedule ${schedule.title} deleted successfully` };
  }
}
