import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { WorkersService } from '../workers/workers.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { TelegramService } from '../telegram/telegram.service';
import { Schedule, Worker } from '@prisma/client';

@Injectable()
export class ScheduleNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleNotifierService.name);
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly schedulesService: SchedulesService,
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit() {
    this.schedulePeriodicCheck();
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  private schedulePeriodicCheck() {
    // Check every hour for 2-day and 1-day reminders
    this.checkInterval = setInterval(() => {
      this.checkAndDispatchReminders().catch((err) => {
        this.logger.error(`Error in automated schedule reminder check: ${err.message}`);
      });
    }, 60 * 60 * 1000); // Hourly

    // Also run an initial check shortly after startup (30 seconds in)
    setTimeout(() => {
      this.checkAndDispatchReminders().catch((err) => {
        this.logger.error(`Error in startup schedule reminder check: ${err.message}`);
      });
    }, 30000);
  }

  /**
   * Check schedules due in 2 days and 1 day, then dispatch automated reminders
   */
  async checkAndDispatchReminders(
    force = false,
  ): Promise<{ twoDayCount: number; oneDayCount: number; summary: string }> {
    let twoDayCount = 0;
    let oneDayCount = 0;

    // 1. Check 2-Day Reminders
    const twoDaySchedules = await this.schedulesService.findDueForReminders(2);
    for (const sch of twoDaySchedules) {
      const recipients = await this.resolveRecipients(sch);
      if (recipients.length > 0) {
        await this.dispatchReminder(sch, recipients, 2);
      }
      await this.schedulesService.markReminderSent(sch.id, '2days');
      twoDayCount++;
    }

    // 2. Check 1-Day Reminders
    const oneDaySchedules = await this.schedulesService.findDueForReminders(1);
    for (const sch of oneDaySchedules) {
      const recipients = await this.resolveRecipients(sch);
      if (recipients.length > 0) {
        await this.dispatchReminder(sch, recipients, 1);
      }
      await this.schedulesService.markReminderSent(sch.id, '1day');
      oneDayCount++;
    }

    const summary = `📅 Duty Reminder Check Complete: ${twoDayCount} schedule(s) for 2-day reminder, ${oneDayCount} schedule(s) for 1-day reminder.`;
    this.logger.log(summary);
    return { twoDayCount, oneDayCount, summary };
  }

  /**
   * Immediate notification when a new schedule is created
   */
  async notifyScheduleCreated(schedule: Schedule, creatorName?: string) {
    const recipients = await this.resolveRecipients(schedule);
    if (!recipients || recipients.length === 0) {
      this.logger.warn(`No recipients found for schedule ${schedule.id} (${schedule.title})`);
      return;
    }

    let targetLabel = 'Entire Church Workforce';
    if (schedule.targetScope === 'DEPARTMENT') {
      targetLabel = `${schedule.department.toUpperCase()} Department`;
    } else if (schedule.targetScope === 'UNIT') {
      targetLabel = `${schedule.department.toUpperCase()} — ${schedule.targetUnit || 'Unit'}`;
    } else if (schedule.targetScope === 'WORKER') {
      targetLabel = `Assigned Workers (${schedule.targetWorkers || 'Specific Roster'})`;
    }

    const text =
      `📋 *NEW DUTY SCHEDULE PUBLISHED*\n` +
      `────────────────────────────\n` +
      `A new service/duty schedule has been published for your unit/department:\n\n` +
      `📌 *Duty Title:* ${schedule.title}\n` +
      `🗓️ *Date:* *${schedule.date}*\n` +
      `⏰ *Time:* *${schedule.time}*\n` +
      `📍 *Venue:* *${schedule.venue}*\n` +
      `🎯 *Assigned To:* ${targetLabel}\n` +
      (schedule.description ? `📝 *Details:* ${schedule.description}\n` : '') +
      (creatorName ? `👤 *Published by:* ${creatorName}\n` : '') +
      `\n────────────────────────────\n` +
      `_Type *schedule* anytime to review your upcoming roster._`;

    for (const recipient of recipients) {
      await this.sendToWorker(recipient, text);
    }
  }

  /**
   * Dispatch 2-day or 1-day advance reminder to assigned workers
   */
  private async dispatchReminder(schedule: Schedule, recipients: Worker[], daysAhead: number) {
    const urgency = daysAhead === 1 ? '🚨 *DUTY REMINDER: TOMORROW!*' : '⏰ *DUTY REMINDER: IN 2 DAYS*';
    const dayLabel = daysAhead === 1 ? 'tomorrow' : 'in 2 days';

    for (const worker of recipients) {
      const text =
        `${urgency}\n` +
        `────────────────────────────\n` +
        `Peace be with you, *${worker.fullName}*! 🙏\n\n` +
        `This is a friendly reminder of your upcoming church duty scheduled for *${dayLabel}*:\n\n` +
        `📌 *Duty:* ${schedule.title}\n` +
        `🗓️ *Date:* *${schedule.date}*\n` +
        `⏰ *Time:* *${schedule.time}*\n` +
        `📍 *Venue:* *${schedule.venue}*\n` +
        (schedule.description ? `📝 *Details:* ${schedule.description}\n` : '') +
        `\n────────────────────────────\n` +
        `✨ *Please be punctual and prepared for service.* If you will be unavailable, kindly notify your Unit Head or HOD in advance.\n\n` +
        `_God bless you for your faithful service to Dominion City Kubwa!_`;

      await this.sendToWorker(worker, text);
    }
  }

  /**
   * Send notification to a worker over WhatsApp and/or Telegram
   */
  private async sendToWorker(worker: Worker, text: string) {
    // 1. WhatsApp Delivery
    try {
      if (worker.phone || worker.lid) {
        const jid = worker.phone
          ? `${worker.phone}@s.whatsapp.net`
          : worker.lid!;
        await this.whatsappService.sendMessage(jid, text);
      }
    } catch (err) {
      this.logger.error(`Failed to send schedule notification via WhatsApp to ${worker.fullName}: ${err.message}`);
    }

    // 2. Telegram Delivery
    try {
      if (worker.telegramId) {
        await this.telegramService.sendMessage(worker.telegramId, text);
      }
    } catch (err) {
      this.logger.error(`Failed to send schedule notification via Telegram to ${worker.fullName}: ${err.message}`);
    }
  }

  /**
   * Resolve worker list according to schedule scope and assignments
   */
  async resolveRecipients(schedule: Schedule): Promise<Worker[]> {
    const scope = (schedule.targetScope || 'DEPARTMENT').toUpperCase();
    const dept = (schedule.department || '').toLowerCase();
    const unit = (schedule.targetUnit || '').toLowerCase();

    // 1. Church-wide
    if (scope === 'ALL' || dept === 'all') {
      return this.workersService.findAll({ isActive: true });
    }

    // 2. Department-wide
    if (scope === 'DEPARTMENT') {
      return this.workersService.findByDepartment(dept, true);
    }

    // 3. Unit-specific
    if (scope === 'UNIT') {
      const deptWorkers = await this.workersService.findByDepartment(dept, true);
      if (!unit) return deptWorkers;

      return deptWorkers.filter((w) => {
        if (!w.unit) return false;
        const wUnit = w.unit.toLowerCase();
        return wUnit === unit || wUnit.includes(unit) || unit.includes(wUnit);
      });
    }

    // 4. Targeted specific workers
    if (scope === 'WORKER' || schedule.targetWorkers) {
      const rawWorkers = schedule.targetWorkers || '';
      const allActive = await this.workersService.findAll({ isActive: true });

      const matched: Worker[] = [];
      const parts = rawWorkers.split(/[,;\n]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);

      for (const worker of allActive) {
        const phone = (worker.phone || '').replace(/\D/g, '');
        const localPhone = phone.startsWith('234') ? '0' + phone.slice(3) : phone;
        const name = (worker.fullName || '').toLowerCase();

        const isMatched = parts.some((p) => {
          const cleanP = p.replace(/\D/g, '');
          if (cleanP && (phone.includes(cleanP) || (localPhone && localPhone.includes(cleanP)))) {
            return true;
          }
          if (name.includes(p) || p.includes(name)) {
            return true;
          }
          return false;
        });

        if (isMatched) {
          matched.push(worker);
        }
      }

      // If specific workers matched, return them; otherwise fallback to department
      return matched.length > 0 ? matched : this.workersService.findByDepartment(dept, true);
    }

    return [];
  }
}
