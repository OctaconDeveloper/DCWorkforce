import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto, UpdateEventDto, QueryEventDto } from './dto/create-event.dto';
import { Event, Worker } from '@prisma/client';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  async create(
    createDto: CreateEventDto,
    creator?: { worker?: Worker | null; isAdmin?: boolean; name?: string },
  ): Promise<Event> {
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

    return this.prisma.event.create({
      data: {
        title: createDto.title,
        description: createDto.description,
        date: createDto.date,
        time: createDto.time,
        venue: createDto.venue,
        targetScope: scope,
        targetDepartment: department,
        targetUnit: unit,
        createdBy,
        creatorRole,
      },
    });
  }

  async findAll(query?: QueryEventDto): Promise<Event[]> {
    const where: any = {};
    const today = this.getTodayDateString();

    where.date = { gte: query?.fromDate || today };

    if (query?.targetScope) {
      where.targetScope = query.targetScope.toUpperCase();
    }
    if (query?.targetDepartment) {
      where.targetDepartment = query.targetDepartment.toLowerCase();
    }
    if (query?.targetUnit) {
      where.targetUnit = query.targetUnit;
    }

    return this.prisma.event.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
  }

  /**
   * Find upcoming events visible to a worker (date >= today, matching ALL, department or unit)
   */
  async findUpcomingForWorker(
    worker?: Worker | null,
    isAdmin = false,
    limit = 10,
  ): Promise<Event[]> {
    const today = this.getTodayDateString();

    if (isAdmin) {
      return this.prisma.event.findMany({
        where: { date: { gte: today } },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
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

    return this.prisma.event.findMany({
      where: {
        date: { gte: today },
        OR: orConditions,
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: limit,
    });
  }

  /**
   * Find events created by or within the scope of a leader for management/edit/delete
   */
  async findManagedByLeader(
    worker?: Worker | null,
    isAdmin = false,
    includePast = false,
    limit = 15,
  ): Promise<Event[]> {
    const today = this.getTodayDateString();
    const dateFilter = includePast ? {} : { date: { gte: today } };

    if (isAdmin) {
      return this.prisma.event.findMany({
        where: { ...dateFilter },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    if (worker?.isHOD) {
      return this.prisma.event.findMany({
        where: {
          targetDepartment: worker.department.toLowerCase(),
          ...dateFilter,
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    if (worker?.isUnitHead && worker.unit) {
      return this.prisma.event.findMany({
        where: {
          targetDepartment: worker.department.toLowerCase(),
          targetUnit: worker.unit,
          ...dateFilter,
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: limit,
      });
    }

    return [];
  }

  async findOne(id: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    return event;
  }

  async update(
    id: string,
    updateDto: UpdateEventDto,
    editor?: { worker?: Worker | null; isAdmin?: boolean },
  ): Promise<Event> {
    const event = await this.findOne(id);
    this.assertCanManage(event, editor);

    return this.prisma.event.update({
      where: { id },
      data: {
        ...(updateDto.title && { title: updateDto.title }),
        ...(updateDto.description !== undefined && { description: updateDto.description }),
        ...(updateDto.date && { date: updateDto.date }),
        ...(updateDto.time !== undefined && { time: updateDto.time }),
        ...(updateDto.venue !== undefined && { venue: updateDto.venue }),
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
    const event = await this.findOne(id);
    this.assertCanManage(event, editor);

    await this.prisma.event.delete({ where: { id } });
    return {
      success: true,
      message: `Event "${event.title}" deleted successfully`,
    };
  }

  private assertCanManage(
    event: Event,
    editor?: { worker?: Worker | null; isAdmin?: boolean },
  ) {
    if (editor?.isAdmin) return;

    const worker = editor?.worker;
    if (!worker) {
      throw new ForbiddenException('You do not have permission to manage this event');
    }

    const workerDept = worker.department.toLowerCase();
    const eventDept = (event.targetDepartment || '').toLowerCase();

    if (worker.isHOD && eventDept === workerDept && event.targetScope !== 'ALL') {
      return;
    }

    if (
      worker.isUnitHead &&
      eventDept === workerDept &&
      event.targetUnit === worker.unit &&
      event.targetScope === 'UNIT'
    ) {
      return;
    }

    throw new ForbiddenException('You can only edit or delete events within your authorized scope');
  }
}
