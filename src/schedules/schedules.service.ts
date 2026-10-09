import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto, UpdateScheduleDto, QueryScheduleDto } from './dto/create-schedule.dto';
import { Schedule, Worker } from '@prisma/client';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createScheduleDto: CreateScheduleDto): Promise<Schedule> {
    return this.prisma.schedule.create({
      data: {
        ...createScheduleDto,
        department: createScheduleDto.department ? createScheduleDto.department.toLowerCase() : 'all',
        targetScope: createScheduleDto.targetScope || 'DEPARTMENT',
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

  /**
   * Find upcoming schedules relevant to a worker (personal, unit, department, or church-wide)
   */
  async findUpcomingForWorker(worker: Worker | null, limit = 10): Promise<Schedule[]> {
    const today = new Date().toISOString().split('T')[0];

    if (!worker) {
      return this.prisma.schedule.findMany({
        where: {
          targetScope: 'ALL',
          date: { gte: today },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    const dept = worker.department?.toLowerCase() || '';
    const unit = worker.unit?.toLowerCase() || '';
    const phone = worker.phone || '';
    const cleanPhone = phone.replace(/\D/g, '');
    const localPhone = cleanPhone.startsWith('234') ? '0' + cleanPhone.slice(3) : cleanPhone;

    // Fetch all future schedules and filter in-memory for flexible targetWorkers matching
    const futureSchedules = await this.prisma.schedule.findMany({
      where: {
        date: { gte: today },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });

    const matched = futureSchedules.filter((sch) => {
      const schScope = (sch.targetScope || 'DEPARTMENT').toUpperCase();
      const schDept = (sch.department || '').toLowerCase();
      const schUnit = (sch.targetUnit || '').toLowerCase();
      const schWorkers = (sch.targetWorkers || '').toLowerCase();

      // 1. Church-wide
      if (schScope === 'ALL' || schDept === 'all') {
        return true;
      }

      // 2. Department duty
      if (schScope === 'DEPARTMENT' && schDept === dept) {
        return true;
      }

      // 3. Unit duty
      if (schScope === 'UNIT') {
        if (schDept === dept && (!schUnit || schUnit === unit || unit.includes(schUnit) || schUnit.includes(unit))) {
          return true;
        }
      }

      // 4. Targeted specific workers
      if (schWorkers) {
        if (
          schWorkers.includes(phone.toLowerCase()) ||
          (cleanPhone && schWorkers.includes(cleanPhone)) ||
          (localPhone && schWorkers.includes(localPhone)) ||
          (worker.fullName && schWorkers.includes(worker.fullName.toLowerCase()))
        ) {
          return true;
        }
      }

      return false;
    });

    return matched.slice(0, limit);
  }

  /**
   * Find schedules due in N days for automated reminders (2 days / 1 day)
   */
  async findDueForReminders(daysAhead: number): Promise<Schedule[]> {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysAhead);
    const dateStr = targetDate.toISOString().split('T')[0];

    const where: any = {
      date: dateStr,
    };

    if (daysAhead === 2) {
      where.reminderSent2Days = false;
    } else if (daysAhead === 1) {
      where.reminderSent1Day = false;
    }

    return this.prisma.schedule.findMany({
      where,
      orderBy: [{ time: 'asc' }],
    });
  }

  /**
   * Mark a reminder as sent
   */
  async markReminderSent(id: string, type: '2days' | '1day'): Promise<Schedule> {
    const data: any = {};
    if (type === '2days') {
      data.reminderSent2Days = true;
    } else if (type === '1day') {
      data.reminderSent1Day = true;
    }

    return this.prisma.schedule.update({
      where: { id },
      data,
    });
  }

  /**
   * Find managed schedules for Admin, HOD, or Unit Head
   */
  async findManagedSchedules(worker: Worker | null, isAdmin = false, limit = 20): Promise<Schedule[]> {
    const today = new Date().toISOString().split('T')[0];

    if (isAdmin) {
      return this.prisma.schedule.findMany({
        where: { date: { gte: today } },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    if (!worker) {
      return [];
    }

    const dept = worker.department?.toLowerCase() || '';
    const unit = worker.unit?.toLowerCase() || '';

    if (worker.isHOD) {
      return this.prisma.schedule.findMany({
        where: {
          department: dept,
          date: { gte: today },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    if (worker.isUnitHead) {
      return this.prisma.schedule.findMany({
        where: {
          department: dept,
          targetUnit: { contains: unit },
          date: { gte: today },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    return [];
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
