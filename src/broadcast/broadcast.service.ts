import { Injectable, Logger, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { BroadcastGroupsService } from './broadcast-groups.service';
import { BroadcastMediaPayload } from './dto/broadcast.dto';
import { Worker } from '@prisma/client';

export interface BroadcastResult {
  totalTargeted: number;
  deliveredCount: number;
  failedCount: number;
  targetDescription: string;
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastGroupsService: BroadcastGroupsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Helper: Resolve best WhatsApp JID for a worker (prefers lid, falls back to formatted phone)
   */
  private getWorkerJid(worker: Worker): string {
    if (worker.lid) {
      return worker.lid.includes('@') ? worker.lid : `${worker.lid}@lid`;
    }
    const cleanPhone = worker.phone.replace(/\D/g, '');
    return `${cleanPhone}@s.whatsapp.net`;
  }

  /**
   * Send broadcast message or media to a list of workers with rate throttling
   */
  private async dispatchBroadcast(
    workers: Worker[],
    messageText: string,
    senderTitle: string,
    media?: BroadcastMediaPayload,
  ): Promise<BroadcastResult> {
    const totalTargeted = workers.length;
    let deliveredCount = 0;
    let failedCount = 0;

    const formattedMessage = senderTitle
      ? `📢 *[${senderTitle}]*\n\n${messageText.trim()}`
      : messageText.trim();

    for (const worker of workers) {
      const recipientJid = this.getWorkerJid(worker);
      try {
        if (media) {
          if (media.type === 'image') {
            await this.whatsappService.sendImageMessage(
              recipientJid,
              media.buffer,
              formattedMessage,
            );
          } else if (media.type === 'document') {
            await this.whatsappService.sendDocumentMessage(
              recipientJid,
              media.buffer,
              media.fileName || 'document.pdf',
              media.mimetype || 'application/pdf',
              formattedMessage,
            );
          } else if (media.type === 'audio') {
            await this.whatsappService.sendAudioMessage(
              recipientJid,
              media.buffer,
              media.ptt || false,
            );
            if (messageText && messageText.trim()) {
              await this.whatsappService.sendMessage(recipientJid, formattedMessage);
            }
          } else if (media.type === 'video') {
            await this.whatsappService.sendVideoMessage(
              recipientJid,
              media.buffer,
              formattedMessage,
            );
          }
        } else {
          await this.whatsappService.sendMessage(recipientJid, formattedMessage);
        }
        deliveredCount++;
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch broadcast to ${worker.fullName} (${recipientJid}): ${err.message}`);
        failedCount++;
      }

      // Small throttling delay to protect socket connection
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      totalTargeted,
      deliveredCount,
      failedCount,
      targetDescription: senderTitle,
    };
  }

  /**
   * 1. Head of Unit: Broadcast to all workers in their unit
   */
  async broadcastToUnit(
    unitHead: Worker,
    messageText: string,
    media?: BroadcastMediaPayload,
  ): Promise<BroadcastResult> {
    if (!unitHead.unit) {
      throw new Error('Unit Head must be assigned to a unit to broadcast.');
    }

    const dept = unitHead.department.toLowerCase();
    const unit = unitHead.unit;

    const workers = await this.prisma.worker.findMany({
      where: {
        department: dept,
        unit: unit,
        isActive: true,
      },
    });

    const senderTitle = `${unit} Unit — ${unitHead.department.toUpperCase()}`;
    return this.dispatchBroadcast(workers, messageText, senderTitle, media);
  }

  /**
   * 2. Head of Department: Broadcast to all workers in their department
   */
  async broadcastToDepartment(
    hod: Worker,
    messageText: string,
    media?: BroadcastMediaPayload,
  ): Promise<BroadcastResult> {
    const dept = hod.department.toLowerCase();

    const workers = await this.prisma.worker.findMany({
      where: {
        department: dept,
        isActive: true,
      },
    });

    const senderTitle = `${hod.department.toUpperCase()} Department`;
    return this.dispatchBroadcast(workers, messageText, senderTitle, media);
  }

  /**
   * 3. Admin: Broadcast church-wide to all registered workers
   */
  async broadcastToAllWorkers(
    messageText: string,
    media?: BroadcastMediaPayload,
    adminName = 'Church Leadership',
  ): Promise<BroadcastResult> {
    const workers = await this.prisma.worker.findMany({
      where: { isActive: true },
    });

    const senderTitle = `Church-Wide Announcement`;
    return this.dispatchBroadcast(workers, messageText, senderTitle, media);
  }

  /**
   * 4. Admin: Broadcast to a specific department
   */
  async broadcastToSpecificDepartment(
    department: string,
    messageText: string,
    media?: BroadcastMediaPayload,
    adminName = 'Church Leadership',
  ): Promise<BroadcastResult> {
    const dept = department.toLowerCase().trim();
    const workers = await this.prisma.worker.findMany({
      where: {
        department: dept,
        isActive: true,
      },
    });

    const senderTitle = `${dept.toUpperCase()} Department`;
    return this.dispatchBroadcast(workers, messageText, senderTitle, media);
  }

  /**
   * 5. Admin: Broadcast to a custom broadcast group
   */
  async broadcastToGroup(
    groupName: string,
    messageText: string,
    media?: BroadcastMediaPayload,
    adminName = 'Church Leadership',
  ): Promise<BroadcastResult> {
    const group = await this.broadcastGroupsService.getGroupByName(groupName);

    const workers = group.members
      .map((m) => m.worker)
      .filter((w) => w && w.isActive);

    if (workers.length === 0) {
      throw new NotFoundException(`Broadcast group "${group.name}" currently has no active worker members.`);
    }

    const senderTitle = `Group: ${group.name}`;
    return this.dispatchBroadcast(workers, messageText, senderTitle, media);
  }
}
