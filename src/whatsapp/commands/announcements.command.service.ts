import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { AnnouncementsService } from '../../announcements/announcements.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class AnnouncementsCommandService {
  constructor(
    private readonly announcementsService: AnnouncementsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * ANNOUNCEMENTS -> show active church announcements visible to worker's scope
   */
  async sendAnnouncements(remoteJid: string, worker?: Worker | null, isAdmin = false) {
    const announcements = await this.announcementsService.findVisibleForWorker(worker, isAdmin, 6);

    if (!announcements || announcements.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📢 *CHURCH ANNOUNCEMENTS*\n────────────────────────────\n` +
        `There are no active announcements for your department/unit at this moment.\n\n` +
        `Stay tuned for updates during upcoming weekly services!\n\n` +
        `_Type *menu* to return._`,
      );
      return;
    }

    let response = `📢 *LATEST CHURCH ANNOUNCEMENTS*\n────────────────────────────\n`;

    announcements.forEach((a, i) => {
      let targetTag = 'All Members';
      if (a.targetScope === 'DEPARTMENT' && a.targetDepartment) {
        targetTag = `${a.targetDepartment.toUpperCase()} Dept`;
      } else if (a.targetScope === 'UNIT' && a.targetDepartment && a.targetUnit) {
        targetTag = `${a.targetDepartment.toUpperCase()} — ${a.targetUnit}`;
      }

      const dateStr = a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '';
      response += `\n*${i + 1}. ${a.title.toUpperCase()}*\n`;
      response += `🎯 Target: *${targetTag}* | 🗓️ ${dateStr}\n`;
      response += `💬 ${a.message}\n`;
    });

    response += `\n────────────────────────────\n_Type *menu* to return to main menu._`;

    await this.whatsappService.sendMessage(remoteJid, response);
  }

  /**
   * Send the Announcement Creation Template
   */
  async sendAnnouncementTemplate(
    remoteJid: string,
    worker: Worker | null,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Only Head of Units, Head of Departments, and Administrators can create announcements.`,
      );
      return;
    }

    let scopeDesc = '';
    let extraFields = '';

    if (isAdmin) {
      scopeDesc = `As an Administrator, you can create church-wide announcements or target specific departments/units.`;
      extraFields = `\nScope: all (or department name e.g. media)`;
    } else if (worker?.isHOD) {
      scopeDesc = `As Head of Department for *${worker.department.toUpperCase()}*, your announcement will be delivered to all members in your department.`;
    } else if (worker?.isUnitHead) {
      scopeDesc = `As Head of Unit for *${worker.unit || 'your unit'}* (*${worker.department.toUpperCase()}*), your announcement will be delivered to your unit members.`;
    }

    const templateText =
      `📝 *ANNOUNCEMENT SUBMISSION TEMPLATE*\n` +
      `────────────────────────────\n` +
      `${scopeDesc}\n\n` +
      `*Copy, fill, and send the template below:*\n\n` +
      `Title: Youth Workers Vigil\n` +
      `Message: There will be a mandatory workers prayer session this Friday by 10:00 PM. Please be punctual.${extraFields}\n\n` +
      `────────────────────────────\n` +
      `💡 _You can also use multi-line text with bullet points for the message!_`;

    await this.whatsappService.sendMessage(remoteJid, templateText);
  }

  /**
   * Parse and Create Announcement from submitted text
   */
  async handleCreateAnnouncement(
    text: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Creating announcements is restricted to authorized leaders.`,
      );
      return;
    }

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let title = '';
    let message = '';
    let scope = 'ALL';
    let targetDept = '';
    let targetUnit = '';

    let isMessageBlock = false;
    const messageLines: string[] = [];

    for (const line of lines) {
      if (/^title:\s*/i.test(line)) {
        title = line.replace(/^title:\s*/i, '').trim();
        isMessageBlock = false;
      } else if (/^message:\s*/i.test(line)) {
        isMessageBlock = true;
        messageLines.push(line.replace(/^message:\s*/i, '').trim());
      } else if (/^scope:\s*/i.test(line)) {
        isMessageBlock = false;
        const rawScope = line.replace(/^scope:\s*/i, '').trim();
        if (rawScope.toLowerCase() === 'all') {
          scope = 'ALL';
        } else if (rawScope.includes('/')) {
          const [d, u] = rawScope.split('/');
          scope = 'UNIT';
          targetDept = d.trim();
          targetUnit = u.trim();
        } else {
          scope = 'DEPARTMENT';
          targetDept = rawScope;
        }
      } else if (isMessageBlock) {
        messageLines.push(line);
      }
    }

    message = messageLines.join('\n').trim();

    if (!title || !message) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `⚠️ *Incomplete Template:* Both *Title:* and *Message:* are required.\n\nType *add announcement* to get the blank template.`,
      );
      return;
    }

    try {
      const created = await this.announcementsService.create(
        {
          title,
          message,
          targetScope: scope,
          targetDepartment: targetDept || undefined,
          targetUnit: targetUnit || undefined,
        },
        {
          worker,
          isAdmin,
        },
      );

      let targetDesc = 'All Workforce Members';
      if (created.targetScope === 'DEPARTMENT') {
        targetDesc = `${created.targetDepartment?.toUpperCase()} Department`;
      } else if (created.targetScope === 'UNIT') {
        targetDesc = `${created.targetDepartment?.toUpperCase()} — ${created.targetUnit}`;
      }

      const response =
        `✅ *ANNOUNCEMENT CREATED SUCCESSFULLY!*\n` +
        `────────────────────────────\n` +
        `📌 *Title:* ${created.title}\n` +
        `🎯 *Target:* ${targetDesc}\n` +
        `💬 *Message:*\n${created.message}\n` +
        `────────────────────────────\n` +
        `🆔 *ID:* \`${created.id}\`\n\n` +
        `💡 _To delete this announcement later, type \`delete announcement ${created.id}\`_`;

      await this.whatsappService.sendMessage(remoteJid, response);
    } catch (err: any) {
      await this.whatsappService.sendMessage(remoteJid, `❌ *Creation Failed:* ${err.message}`);
    }
  }

  /**
   * List announcements managed by this leader for editing/deleting
   */
  async listManagedAnnouncements(
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const list = await this.announcementsService.findManagedByLeader(worker, isAdmin, 10);

    if (list.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📋 *MY MANAGED ANNOUNCEMENTS*\n────────────────────────────\n` +
        `You have not created any announcements yet.\n\n` +
        `Type *add announcement* to create one!`,
      );
      return;
    }

    let text = `📋 *MY MANAGED ANNOUNCEMENTS*\n────────────────────────────\n`;
    list.forEach((a, i) => {
      const target = a.targetScope === 'ALL' ? 'All' : a.targetUnit ? `${a.targetDepartment} (${a.targetUnit})` : a.targetDepartment;
      text += `*${i + 1}. ${a.title.toUpperCase()}*\n`;
      text += `   🎯 Scope: *${target}* | 🗓️ ${new Date(a.createdAt).toLocaleDateString()}\n`;
      text += `   🆔 ID: \`${a.id}\`\n`;
    });

    text +=
      `\n────────────────────────────\n` +
      `• To delete an announcement, type:\n\`delete announcement <ID>\``;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Delete an Announcement
   */
  async handleDeleteAnnouncement(
    id: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const idClean = id.trim();
    if (!idClean) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `⚠️ *Usage:* \`delete announcement <ID>\`\n_Type *my announcements* to see your announcements with their IDs._`,
      );
      return;
    }

    try {
      const result = await this.announcementsService.remove(idClean, { worker, isAdmin });
      await this.whatsappService.sendMessage(remoteJid, `✅ ${result.message}`);
    } catch (err: any) {
      await this.whatsappService.sendMessage(remoteJid, `❌ *Delete Failed:* ${err.message}`);
    }
  }
}
