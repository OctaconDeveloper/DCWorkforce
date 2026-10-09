import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { WorkersService } from '../workers/workers.service';
import { WhatsappService } from './whatsapp.service';
import { Worker } from '@prisma/client';

@Injectable()
export class BirthdayNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BirthdayNotifierService.name);
  private checkInterval: NodeJS.Timeout | null = null;
  // Keep track of sent notifications for the day: dateKey -> Set of processed worker IDs
  private sentNotifications = new Map<string, Set<string>>();

  constructor(
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  onModuleInit() {
    this.scheduleDailyCheck();
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  private scheduleDailyCheck() {
    // Check every hour to see if 07:00 AM has arrived and not yet dispatched
    this.checkInterval = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 7) {
        this.checkAndDispatchBirthdays(false).catch((err) => {
          this.logger.error(`Error in daily birthday check: ${err.message}`);
        });
      }
    }, 60 * 60 * 1000); // Check hourly
  }

  /**
   * Check birthdays for today and 2-day advance reminders
   */
  async checkAndDispatchBirthdays(
    force = false,
  ): Promise<{ todayCount: number; reminderCount: number; summary: string }> {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

    if (!this.sentNotifications.has(dateKey)) {
      this.sentNotifications.set(dateKey, new Set());
    }
    const processedToday = this.sentNotifications.get(dateKey)!;

    // 1. Check Today's Celebrants
    const todayCelebrants = await this.workersService.findCelebrantsToday();
    let todaySent = 0;

    for (const celebrant of todayCelebrants) {
      const celebrantKey = `today_${celebrant.id}`;
      if (!force && processedToday.has(celebrantKey)) {
        continue;
      }

      await this.dispatchTodayBirthday(celebrant);
      processedToday.add(celebrantKey);
      todaySent++;
    }

    // 2. Check 2-Day Reminders
    const { celebrants: upcomingCelebrants, targetDate } =
      await this.workersService.findCelebrantsInDays(2);
    let reminderSent = 0;

    for (const celebrant of upcomingCelebrants) {
      const reminderKey = `reminder_${celebrant.id}`;
      if (!force && processedToday.has(reminderKey)) {
        continue;
      }

      await this.dispatchTwoDayReminder(celebrant, targetDate);
      processedToday.add(reminderKey);
      reminderSent++;
    }

    const summary = `🎂 Birthday Check Done: ${todaySent} today celebrant(s), ${reminderSent} 2-day reminder(s).`;
    this.logger.log(summary);
    return { todayCount: todaySent, reminderCount: reminderSent, summary };
  }

  /**
   * Dispatch today's birthday messages (celebrant greeting + department broadcast)
   * Birthday notifications are sent ONLY to members of the same department.
   */
  async dispatchTodayBirthday(celebrant: Worker): Promise<string[]> {
    this.logger.log(`🎉 Dispatching today's birthday for ${celebrant.fullName} (${celebrant.department})`);

    const celebrantJid = celebrant.lid || `${this.workersService.normalizePhoneNumber(celebrant.phone)}@s.whatsapp.net`;
    const unitText = celebrant.unit ? ` (${celebrant.unit})` : '';

    // 1. Direct celebratory message to the celebrant
    const celebrantMsg =
      `🎂🎉 *HAPPY BIRTHDAY, ${celebrant.fullName.toUpperCase()}!* 🎉🎂\n` +
      `────────────────────────────\n` +
      `May the Lord bless you richly, enlarge your coast, and crown this new year of your life with supernatural grace, divine health, wisdom, and favor!\n\n` +
      `Thank you for your dedicated labor of love in the *${celebrant.department.toUpperCase()}* department${unitText}. ⛪✨\n\n` +
      `Have a glorious and joyous celebration! 🎈`;

    await this.whatsappService.sendMessage(celebrantJid, celebrantMsg);

    // 2. Broadcast to all other workers ONLY in the same department
    const deptWorkers = await this.workersService.findByDepartment(celebrant.department, true);
    const departmentAlert =
      `🎂 *DEPARTMENT BIRTHDAY CELEBRATION!* 🎂\n` +
      `────────────────────────────\n` +
      `Today is *${celebrant.fullName}*'s birthday!\n\n` +
      `📌 *Department:* ${celebrant.department.toUpperCase()}\n` +
      (celebrant.unit ? `🎯 *Unit:* ${celebrant.unit}\n` : '') +
      `📱 *Phone:* ${celebrant.phone}\n\n` +
      `Let's celebrate, pray for, and send our warm wishes to our beloved brother/sister today! 🎉🙏✨`;

    const notifiedRecipients: string[] = [];
    const normalizedCelebrantPhone = this.workersService.normalizePhoneNumber(celebrant.phone);

    for (const member of deptWorkers) {
      const normalizedMemberPhone = this.workersService.normalizePhoneNumber(member.phone);
      if (normalizedMemberPhone !== normalizedCelebrantPhone) {
        // Safe 3-5 seconds anti-ban delay
        const delay = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        await new Promise((resolve) => setTimeout(resolve, delay));

        const memberJid = member.lid || `${normalizedMemberPhone}@s.whatsapp.net`;
        await this.whatsappService.sendMessage(memberJid, departmentAlert);
        notifiedRecipients.push(`${member.fullName} (${member.phone})`);
      }
    }

    return notifiedRecipients;
  }

  /**
   * Dispatch 2-day upcoming birthday reminder to all members of the same department
   */
  private async dispatchTwoDayReminder(celebrant: Worker, targetDate: Date) {
    this.logger.log(
      `⏰ Dispatching 2-day birthday reminder for ${celebrant.fullName} (${celebrant.department})`,
    );

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const dateFormatted = `${targetDate.getDate()} ${monthNames[targetDate.getMonth()]}`;

    const reminderMsg =
      `⏰ *2-DAY BIRTHDAY REMINDER!* 🎂\n` +
      `────────────────────────────\n` +
      `In 2 days (*${dateFormatted}*), our beloved worker *${celebrant.fullName}* will be celebrating their birthday!\n\n` +
      `📌 *Department:* ${celebrant.department.toUpperCase()}\n` +
      (celebrant.unit ? `🎯 *Unit:* ${celebrant.unit}\n` : '') +
      `📱 *Phone:* ${celebrant.phone}\n\n` +
      `Get ready to celebrate, pray for, and appreciate them! 🎉✨`;

    const deptWorkers = await this.workersService.findByDepartment(celebrant.department, true);
    const normalizedCelebrantPhone = this.workersService.normalizePhoneNumber(celebrant.phone);

    for (const member of deptWorkers) {
      const normalizedMemberPhone = this.workersService.normalizePhoneNumber(member.phone);
      if (normalizedMemberPhone !== normalizedCelebrantPhone) {
        // Safe 3-5 seconds anti-ban delay
        const delay = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        await new Promise((resolve) => setTimeout(resolve, delay));

        const memberJid = member.lid || `${normalizedMemberPhone}@s.whatsapp.net`;
        await this.whatsappService.sendMessage(memberJid, reminderMsg);
      }
    }
  }

}
