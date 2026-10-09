import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { SchedulesService } from '../../schedules/schedules.service';
import { ScheduleNotifierService } from '../../schedules/schedule-notifier.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class ScheduleCommandService {
  constructor(
    @Inject(forwardRef(() => SchedulesService))
    private readonly schedulesService: SchedulesService,
    @Inject(forwardRef(() => ScheduleNotifierService))
    private readonly scheduleNotifierService: ScheduleNotifierService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * SCHEDULE -> show upcoming duty schedules for worker (personal, unit, department, or church-wide)
   */
  async sendWorkerSchedule(worker: Worker, remoteJid: string) {
    const schedules = await this.schedulesService.findUpcomingForWorker(worker, 10);

    if (!schedules || schedules.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📅 *UPCOMING DUTY SCHEDULES*\n────────────────────────────\n` +
        `No upcoming duty schedules found for you in *${worker.department.toUpperCase()}* department.\n\n` +
        `_Type *menu* to return._`,
      );
      return;
    }

    let response = `📅 *YOUR UPCOMING DUTY ROSTER*\n────────────────────────────\n`;

    schedules.forEach((sch, index) => {
      let scopeTag = 'Department Duty';
      if (sch.targetScope === 'ALL') {
        scopeTag = 'Church-Wide';
      } else if (sch.targetScope === 'UNIT') {
        scopeTag = `Unit Duty: ${sch.targetUnit || 'Unit'}`;
      } else if (sch.targetScope === 'WORKER') {
        scopeTag = 'Personal Assignment';
      }

      response += `\n*${index + 1}. ${sch.title}*\n`;
      response += `🗓️ Date: *${sch.date}* | ⏰ Time: *${sch.time}*\n`;
      response += `📍 Venue: *${sch.venue}*\n`;
      response += `🎯 Scope: *${scopeTag}*\n`;
      if (sch.description) {
        response += `📝 Details: ${sch.description}\n`;
      }
    });

    response += `\n────────────────────────────\n_Type *menu* to return._`;
    await this.whatsappService.sendMessage(remoteJid, response);
  }

  /**
   * Schedule prompt for unregistered users
   */
  async sendUnregisteredSchedulePrompt(remoteJid: string) {
    await this.whatsappService.sendMessage(
      remoteJid,
      `📅 *DUTY SCHEDULES*\n────────────────────────────\n` +
      `Duty rosters are organized by church departments.\n\n` +
      `To view your specific duty assignments, you must be a registered church worker.\n\n` +
      `Type *register* to fill the worker registration form or type *events* to see upcoming church-wide services!`,
    );
  }

  /**
   * Send the standard schedule creation template to leaders
   */
  async sendScheduleTemplate(
    remoteJid: string,
    worker: Worker | null,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Only Head of Units, Head of Departments, and Administrators can create duty schedules.`,
      );
      return;
    }

    let scopeDesc = '';
    let scopeExample = 'unit';
    let deptExample = worker?.department || 'media';
    let unitExample = worker?.unit || 'Media Operations';

    if (isAdmin) {
      scopeDesc = `👑 *Admin Schedule Creator*\nYou can create church-wide duty schedules or target any department, unit, or worker list.`;
      scopeExample = 'department (or all / unit / worker)';
    } else if (worker?.isHOD) {
      scopeDesc = `👑 *Department HOD (${worker.department.toUpperCase()})*\nYou can create schedules for your entire department, specific units, or named workers.`;
      scopeExample = 'department (or unit / worker)';
    } else if (worker?.isUnitHead) {
      scopeDesc = `🎖️ *Unit Head (${worker.unit || 'Unit'} — ${worker.department.toUpperCase()})*\nYou can create duty schedules for your unit or assigned workers.`;
      scopeExample = 'unit';
    }

    const today = new Date();
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + ((7 - today.getDay()) % 7 || 7));
    const sampleDate = nextSunday.toISOString().split('T')[0];

    const templateText =
      `📋 *DUTY SCHEDULE CREATION TEMPLATE*\n` +
      `────────────────────────────\n` +
      `${scopeDesc}\n\n` +
      `*Copy, fill, and send the template below:*\n\n` +
      `Title: Sunday 1st Service Duty Roster\n` +
      `Date: ${sampleDate}\n` +
      `Time: 07:00 AM\n` +
      `Venue: Main Sanctuary\n` +
      `Department: ${deptExample}\n` +
      `Unit: ${unitExample}\n` +
      `Scope: ${scopeExample}\n` +
      `Workers: 08101889830, 08144527833\n` +
      `Description: Video switcher, camera operations, sound check, and stream monitoring.\n\n` +
      `────────────────────────────\n` +
      `💡 *Notes:*\n` +
      `• Date format: *YYYY-MM-DD* (e.g. ${sampleDate})\n` +
      `• Scope options: *all*, *department*, *unit*, *worker*\n` +
      `• Workers: (Optional) Comma-separated phone numbers or full names\n` +
      `• *Automated Reminders:* Assigned workers automatically receive reminders *2 days before* and *1 day before* duty!`;

    await this.whatsappService.sendMessage(remoteJid, templateText);
  }

  /**
   * Handle incoming schedule template submission
   */
  async handleCreateSchedule(
    messageText: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Only Head of Units, Head of Departments, and Administrators can create duty schedules.`,
      );
      return;
    }

    // Parse key-value lines
    const lines = messageText.split('\n');
    const fields: Record<string, string> = {};

    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z0-9_\s]+)\s*[:：]\s*(.*)$/);
      if (match) {
        const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
        fields[key] = match[2].trim();
      }
    }

    const title = fields['title'] || fields['duty_title'] || fields['schedule_title'] || fields['duty'] || fields['schedule'];
    const date = fields['date'] || fields['duty_date'] || fields['schedule_date'];
    const time = fields['time'] || fields['start_time'] || fields['duty_time'];
    const venue = fields['venue'] || fields['location'] || 'Main Sanctuary';
    const description = fields['description'] || fields['details'] || fields['notes'] || '';
    const rawScope = (fields['scope'] || fields['target_scope'] || '').toUpperCase();
    const rawDept = fields['department'] || fields['dept'] || '';
    const rawUnit = fields['unit'] || fields['target_unit'] || '';
    const rawWorkers = fields['workers'] || fields['assigned_workers'] || fields['roster'] || '';

    // Validate essential fields
    if (!title) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Missing Title:* Please include a valid *Title:* line in your schedule template.`,
      );
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Invalid Date Format:* Date must be in *YYYY-MM-DD* format (e.g. 2026-10-12).`,
      );
      return;
    }

    if (!time) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Missing Time:* Please include a *Time:* line (e.g. 07:00 AM).`,
      );
      return;
    }

    // Role-based scope and department resolution
    let targetScope = 'DEPARTMENT';
    let targetDepartment = 'all';
    let targetUnit: string | null = null;
    let creatorRole = 'WORKER';

    if (isAdmin) {
      creatorRole = 'ADMIN';
      targetDepartment = rawDept ? rawDept.toLowerCase() : 'all';
      if (rawScope === 'ALL' || rawDept.toLowerCase() === 'all') {
        targetScope = 'ALL';
      } else if (rawScope === 'UNIT' || rawUnit) {
        targetScope = 'UNIT';
        targetUnit = rawUnit;
      } else if (rawScope === 'WORKER' || rawWorkers) {
        targetScope = 'WORKER';
      } else {
        targetScope = 'DEPARTMENT';
      }
    } else if (worker?.isHOD) {
      creatorRole = 'HOD';
      targetDepartment = worker.department.toLowerCase();
      if (rawScope === 'UNIT' || rawUnit) {
        targetScope = 'UNIT';
        targetUnit = rawUnit;
      } else if (rawScope === 'WORKER' || rawWorkers) {
        targetScope = 'WORKER';
      } else {
        targetScope = 'DEPARTMENT';
      }
    } else if (worker?.isUnitHead) {
      creatorRole = 'UNIT_HEAD';
      targetDepartment = worker.department.toLowerCase();
      targetScope = 'UNIT';
      targetUnit = worker.unit || rawUnit || null;
      if (rawScope === 'WORKER' || rawWorkers) {
        targetScope = 'WORKER';
      }
    }

    const creatorName = isAdmin ? 'Church Administrator' : worker?.fullName || 'Leadership';

    try {
      const createdSchedule = await this.schedulesService.create({
        title,
        date,
        time,
        venue,
        department: targetDepartment,
        description: description || undefined,
        targetScope,
        targetUnit: targetUnit || undefined,
        targetWorkers: rawWorkers || undefined,
        createdBy: creatorName,
        creatorRole,
      });

      // Broadcast instant publication alert to workers
      await this.scheduleNotifierService.notifyScheduleCreated(createdSchedule, creatorName);

      const successMsg =
        `✅ *DUTY SCHEDULE CREATED SUCCESSFULLY!*\n` +
        `────────────────────────────\n` +
        `📌 *Title:* ${createdSchedule.title}\n` +
        `🗓️ *Date:* *${createdSchedule.date}*\n` +
        `⏰ *Time:* *${createdSchedule.time}*\n` +
        `📍 *Venue:* *${createdSchedule.venue}*\n` +
        `🎯 *Target Scope:* *${targetScope}* (${targetDepartment.toUpperCase()}${targetUnit ? ` / ${targetUnit}` : ''})\n` +
        (rawWorkers ? `👥 *Assigned Workers:* ${rawWorkers}\n` : '') +
        (description ? `📝 *Details:* ${description}\n` : '') +
        `\n🔔 *Automated Reminders Active:*\n` +
        `• 2 Days Before Duty\n` +
        `• 1 Day Before Duty\n\n` +
        `_All assigned workers have been notified!_`;

      await this.whatsappService.sendMessage(remoteJid, successMsg);
    } catch (err) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Failed to create schedule:* ${err.message}`,
      );
    }
  }

  /**
   * List schedules managed by Admin, HOD, or Unit Head
   */
  async listManagedSchedules(
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Only Head of Units, Head of Departments, and Administrators can manage duty schedules.`,
      );
      return;
    }

    const schedules = await this.schedulesService.findManagedSchedules(worker, isAdmin, 20);

    if (!schedules || schedules.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📋 *MANAGED DUTY SCHEDULES*\n────────────────────────────\n` +
        `No upcoming schedules found under your management.\n\n` +
        `Type *schedule template* to create a new duty roster!`,
      );
      return;
    }

    let response = `📋 *MANAGED DUTY SCHEDULES*\n────────────────────────────\n`;

    schedules.forEach((sch, index) => {
      response += `\n*${index + 1}. ${sch.title}*\n`;
      response += `🗓️ Date: *${sch.date}* | ⏰ Time: *${sch.time}*\n`;
      response += `📍 Venue: *${sch.venue}*\n`;
      response += `🎯 Scope: *${sch.targetScope}* (${sch.department.toUpperCase()}${sch.targetUnit ? ` — ${sch.targetUnit}` : ''})\n`;
      response += `🗑️ To delete: type *#delschedule ${sch.id}*\n`;
    });

    response += `\n────────────────────────────\n_Type *menu* to return._`;
    await this.whatsappService.sendMessage(remoteJid, response);
  }

  /**
   * Delete a schedule by ID if authorized
   */
  async handleDeleteSchedule(
    id: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Only Head of Units, Head of Departments, and Administrators can delete duty schedules.`,
      );
      return;
    }

    if (!id || id.trim().length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ Please specify the Schedule ID to delete (e.g. *#delschedule <id>*).`,
      );
      return;
    }

    try {
      const schedule = await this.schedulesService.findOne(id.trim());

      // Check permissions
      if (!isAdmin) {
        const workerDept = (worker?.department || '').toLowerCase();
        if (schedule.department.toLowerCase() !== workerDept) {
          await this.whatsappService.sendMessage(
            remoteJid,
            `🚫 You can only delete schedules belonging to your department (*${workerDept.toUpperCase()}*).`,
          );
          return;
        }
      }

      await this.schedulesService.remove(schedule.id);
      await this.whatsappService.sendMessage(
        remoteJid,
        `✅ *Duty schedule deleted:* "${schedule.title}" (${schedule.date}) has been removed.`,
      );
    } catch (err) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Could not delete schedule:* ${err.message}`,
      );
    }
  }
}
