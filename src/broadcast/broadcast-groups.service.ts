import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBroadcastGroupDto } from './dto/broadcast.dto';
import { BroadcastGroup, Worker } from '@prisma/client';

@Injectable()
export class BroadcastGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async createGroup(dto: CreateBroadcastGroupDto): Promise<BroadcastGroup> {
    const slug = dto.name.toLowerCase().trim().replace(/\s+/g, '-');
    const existing = await this.prisma.broadcastGroup.findUnique({
      where: { name: slug },
    });
    if (existing) {
      throw new ConflictException(`Broadcast group "${slug}" already exists`);
    }

    const group = await this.prisma.broadcastGroup.create({
      data: {
        name: slug,
        description: dto.description,
      },
    });

    if (dto.workerIds && dto.workerIds.length > 0) {
      for (const wId of dto.workerIds) {
        await this.addMember(slug, wId).catch(() => {});
      }
    }

    return group;
  }

  async getAllGroups(): Promise<Array<BroadcastGroup & { memberCount: number }>> {
    const groups = await this.prisma.broadcastGroup.findMany({
      include: {
        _count: {
          select: { members: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return groups.map((g) => ({
      ...g,
      memberCount: g._count.members,
    }));
  }

  async getGroupByName(name: string) {
    const slug = name.toLowerCase().trim().replace(/\s+/g, '-');
    const group = await this.prisma.broadcastGroup.findUnique({
      where: { name: slug },
      include: {
        members: {
          include: { worker: true },
        },
      },
    });
    if (!group) {
      throw new NotFoundException(`Broadcast group "${slug}" not found`);
    }
    return group;
  }

  async addMember(groupName: string, workerIdentifier: string): Promise<{ success: boolean; worker: Worker }> {
    const group = await this.getGroupByName(groupName);
    const idClean = workerIdentifier.trim();

    // Find worker by id, phone, or name
    const worker = await this.prisma.worker.findFirst({
      where: {
        OR: [
          { id: idClean },
          { phone: idClean },
          { phone: idClean.replace(/\D/g, '') },
          { fullName: { contains: idClean } },
        ],
      },
    });

    if (!worker) {
      throw new NotFoundException(`Worker matching "${workerIdentifier}" not found`);
    }

    // Check if already in group
    const existing = await this.prisma.broadcastGroupMember.findUnique({
      where: {
        groupId_workerId: {
          groupId: group.id,
          workerId: worker.id,
        },
      },
    });

    if (existing) {
      return { success: true, worker };
    }

    await this.prisma.broadcastGroupMember.create({
      data: {
        groupId: group.id,
        workerId: worker.id,
      },
    });

    return { success: true, worker };
  }

  async removeMember(groupName: string, workerIdentifier: string): Promise<{ success: boolean; workerName: string }> {
    const group = await this.getGroupByName(groupName);
    const idClean = workerIdentifier.trim();

    const worker = await this.prisma.worker.findFirst({
      where: {
        OR: [
          { id: idClean },
          { phone: idClean },
          { phone: idClean.replace(/\D/g, '') },
          { fullName: { contains: idClean } },
        ],
      },
    });

    if (!worker) {
      throw new NotFoundException(`Worker matching "${workerIdentifier}" not found`);
    }

    await this.prisma.broadcastGroupMember.deleteMany({
      where: {
        groupId: group.id,
        workerId: worker.id,
      },
    });

    return { success: true, workerName: worker.fullName };
  }

  async deleteGroup(name: string): Promise<{ success: boolean; message: string }> {
    const group = await this.getGroupByName(name);
    await this.prisma.broadcastGroup.delete({ where: { id: group.id } });
    return {
      success: true,
      message: `Broadcast group "${group.name}" deleted successfully`,
    };
  }
}
