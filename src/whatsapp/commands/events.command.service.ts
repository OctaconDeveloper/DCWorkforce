import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class EventsCommandService {
  constructor(
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * EVENTS -> show upcoming church events (date >= today) visible to user's scope
   */
  async sendUpcomingEvents(remoteJid: string, worker?: Worker | null, isAdmin = false) {
    const events = await this.eventsService.findUpcomingForWorker(worker, isAdmin, 6);

    let text =
      `📅 *DOMINION CITY KUBWA — UPCOMING EVENTS & SERVICES*\n` +
      `────────────────────────────\n\n` +
      `🌟 *WEEKLY SERVICE SCHEDULE:*\n` +
      `• 🍞 *Sunday Celebration Services:* 7:30 AM & 9:30 AM (Main Sanctuary)\n` +
      `• 📖 *Midweek Word & Communion:* Wednesdays 6:00 PM\n` +
      `• 🔥 *Intercessory Prayer Hour:* Fridays 6:00 PM\n` +
      `• 🎓 *Dominion Leadership Institute (DLI/DCA):* Saturdays 8:00 AM\n\n`;

    if (events && events.length > 0) {
      text += `🔥 *UPCOMING PROGRAMS & EVENTS:*\n────────────────────────────\n`;
      events.forEach((e, i) => {
        let targetTag = 'All Church';
        if (e.targetScope === 'DEPARTMENT' && e.targetDepartment) {
          targetTag = `${e.targetDepartment.toUpperCase()} Dept`;
        } else if (e.targetScope === 'UNIT' && e.targetDepartment && e.targetUnit) {
          targetTag = `${e.targetDepartment.toUpperCase()} — ${e.targetUnit}`;
        }

        text += `\n*${i + 1}. ${e.title.toUpperCase()}*\n`;
        text += `🗓️ Date: *${e.date}*${e.time ? ` | ⏰ ${e.time}` : ''}\n`;
        if (e.venue) text += `📍 Venue: *${e.venue}*\n`;
        text += `🎯 Scope: *${targetTag}*\n`;
        if (e.description) text += `📝 ${e.description}\n`;
      });
    } else {
      text += `_No additional special events scheduled currently._\n`;
    }

    text += `\n────────────────────────────\n_Type *menu* to return to main menu._`;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Send the Event Creation Template
   */
  async sendEventTemplate(
    remoteJid: string,
    worker: Worker | null,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Only Head of Units, Head of Departments, and Administrators can create events.`,
      );
      return;
    }

    let scopeDesc = '';
    let extraFields = '';

    if (isAdmin) {
      scopeDesc = `As an Administrator, you can create church-wide events or target specific departments/units.`;
      extraFields = `\nScope: all (or department name e.g. media)`;
    } else if (worker?.isHOD) {
      scopeDesc = `As Head of Department for *${worker.department.toUpperCase()}*, this event will be created for your department.`;
    } else if (worker?.isUnitHead) {
      scopeDesc = `As Head of Unit for *${worker.unit || 'your unit'}* (*${worker.department.toUpperCase()}*), this event will be created for your unit.`;
    }

    const today = new Date().toISOString().split('T')[0];

    const templateText =
      `📝 *EVENT CREATION TEMPLATE*\n` +
      `────────────────────────────\n` +
      `${scopeDesc}\n\n` +
      `*Copy, fill, and send the template below:*\n\n` +
      `Title: Kingdom Leaders Summit\n` +
      `Date: ${today}\n` +
      `Time: 6:00 PM\n` +
      `Venue: Main Sanctuary\n` +
      `Description: A special power-packed leadership retreat and capacity building session.${extraFields}\n\n` +
      `────────────────────────────\n` +
      `💡 _Note: Date must be in YYYY-MM-DD format (e.g. ${today}). Events with passed dates will automatically not be shown in public listings._`;

    await this.whatsappService.sendMessage(remoteJid, templateText);
  }

  /**
   * Parse and Create Event from submitted text
   */
  async handleCreateEvent(
    text: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Creating events is restricted to authorized leaders.`,
      );
      return;
    }

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let title = '';
    let date = '';
    let time = '';
    let venue = '';
    let description = '';
    let scope = 'ALL';
    let targetDept = '';
    let targetUnit = '';

    let isDescBlock = false;
    const descLines: string[] = [];

    for (const line of lines) {
      if (/^title:\s*/i.test(line)) {
        title = line.replace(/^title:\s*/i, '').trim();
        isDescBlock = false;
      } else if (/^date:\s*/i.test(line)) {
        date = line.replace(/^date:\s*/i, '').trim();
        isDescBlock = false;
      } else if (/^time:\s*/i.test(line)) {
        time = line.replace(/^time:\s*/i, '').trim();
        isDescBlock = false;
      } else if (/^venue:\s*/i.test(line)) {
        venue = line.replace(/^venue:\s*/i, '').trim();
        isDescBlock = false;
      } else if (/^description:\s*/i.test(line)) {
        isDescBlock = true;
        descLines.push(line.replace(/^description:\s*/i, '').trim());
      } else if (/^scope:\s*/i.test(line)) {
        isDescBlock = false;
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
      } else if (isDescBlock) {
        descLines.push(line);
      }
    }

    description = descLines.join('\n').trim();

    if (!title || !date) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `⚠️ *Incomplete Template:* Both *Title:* and *Date:* (YYYY-MM-DD) are required.\n\nType *add event* to get the blank template.`,
      );
      return;
    }

    // Validate date format YYYY-MM-DD or standard parseable date
    let formattedDate = date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        formattedDate = parsed.toISOString().split('T')[0];
      }
    }

    try {
      const created = await this.eventsService.create(
        {
          title,
          date: formattedDate,
          time: time || undefined,
          venue: venue || undefined,
          description: description || undefined,
          targetScope: scope,
          targetDepartment: targetDept || undefined,
          targetUnit: targetUnit || undefined,
        },
        {
          worker,
          isAdmin,
        },
      );

      let targetDesc = 'All Church Members';
      if (created.targetScope === 'DEPARTMENT') {
        targetDesc = `${created.targetDepartment?.toUpperCase()} Department`;
      } else if (created.targetScope === 'UNIT') {
        targetDesc = `${created.targetDepartment?.toUpperCase()} — ${created.targetUnit}`;
      }

      const response =
        `✅ *EVENT CREATED SUCCESSFULLY!*\n` +
        `────────────────────────────\n` +
        `📌 *Title:* ${created.title}\n` +
        `🗓️ *Date:* ${created.date}${created.time ? ` | ⏰ ${created.time}` : ''}\n` +
        (created.venue ? `📍 *Venue:* ${created.venue}\n` : '') +
        `🎯 *Target:* ${targetDesc}\n` +
        (created.description ? `📝 *Description:* ${created.description}\n` : '') +
        `────────────────────────────\n` +
        `🆔 *ID:* \`${created.id}\`\n\n` +
        `💡 _To delete this event later, type \`delete event ${created.id}\`_`;

      await this.whatsappService.sendMessage(remoteJid, response);
    } catch (err: any) {
      await this.whatsappService.sendMessage(remoteJid, `❌ *Creation Failed:* ${err.message}`);
    }
  }

  /**
   * List events managed by this leader for editing/deleting
   */
  async listManagedEvents(
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const list = await this.eventsService.findManagedByLeader(worker, isAdmin, false, 10);

    if (list.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📋 *MY MANAGED EVENTS*\n────────────────────────────\n` +
        `You have no active upcoming events created.\n\n` +
        `Type *add event* to create one!`,
      );
      return;
    }

    let text = `📋 *MY MANAGED EVENTS*\n────────────────────────────\n`;
    list.forEach((e, i) => {
      const target = e.targetScope === 'ALL' ? 'All' : e.targetUnit ? `${e.targetDepartment} (${e.targetUnit})` : e.targetDepartment;
      text += `*${i + 1}. ${e.title.toUpperCase()}*\n`;
      text += `   🗓️ Date: *${e.date}* | 🎯 Scope: *${target}*\n`;
      text += `   🆔 ID: \`${e.id}\`\n`;
    });

    text +=
      `\n────────────────────────────\n` +
      `• To delete an event, type:\n\`delete event <ID>\``;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Delete an Event
   */
  async handleDeleteEvent(
    id: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const idClean = id.trim();
    if (!idClean) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `⚠️ *Usage:* \`delete event <ID>\`\n_Type *my events* to see your events with their IDs._`,
      );
      return;
    }

    try {
      const result = await this.eventsService.remove(idClean, { worker, isAdmin });
      await this.whatsappService.sendMessage(remoteJid, `✅ ${result.message}`);
    } catch (err: any) {
      await this.whatsappService.sendMessage(remoteJid, `❌ *Delete Failed:* ${err.message}`);
    }
  }
}
