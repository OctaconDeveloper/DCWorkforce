import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup, Context } from 'telegraf';
import { WorkersService } from '../workers/workers.service';
import { DepartmentsService } from '../departments/departments.service';
import { EventsService } from '../events/events.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { SchedulesService } from '../schedules/schedules.service';
import { AdminService } from '../admin/admin.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import { BroadcastGroupsService } from '../broadcast/broadcast-groups.service';
import { Worker } from '@prisma/client';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf | null = null;
  private isRunning = false;

  // Multi-step session tracker for interactive prompts (chatId -> { action: string, timestamp: number })
  private pendingSessions = new Map<number, { action: string; timestamp: number }>();
  private readonly sessionTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly workersService: WorkersService,
    private readonly departmentsService: DepartmentsService,
    private readonly eventsService: EventsService,
    private readonly announcementsService: AnnouncementsService,
    private readonly schedulesService: SchedulesService,
    private readonly adminService: AdminService,
    @Inject(forwardRef(() => BroadcastService))
    private readonly broadcastService: BroadcastService,
    private readonly broadcastGroupsService: BroadcastGroupsService,
  ) { }

  async onModuleInit() {
    await this.initTelegramBot();
  }

  async onModuleDestroy() {
    if (this.bot && this.isRunning) {
      this.logger.log('Stopping Telegram Bot polling...');
      this.bot.stop('SIGTERM');
      this.isRunning = false;
    }
  }

  /**
   * Initialize Telegraf Bot instance
   */
  private async initTelegramBot() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token || token.trim() === '' || token.includes('your_telegram_bot_token')) {
      this.logger.warn(
        '⚠️ TELEGRAM_BOT_TOKEN is not configured in .env. Telegram Bot service is idle. (Add TELEGRAM_BOT_TOKEN to enable Telegram integration)',
      );
      return;
    }

    try {
      this.bot = new Telegraf(token);

      // 1. Setup Bot Menu Commands in Telegram UI
      await this.bot.telegram.setMyCommands([
        { command: 'menu', description: '🏠 Open Main Workforce Menu' },
        { command: 'onboard', description: '🚀 Link your workforce profile' },
        { command: 'events', description: '📅 Church events & services' },
        { command: 'announcements', description: '📢 News & announcements' },
        { command: 'schedule', description: '🗓️ Your department duty roster' },
        { command: 'departments', description: '🏛️ Departments & leadership' },
        { command: 'giving', description: '💳 Tithes, offerings & donation drives' },
        { command: 'gallery', description: '🎨 Audio sermons, PDFs & media' },
        { command: 'help', description: '📖 Full command guide' },
      ]);

      // 2. Register Middleware & Command Handlers
      this.registerHandlers();

      // 3. Launch Polling
      this.bot.launch().then(() => {
        this.isRunning = true;
        this.logger.log('🚀 Telegram Bot connected and polling for updates!');
      }).catch((err) => {
        this.logger.error(`Failed to launch Telegram Bot: ${err.message}`, err.stack);
      });
    } catch (err: any) {
      this.logger.error(`Error configuring Telegram Bot: ${err.message}`, err.stack);
    }
  }

  /**
   * Register All Telegram Commands and Message Handlers
   */
  private registerHandlers() {
    if (!this.bot) return;

    // Contact sharing for 1-Tap Onboarding
    this.bot.on('contact', async (ctx) => {
      await this.handleContactShare(ctx);
    });

    // Slash Commands
    this.bot.command(['start', 'menu'], async (ctx) => {
      await this.handleMenuCommand(ctx);
    });

    this.bot.command(['onboard', 'link', 'claim', 'verify'], async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
      await this.handleOnboard(ctx, args);
    });

    this.bot.command(['register', 'template', 'form'], async (ctx) => {
      await this.sendRegistrationTemplate(ctx);
    });

    this.bot.command(['info', 'status', 'profile'], async (ctx) => {
      await this.handleInfo(ctx);
    });

    this.bot.command(['departments', 'depts', 'dept'], async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
      await this.handleDepartments(ctx, args);
    });

    this.bot.command(['organogram', 'structure'], async (ctx) => {
      await this.handleOrganogram(ctx);
    });

    this.bot.command(['events', 'event', 'services'], async (ctx) => {
      await this.handleEvents(ctx);
    });

    this.bot.command(['announcements', 'announcement', 'news', 'bulletin'], async (ctx) => {
      await this.handleAnnouncements(ctx);
    });

    this.bot.command(['schedule', 'duty', 'roster'], async (ctx) => {
      await this.handleSchedule(ctx);
    });

    this.bot.command(['giving', 'offering', 'tithe', 'donations', 'projects'], async (ctx) => {
      await this.handleGiving(ctx);
    });

    this.bot.command(['gallery', 'media', 'messages', 'audio', 'pdf', 'photos', 'videos'], async (ctx) => {
      const sub = ctx.message.text.replace('/', '').trim().toLowerCase();
      await this.handleGallery(ctx, sub);
    });

    this.bot.command(['help', 'guide', 'commands'], async (ctx) => {
      await this.handleHelp(ctx);
    });

    this.bot.command(['broadcast', 'notify'], async (ctx) => {
      const text = ctx.message.text.substring(ctx.message.text.indexOf(' ') + 1).trim();
      await this.handleBroadcastCommand(ctx, text);
    });

    this.bot.command(['groups', 'group'], async (ctx) => {
      const text = ctx.message.text.trim();
      await this.handleGroupsCommand(ctx, text);
    });

    this.bot.command(['pending', 'approvals'], async (ctx) => {
      await this.handlePendingRegistrations(ctx);
    });

    this.bot.command('members', async (ctx) => {
      await this.handleMembers(ctx);
    });

    this.bot.command(['search', 'find'], async (ctx) => {
      const query = ctx.message.text.substring(ctx.message.text.indexOf(' ') + 1).trim();
      await this.handleSearch(ctx, query);
    });

    this.bot.command('stats', async (ctx) => {
      await this.handleStats(ctx);
    });

    // Inline Button Callback Queries
    this.bot.on('callback_query', async (ctx) => {
      await this.handleCallbackQuery(ctx);
    });

    // General Text Message Interceptor (handles plain keywords e.g. "1", "2", "events", "onboard 080...", templates)
    this.bot.on('text', async (ctx) => {
      await this.handleIncomingText(ctx);
    });

    // Global Error Boundary for Bot Updates
    this.bot.catch((err: any, ctx) => {
      this.logger.error(`Error processing Telegram update ${ctx?.update?.update_id}: ${err.message || err}`, err.stack);
    });
  }

  /**
   * Split long text into safe chunks under Telegram's 4096 character limit
   */
  private splitMessageChunks(text: string, maxLength = 3800): string[] {
    if (!text || text.length <= maxLength) return [text || ''];

    const chunks: string[] = [];
    const lines = text.split('\n');
    let currentChunk = '';

    for (const line of lines) {
      if ((currentChunk + '\n' + line).length > maxLength) {
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        if (line.length > maxLength) {
          let remaining = line;
          while (remaining.length > maxLength) {
            chunks.push(remaining.substring(0, maxLength));
            remaining = remaining.substring(maxLength);
          }
          currentChunk = remaining;
        } else {
          currentChunk = line;
        }
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Reply safely across 1 or more message chunks with markdown fallback
   */
  private async replySafe(ctx: Context, text: string, extra?: any) {
    const chunks = this.splitMessageChunks(text);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const opts = isLast ? extra : undefined;
      try {
        await ctx.replyWithMarkdown(chunks[i], opts);
      } catch (err: any) {
        this.logger.warn(`Markdown reply failed, falling back to plain text: ${err.message}`);
        await ctx.reply(chunks[i], opts);
      }
    }
  }

  /**
   * Resolve worker and admin status from Telegram Context
   */
  private async resolveUser(ctx: Context): Promise<{
    worker: Worker | null;
    isAdmin: boolean;
    telegramId: string;
    username?: string;
  }> {
    const telegramId = ctx.from?.id?.toString() || '';
    const username = ctx.from?.username;

    const worker = await this.workersService.findByTelegramId(telegramId);
    let isAdmin = false;

    if (worker && worker.phone) {
      isAdmin = await this.checkIsAdmin(worker.phone);
    }

    return { worker, isAdmin, telegramId, username };
  }

  /**
   * Check if a phone number belongs to an Admin
   */
  private async checkIsAdmin(phone: string): Promise<boolean> {
    const adminPhones = this.configService.get<string>('ADMIN_PHONE_NUMBERS') || '';
    const normalized = this.workersService.normalizePhoneNumber(phone);
    const list = adminPhones.split(',').map((p) => this.workersService.normalizePhoneNumber(p.trim()));
    return list.includes(normalized);
  }

  // ==========================================
  // HANDLERS: MENU & ONBOARDING
  // ==========================================

  private async handleMenuCommand(ctx: Context) {
    const { worker, isAdmin, telegramId } = await this.resolveUser(ctx);

    if (worker) {
      const isLeader = Boolean(isAdmin || worker.isHOD || worker.isUnitHead);
      const leaderTag = worker.isHOD ? ' (HOD)' : worker.isUnitHead ? ' (Unit Head)' : '';

      let text =
        `👋 *WELCOME, ${worker.fullName.toUpperCase()}!*\n` +
        `⛪ *DC Kubwa Workforce Portal (Telegram)*\n` +
        `📌 *Department:* ${worker.department.toUpperCase()}${worker.unit ? ' - ' + worker.unit : ''}${leaderTag}\n` +
        `────────────────────────────\n` +
        `Please select a category:\n\n` +
        `1️⃣ *👤 My Profile & Duty*\n` +
        `2️⃣ *🏛️ Church Info & Bulletins*\n` +
        `3️⃣ *💳 Giving & Projects*\n`;

      if (isLeader) {
        text += `4️⃣ *👑 Leadership & Approvals*\n`;
      }
      text += `5️⃣ *🎨 Gallery & Media Library*\n`;
      text += `────────────────────────────\n` +
        `💡 _Tap an option below or type any command directly (e.g. /events, /schedule, /broadcast)._`;

      const buttons = [
        [
          Markup.button.callback('👤 Profile & Duty', 'cat_profile'),
          Markup.button.callback('🏛️ Church Info', 'cat_church'),
        ],
        [
          Markup.button.callback('💳 Giving & Projects', 'cat_giving'),
          Markup.button.callback('🎨 Gallery', 'cat_gallery'),
        ],
      ];

      if (isLeader) {
        buttons.push([Markup.button.callback('👑 Leadership & Approvals', 'cat_leadership')]);
      }

      await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
    } else {
      const text =
        `👋 *WELCOME TO DC KUBWA WORKFORCE!*\n` +
        `_...raising leaders that transform society_\n` +
        `────────────────────────────\n` +
        `Hello! You are browsing as a guest/member.\n\n` +
        `📌 *CHOOSE AN OPTION:*\n\n` +
        `1️⃣ *🚀 Complete Onboarding / Link Profile*\n` +
        `   _Already registered in workforce? Tap *Share Contact* below or reply with your phone number to link your account!_\n\n` +
        `2️⃣ *📝 Join Workforce / Register*\n` +
        `   _New to workforce? Reply /register to receive the membership form._\n\n` +
        `3️⃣ *🏛️ Church Departments* (/departments)\n` +
        `4️⃣ *💳 Giving & Projects* (/giving)\n` +
        `5️⃣ *🎨 Gallery & Media Library* (/gallery)\n` +
        `────────────────────────────\n` +
        `💡 *Quick Start:* Tap *📱 Share Contact to Onboard* below or send /onboard!`;

      await ctx.replyWithMarkdown(
        text,
        Markup.keyboard([
          [Markup.button.contactRequest('📱 Share Contact to Onboard')],
          ['📝 Register as Worker', '🏛️ Departments'],
          ['💳 Giving & Tithe', '🎨 Gallery & Sermons'],
        ]).resize(),
      );
    }
  }

  /**
   * 1-Tap Contact Sharing Onboarding
   */
  private async handleContactShare(ctx: any) {
    const contact = ctx.message?.contact;
    if (!contact) return;

    const rawPhone = contact.phone_number;
    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username;

    const { worker, pendingRequest } = await this.workersService.findWorkerForOnboarding(rawPhone);

    if (worker) {
      await this.workersService.linkTelegramId(worker.id, telegramId, username);
      await this.replySafe(
        ctx,
        `🎉 *ONBOARDING COMPLETED AUTOMATICALLY!*\n` +
        `────────────────────────────\n` +
        `We detected your Telegram phone number (*${rawPhone}*) and verified your workforce profile!\n\n` +
        `Welcome, *${worker.fullName}*!\n` +
        `📌 *Department:* ${worker.department.toUpperCase()}\n` +
        (worker.unit ? `📌 *Unit:* ${worker.unit}\n` : '') +
        `📌 *Role:* ${worker.role}\n` +
        (worker.phone ? `📞 *Phone:* ${worker.phone}\n` : '') +
        (username ? `✈️ *Telegram:* @${username}\n` : '') +
        `🆔 *Telegram ID:* ${telegramId}\n\n` +
        `✅ *All workforce features, schedules, and broadcasts are now active on Telegram!*`,
        Markup.removeKeyboard(),
      );
      await this.handleMenuCommand(ctx);
      return;
    }

    if (pendingRequest) {
      await this.replySafe(
        ctx,
        `⏳ *REGISTRATION PENDING APPROVAL*\n` +
        `────────────────────────────\n` +
        `Hello *${pendingRequest.fullName}*! Your registration for *${pendingRequest.department.toUpperCase()}* is currently under review by your Head of Department.\n\n` +
        `📞 *Telegram Phone:* ${rawPhone}\n` +
        (username ? `✈️ *Telegram:* @${username}\n` : '') +
        `🔔 We have linked your Telegram ID (*${telegramId}*), and you will receive an instant notification here once approved!`,
        Markup.removeKeyboard(),
      );
      return;
    }

    await this.replySafe(
      ctx,
      `🔍 *NO REGISTERED PROFILE FOUND*\n` +
      `────────────────────────────\n` +
      `We could not find an existing workforce record for Telegram phone number *${rawPhone}*.\n\n` +
      `💡 If you are a new worker joining workforce, reply with /register to get the membership form!`,
    );
  }

  /**
   * /onboard <phone/email>
   */
  private async handleOnboard(ctx: Context, identifier?: string) {
    const telegramId = ctx.from?.id?.toString() || '';
    const username = ctx.from?.username;

    if (!identifier || identifier.trim().length < 3) {
      if (ctx.from) {
        this.pendingSessions.set(ctx.from.id, { action: 'onboard', timestamp: Date.now() });
      }
      await this.replySafe(
        ctx,
        `🚀 *WORKER SELF-ONBOARDING & DEVICE LINKING*\n` +
        `────────────────────────────\n` +
        `Please tap *📱 Share Contact to Onboard* below for instant 1-tap verification:\n\n` +
        `💡 _Or reply with your registered Phone Number / Email (e.g. *08012345678*)_`,
        Markup.keyboard([[Markup.button.contactRequest('📱 Share Contact to Onboard')]]).resize(),
      );
      return;
    }

    const { worker, pendingRequest } = await this.workersService.findWorkerForOnboarding(identifier);

    if (worker) {
      await this.workersService.linkTelegramId(worker.id, telegramId, username);
      await this.replySafe(
        ctx,
        `🎉 *ONBOARDING COMPLETED SUCCESSFULLY!*\n` +
        `────────────────────────────\n` +
        `Welcome, *${worker.fullName}*!\n` +
        `Your Telegram account has been linked to your workforce profile.\n\n` +
        `📌 *Department:* ${worker.department.toUpperCase()}\n` +
        (worker.unit ? `📌 *Unit:* ${worker.unit}\n` : '') +
        `📌 *Role:* ${worker.role}\n` +
        (worker.phone ? `📞 *Phone:* ${worker.phone}\n` : '') +
        (username ? `✈️ *Telegram:* @${username}\n` : '') +
        `🆔 *Telegram ID:* ${telegramId}\n\n` +
        `Type /menu anytime to open your Workforce Menu!`,
        Markup.removeKeyboard(),
      );
      await this.handleMenuCommand(ctx);
      return;
    }

    if (pendingRequest) {
      await this.replySafe(
        ctx,
        `⏳ *REGISTRATION PENDING APPROVAL*\n` +
        `────────────────────────────\n` +
        `Hello *${pendingRequest.fullName}*! Your registration for *${pendingRequest.department.toUpperCase()}* is in our system and awaiting approval from your Head of Department.\n\n` +
        `🔔 We have linked your Telegram ID (*${telegramId}*).`,
      );
      return;
    }

    await this.replySafe(
      ctx,
      `🔍 *NO REGISTERED RECORD FOUND*\n` +
      `────────────────────────────\n` +
      `We could not find a registered worker profile for "*${identifier}*".\n\n` +
      `💡 Check for typos or reply /register to submit a new worker registration form.`,
    );
  }

  // ==========================================
  // HANDLERS: REGISTRATION & TEMPLATES
  // ==========================================

  private async sendRegistrationTemplate(ctx: Context) {
    const template =
      `📋 *MEMBER REGISTRATION TEMPLATE*\n` +
      `────────────────────────────\n` +
      `Copy, fill in your details and send back in a single message:\n\n` +
      `1. Full Name: \n` +
      `2. Marital Status: \n` +
      `3. Department: \n` +
      `4. Unit: \n` +
      `5. Have you attended DLI?: \n` +
      `6. Have you attended DCA?: \n` +
      `7. Phone Number: \n` +
      `8. Encounter retreat: Attended: \n` +
      `9. Full Address: \n` +
      `10. Date of Birth: \n\n` +
      `💡 *EXAMPLE FILLED RECORD:*\n` +
      `1. Full Name: John Doe\n` +
      `2. Marital Status: Single\n` +
      `3. Department: Media\n` +
      `4. Unit: Sound\n` +
      `5. Have you attended DLI?: Yes\n` +
      `6. Have you attended DCA?: Yes\n` +
      `7. Phone Number: 08012345678\n` +
      `8. Encounter retreat: Attended: yes\n` +
      `9. Full Address: 123 Sample Street, Kubwa\n` +
      `10. Date of Birth: 15 June`;

    await ctx.replyWithMarkdown(template);
  }

  // ==========================================
  // HANDLERS: DEPARTMENTS, EVENTS & ANNOUNCEMENTS
  // ==========================================

  private async handleDepartments(ctx: Context, filter?: string) {
    const text = this.departmentsService.formatDepartmentsAndUnitsText(filter);
    await this.replySafe(ctx, text);
  }

  private async handleOrganogram(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    if (!worker && !isAdmin) {
      await this.replySafe(ctx, `🔒 *Registered Workers Only:* Type /onboard or /register to access the organogram.`);
      return;
    }

    const text = this.departmentsService.formatOrganogramText();
    await this.replySafe(ctx, text);
  }

  private async handleEvents(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    if (!worker && !isAdmin) {
      await this.replySafe(ctx, `🔒 *Registered Workers Only:* Type /onboard or /register to view upcoming events.`);
      return;
    }

    const events = await this.eventsService.findUpcomingForWorker(worker, isAdmin);

    if (events.length === 0) {
      await this.replySafe(
        ctx,
        `📅 *UPCOMING EVENTS & SERVICES*\n────────────────────────────\nNo upcoming events scheduled at this moment.\n\nType /menu to return.`,
      );
      return;
    }

    let text = `📅 *UPCOMING EVENTS & SERVICES*\n────────────────────────────\n`;
    events.forEach((e, idx) => {
      text += `${idx + 1}️⃣ *${e.title.toUpperCase()}*\n`;
      text += `• 📅 *Date:* ${e.date}${e.time ? ' at ' + e.time : ''}\n`;
      if (e.venue) text += `• 📍 *Venue:* ${e.venue}\n`;
      if (e.description) text += `• 📝 ${e.description}\n`;
      text += `\n`;
    });

    await this.replySafe(ctx, text);
  }

  private async handleAnnouncements(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    if (!worker && !isAdmin) {
      await this.replySafe(ctx, `🔒 *Registered Workers Only:* Type /onboard or /register to view announcements.`);
      return;
    }

    const items = await this.announcementsService.findVisibleForWorker(worker, isAdmin);

    if (items.length === 0) {
      await this.replySafe(
        ctx,
        `📢 *CHURCH ANNOUNCEMENTS & BULLETINS*\n────────────────────────────\nNo active announcements at this moment.\n\nType /menu to return.`,
      );
      return;
    }

    let text = `📢 *CHURCH ANNOUNCEMENTS & BULLETINS*\n────────────────────────────\n`;
    items.forEach((a, idx) => {
      text += `${idx + 1}️⃣ *${a.title.toUpperCase()}*\n${a.message}\n\n`;
    });

    await this.replySafe(ctx, text);
  }

  private async handleSchedule(ctx: Context) {
    const { worker } = await this.resolveUser(ctx);
    if (!worker) {
      await this.replySafe(ctx, `🔒 *Registered Workers Only:* Type /onboard to view your duty roster.`);
      return;
    }

    const schedules = await this.schedulesService.findAll({ department: worker.department as any });
    if (schedules.length === 0) {
      await this.replySafe(
        ctx,
        `🗓️ *DUTY SCHEDULE — ${worker.department.toUpperCase()}*\n────────────────────────────\nNo active duty rosters found for your department.\n\nType /menu to return.`,
      );
      return;
    }

    let text = `🗓️ *DUTY SCHEDULE — ${worker.department.toUpperCase()}*\n────────────────────────────\n`;
    schedules.forEach((s) => {
      text += `📌 *${s.title}*\n• Date: ${s.date}\n• Time: ${s.time}\n\n`;
    });

    await this.replySafe(ctx, text);
  }

  private async handleGiving(ctx: Context) {
    const text =
      `💳 *GIVING, TITHES & PROJECTS*\n` +
      `────────────────────────────\n` +
      `🏛️ *TITHE & OFFERING ACCOUNT:*\n` +
      `• *Bank:* Zenith Bank\n` +
      `• *Account Name:* Dominion City Kubwa\n` +
      `• *Account Number:* 1012345678\n\n` +
      `🏗️ *CHURCH BUILDING & PROJECT DRIVE:*\n` +
      `• *Bank:* GTBank\n` +
      `• *Account Name:* DC Kubwa Projects\n` +
      `• *Account Number:* 0123456789\n\n` +
      `_God bless you as you give to the work of the Kingdom!_\n\n` +
      `↩️ Type /menu to return.`;

    await this.replySafe(ctx, text);
  }

  private async handleInfo(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    if (!worker) {
      await this.replySafe(
        ctx,
        `👤 *WORKER PROFILE STATUS*\n────────────────────────────\nYou are currently browsing as a guest/unregistered member.\n\nType /onboard to link your profile or /register to join!`,
      );
      return;
    }

    const leaderTag = worker.isHOD ? ' (Head of Department)' : worker.isUnitHead ? ' (Head of Unit)' : '';
    const text =
      `👤 *WORKER PROFILE & STATUS*\n` +
      `────────────────────────────\n` +
      `• *Full Name:* ${worker.fullName}\n` +
      `• *Phone:* ${worker.phone}\n` +
      (worker.telegramUsername ? `• *Telegram:* @${worker.telegramUsername}\n` : '') +
      (worker.telegramId ? `• *Telegram ID:* ${worker.telegramId}\n` : '') +
      `• *Department:* ${worker.department.toUpperCase()}\n` +
      (worker.unit ? `• *Unit:* ${worker.unit}\n` : '') +
      `• *Role:* ${worker.role}${leaderTag}\n` +
      (worker.birthday ? `• *Birthday:* ${worker.birthday}\n` : '') +
      (worker.maritalStatus ? `• *Marital Status:* ${worker.maritalStatus}\n` : '') +
      `• *System Admin:* ${isAdmin ? '✅ Yes' : '❌ No'}\n\n` +
      `↩️ Type /menu to return.`;

    await this.replySafe(ctx, text);
  }

  private async handleGallery(ctx: Context, sub?: string) {
    if (sub === 'audio') {
      await ctx.replyWithMarkdown(
        `✨ *FEATURE COMING SOON!*\n────────────────────────────\n📌 *AUDIO SERMONS & PODCASTS*\nSunday sermon audio recordings and podcasts are currently being curated and will be available soon!\n\n↩️ Type /gallery or /menu.`,
      );
      return;
    }
    if (sub === 'pdf') {
      await ctx.replyWithMarkdown(
        `✨ *FEATURE COMING SOON!*\n────────────────────────────\n📌 *PDF STUDY GUIDES & BULLETINS*\nWeekly sermon study notes and bulletins will be available for direct download shortly!\n\n↩️ Type /gallery or /menu.`,
      );
      return;
    }
    if (sub === 'photos' || sub === 'videos' || sub === 'media') {
      await ctx.replyWithMarkdown(
        `✨ *FEATURE COMING SOON!*\n────────────────────────────\n📌 *PHOTO & VIDEO MEDIA ARCHIVE*\nHigh-definition service photo albums and video recap highlights are in development and coming soon!\n\n↩️ Type /gallery or /menu.`,
      );
      return;
    }

    const text =
      `🎨 *DOMINION CITY KUBWA — GALLERY & RESOURCES*\n` +
      `────────────────────────────\n` +
      `Welcome to our digital message and media library!\n\n` +
      `1️⃣ *MESSAGES* (/audio or /pdf)\n` +
      `   • 🎙️ Audio sermons & podcasts\n` +
      `   • 📄 PDF study outlines & bulletins\n\n` +
      `2️⃣ *MEDIA* (/photos or /videos)\n` +
      `   • 📸 Service photo albums & video highlights\n\n` +
      `────────────────────────────\n` +
      `💡 _Tap an option below or type /menu to return._`;

    await ctx.replyWithMarkdown(
      text,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('🎙️ Audio Sermons', 'gal_audio'),
          Markup.button.callback('📄 Study PDFs', 'gal_pdf'),
        ],
        [
          Markup.button.callback('📸 Photos', 'gal_photos'),
          Markup.button.callback('🎬 Videos', 'gal_videos'),
        ],
        [Markup.button.callback('🏠 Main Menu', 'cat_main')],
      ]),
    );
  }

  private async handleHelp(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    let text =
      `📖 *DC KUBWA WORKFORCE BOT COMMANDS (TELEGRAM)*\n` +
      `────────────────────────────\n` +
      `📁 *1. 👤 MY PROFILE & ONBOARDING*\n` +
      `• /onboard — Link your workforce account to Telegram\n` +
      `• /info — View your profile details & status\n` +
      `• /schedule — View your duty roster\n` +
      `• /register — Get worker registration form\n\n` +
      `📁 *2. 🏛️ CHURCH INFO*\n` +
      `• /departments — View departments, HODs & units\n` +
      `• /organogram — Church structural organogram\n` +
      `• /events — Upcoming events & services\n` +
      `• /announcements — Church news & bulletins\n\n` +
      `📁 *3. 💳 GIVING & ACCOUNTS*\n` +
      `• /giving — Tithe, offering & project bank accounts\n\n` +
      `📁 *5. 🎨 GALLERY & RESOURCES*\n` +
      `• /gallery — Sermons, PDFs & media highlights\n`;

    if (isLeader) {
      text +=
        `\n📁 *4. 👑 LEADERSHIP & BROADCASTS*\n` +
        `• \`/broadcast unit <msg>\` — Broadcast to your unit\n` +
        `• \`/broadcast dept <msg>\` — Broadcast to your department\n`;
      if (isAdmin) {
        text +=
          `• \`/broadcast all <msg>\` — Church-wide broadcast\n` +
          `• \`/broadcast group <name> <msg>\` — Broadcast to custom group\n` +
          `• /groups — Manage custom broadcast groups\n` +
          `• /stats — View workforce summary statistics\n`;
      }
      text += `• /pending — Review pending registrations with 1-tap approve buttons\n` +
        `• /members — List workers in your department\n`;
    }

    text += `\n────────────────────────────\n` +
      `💡 Type /menu anytime to open the interactive menu!`;

    await this.replySafe(ctx, text);
  }

  // ==========================================
  // HANDLERS: BROADCAST, GROUPS & LEADERSHIP
  // ==========================================

  private async handleBroadcastCommand(ctx: Context, content: string) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    if (!isLeader) {
      await ctx.replyWithMarkdown(`🔒 *Leadership Access Only:* Broadcasts are restricted to HODs, Unit Heads, and Administrators.`);
      return;
    }

    if (!content || content.length < 3) {
      await ctx.replyWithMarkdown(
        `📢 *BROADCAST COMMAND USAGE:*\n` +
        `────────────────────────────\n` +
        `• \`/broadcast unit <message>\` — Send alert to your unit\n` +
        `• \`/broadcast dept <message>\` — Send alert to your department\n` +
        (isAdmin ? `• \`/broadcast all <message>\` — Church-wide broadcast\n• \`/broadcast group <name> <message>\` — Send to custom group\n` : ''),
      );
      return;
    }

    // Process broadcast target scope
    const parts = content.split(' ');
    const target = parts[0].toLowerCase();
    let body = parts.slice(1).join(' ').trim();

    let res;
    if (target === 'unit' && (worker?.isUnitHead || isAdmin)) {
      if (!worker?.unit && !isAdmin) {
        await ctx.replyWithMarkdown(`❌ You do not have a unit assigned.`);
        return;
      }
      res = await this.broadcastService.broadcastToUnit(worker!, body);
    } else if (target === 'dept' && (worker?.isHOD || isAdmin)) {
      res = await this.broadcastService.broadcastToDepartment(worker!, body);
    } else if (target === 'all' && isAdmin) {
      res = await this.broadcastService.broadcastToAllWorkers(body);
    } else if (target === 'group' && isAdmin) {
      const groupName = parts[1];
      body = parts.slice(2).join(' ').trim();
      res = await this.broadcastService.broadcastToGroup(groupName, body);
    } else {
      await ctx.replyWithMarkdown(`❌ Invalid broadcast scope or unauthorized.`);
      return;
    }

    await ctx.replyWithMarkdown(
      `✅ *Broadcast Dispatched Successfully!*\n` +
      `────────────────────────────\n` +
      `• *Target:* ${res.targetDescription}\n` +
      `• *Recipients Targeted:* ${res.totalTargeted}\n` +
      `• *Delivered:* ${res.deliveredCount}\n` +
      (res.failedCount > 0 ? `• *Failed:* ${res.failedCount}\n` : ''),
    );
  }

  private async handlePendingRegistrations(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    if (!isLeader) {
      await ctx.replyWithMarkdown(`🔒 *Leadership Access Only.*`);
      return;
    }

    const pending = isAdmin
      ? await this.workersService.findPendingRequestsForAdmin()
      : await this.workersService.findPendingRequestsForLeader(worker!);

    if (pending.length === 0) {
      await ctx.replyWithMarkdown(`✅ *No pending registration requests for your department.*`);
      return;
    }

    await ctx.replyWithMarkdown(`📋 *PENDING REGISTRATION REQUESTS (${pending.length}):*`);

    for (const p of pending) {
      const card =
        `👤 *${p.fullName}*\n` +
        `• Phone: ${p.phone}\n` +
        `• Department: ${p.department.toUpperCase()} (${p.unit})\n` +
        `• Role: ${p.role}\n` +
        (p.birthday ? `• Birthday: ${p.birthday}\n` : '');

      await ctx.replyWithMarkdown(
        card,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Approve', `cb_app_${p.id}`),
            Markup.button.callback('❌ Reject', `cb_rej_${p.id}`),
          ],
        ]),
      );
    }
  }

  private async handleMembers(ctx: Context) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    if (!worker && !isAdmin) {
      await this.replySafe(ctx, `🔒 *Registered Workers Only.*`);
      return;
    }

    const members = await this.workersService.findAll({
      department: (isAdmin ? undefined : worker?.department) as any,
      isActive: true,
    });

    let text = `👥 *ACTIVE MEMBERS (${members.length})*\n────────────────────────────\n`;
    members.slice(0, 30).forEach((m, idx) => {
      text += `${idx + 1}. *${m.fullName}* (${m.phone}) — ${m.department.toUpperCase()}${m.unit ? ' [' + m.unit + ']' : ''}\n`;
    });

    if (members.length > 30) {
      text += `\n_...and ${members.length - 30} more members._`;
    }

    await this.replySafe(ctx, text);
  }

  private async handleSearch(ctx: Context, rawQuery: string) {
    const { worker, isAdmin } = await this.resolveUser(ctx);
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    if (!isLeader) {
      await this.replySafe(
        ctx,
        `🔒 *Leadership Access Only:* Member search is reserved for Unit Heads, Department Heads, and System Administrators.`,
      );
      return;
    }

    const query = rawQuery.replace(/^\/(search|find)\s*/i, '').trim();
    if (!query) {
      await this.replySafe(
        ctx,
        `🔍 *MEMBER SEARCH GUIDE*\n────────────────────────────\nSearch active church workers by name, phone, unit, or role.\n\n*Usage:* \`/search <query>\`\n_Example:_ \`/search David\` or \`/search Sound\``,
      );
      return;
    }

    const members = await this.workersService.searchMembersForLeader(query, worker, isAdmin);

    let scopeLabel = 'ALL DEPARTMENTS';
    if (!isAdmin && worker) {
      scopeLabel = worker.isHOD
        ? `${worker.department.toUpperCase()} DEPARTMENT`
        : `${worker.department.toUpperCase()} (${worker.unit || 'UNIT'})`;
    }

    if (members.length === 0) {
      await this.replySafe(
        ctx,
        `🔍 *SEARCH RESULTS — ${scopeLabel}*\n────────────────────────────\nNo active workers found matching "*${query}*" in your scope.`,
      );
      return;
    }

    let text = `🔍 *SEARCH RESULTS — ${scopeLabel} (${members.length} found)*\n────────────────────────────\n`;
    members.forEach((m, idx) => {
      const leaderTag = m.isHOD ? ' [👑 HOD]' : m.isUnitHead ? ' [🎖️ Unit Head]' : '';
      const unitText = m.unit ? ` | Unit: ${m.unit}` : '';
      text += `\n*${idx + 1}. ${m.fullName.toUpperCase()}*${leaderTag}\n• Phone: \`${m.phone}\`\n• Dept: ${m.department.toUpperCase()}${unitText}\n• Role: ${m.role || 'Member'}\n`;
    });

    await this.replySafe(ctx, text);
  }

  private async handleStats(ctx: Context) {
    const { isAdmin } = await this.resolveUser(ctx);
    if (!isAdmin) {
      await this.replySafe(ctx, `🔒 *Admin Access Only.*`);
      return;
    }

    const stats = await this.adminService.getStats();
    let text =
      `📊 *WORKFORCE SUMMARY STATISTICS*\n` +
      `────────────────────────────\n` +
      `• *Total Workers:* ${stats.totalWorkers}\n` +
      `• *Active Workers:* ${stats.activeWorkers}\n` +
      `• *Upcoming Duty Schedules:* ${stats.upcomingSchedules}\n` +
      `• *Active Announcements:* ${stats.activeAnnouncements}\n\n` +
      `📁 *By Department:*\n`;

    for (const [dept, count] of Object.entries(stats.workersByDepartment)) {
      text += `• *${dept.toUpperCase()}:* ${count} members\n`;
    }

    await this.replySafe(ctx, text);
  }

  private async handleGroupsCommand(ctx: Context, text: string) {
    const { isAdmin } = await this.resolveUser(ctx);
    if (!isAdmin) {
      await this.replySafe(ctx, `🔒 *Admin Access Only.*`);
      return;
    }

    const groups = await this.broadcastGroupsService.getAllGroups();
    let out = `📢 *CUSTOM BROADCAST GROUPS*\n────────────────────────────\n`;
    if (groups.length === 0) {
      out += `No custom groups created yet.\nUse \`/broadcast group <name> <msg>\` to broadcast to a group.`;
    } else {
      groups.forEach((g) => {
        out += `• *${g.name.toUpperCase()}* (${g.memberCount} members)\n`;
      });
    }

    await this.replySafe(ctx, out);
  }

  // ==========================================
  // HANDLERS: CALLBACK QUERIES & INLINE BUTTONS
  // ==========================================

  private async handleCallbackQuery(ctx: any) {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    await ctx.answerCbQuery();
    const { worker, isAdmin } = await this.resolveUser(ctx);

    if (data === 'cat_main') {
      await this.handleMenuCommand(ctx);
    } else if (data === 'cat_profile') {
      await this.handleInfo(ctx);
    } else if (data === 'cat_church') {
      await this.handleDepartments(ctx);
    } else if (data === 'cat_giving') {
      await this.handleGiving(ctx);
    } else if (data === 'cat_gallery') {
      await this.handleGallery(ctx);
    } else if (data === 'gal_audio') {
      await this.handleGallery(ctx, 'audio');
    } else if (data === 'gal_pdf') {
      await this.handleGallery(ctx, 'pdf');
    } else if (data === 'gal_photos') {
      await this.handleGallery(ctx, 'photos');
    } else if (data === 'gal_videos') {
      await this.handleGallery(ctx, 'videos');
    } else if (data.startsWith('cb_app_')) {
      const id = data.replace('cb_app_', '');
      const reviewer = worker || { fullName: 'Church Admin', isAdmin: true };
      const req = await this.workersService.approveRegistrationRequest(id, reviewer as any);
      await ctx.editMessageText(`✅ *Approved registration for ${req.worker.fullName} (${req.worker.department.toUpperCase()})*`, { parse_mode: 'Markdown' });
    } else if (data.startsWith('cb_rej_')) {
      const id = data.replace('cb_rej_', '');
      const reviewer = worker || { fullName: 'Church Admin', isAdmin: true };
      const req = await this.workersService.rejectRegistrationRequest(id, reviewer as any, 'Rejected via Telegram');
      await ctx.editMessageText(`❌ *Rejected registration for ${req.fullName}*`, { parse_mode: 'Markdown' });
    }
  }

  /**
   * Plain text fallback & keyboard button router
   */
  private async handleIncomingText(ctx: any) {
    const text = ctx.message?.text?.trim();
    if (!text) return;

    const lower = text.toLowerCase();
    const fromId = ctx.from?.id;

    // Normalize text by removing all emojis and non-alphanumeric characters (except spaces and &)
    const clean = text
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '')
      .replace(/[^\w\s&]/gi, '')
      .toLowerCase()
      .trim();

    // 1. Check active interactive session (e.g. onboard)
    if (fromId && this.pendingSessions.has(fromId)) {
      const session = this.pendingSessions.get(fromId)!;
      if (Date.now() - session.timestamp < this.sessionTtlMs) {
        this.pendingSessions.delete(fromId);
        if (session.action === 'onboard') {
          if (
            clean !== 'menu' &&
            clean !== 'cancel' &&
            clean !== 'stop' &&
            clean !== 'share contact to onboard'
          ) {
            await this.handleOnboard(ctx, text);
            return;
          }
        }
      } else {
        this.pendingSessions.delete(fromId);
      }
    }

    // 2. Exact & Normalized Matches for Custom Keyboard Buttons

    // Button: "📱 Share Contact to Onboard" / Onboard / Link Profile
    if (
      clean === 'share contact to onboard' ||
      clean === 'share contact' ||
      clean === 'complete onboarding' ||
      clean === 'onboard' ||
      clean === 'link profile' ||
      clean === 'link account' ||
      clean === 'verify' ||
      lower === 'onboard' ||
      lower === 'link' ||
      lower.startsWith('onboard ') ||
      lower.startsWith('link ')
    ) {
      const arg = lower.startsWith('onboard ')
        ? text.replace(/^onboard\s+/i, '').trim()
        : lower.startsWith('link ')
          ? text.replace(/^link\s+/i, '').trim()
          : undefined;
      await this.handleOnboard(ctx, arg);
      return;
    }

    // Button: "📝 Register as Worker" / Template / Form
    if (
      clean === 'register as worker' ||
      clean === 'register' ||
      clean === 'template' ||
      clean === 'form' ||
      clean === 'worker registration' ||
      clean === 'join workforce' ||
      lower === 'register' ||
      lower === 'template' ||
      lower === '#register' ||
      lower === '#template'
    ) {
      await this.sendRegistrationTemplate(ctx);
      return;
    }

    // Button: "🏛️ Departments" / Church Info
    if (
      clean === 'departments' ||
      clean === 'department' ||
      clean === 'depts' ||
      clean === 'dept' ||
      clean === 'church departments' ||
      clean === 'church info' ||
      lower === '2' ||
      lower === 'departments' ||
      lower.startsWith('departments ') ||
      lower.startsWith('dept ')
    ) {
      const filter = lower.startsWith('departments ')
        ? text.replace(/^departments\s+/i, '').trim()
        : lower.startsWith('dept ')
          ? text.replace(/^dept\s+/i, '').trim()
          : undefined;
      await this.handleDepartments(ctx, filter);
      return;
    }

    // Button: "💳 Giving & Tithe" / Giving & Projects
    if (
      clean === 'giving & tithe' ||
      clean === 'giving & projects' ||
      clean === 'giving' ||
      clean === 'tithe' ||
      clean === 'offering' ||
      clean === 'offerings' ||
      clean === 'donations' ||
      clean === 'projects' ||
      lower === '3' ||
      lower === 'giving' ||
      lower === 'offering' ||
      lower === 'tithe'
    ) {
      await this.handleGiving(ctx);
      return;
    }

    // Button: "🎨 Gallery & Sermons" / Gallery & Media Library
    if (
      clean === 'gallery & sermons' ||
      clean === 'gallery & media library' ||
      clean === 'gallery & media' ||
      clean === 'gallery' ||
      clean === 'sermons' ||
      clean === 'media library' ||
      clean === 'media' ||
      clean === 'audio' ||
      clean === 'pdf' ||
      clean === 'photos' ||
      clean === 'videos' ||
      lower === '5' ||
      lower === 'gallery' ||
      lower === 'audio' ||
      lower === 'pdf' ||
      lower === 'media'
    ) {
      const sub = clean.includes('audio')
        ? 'audio'
        : clean.includes('pdf')
          ? 'pdf'
          : clean.includes('photo')
            ? 'photos'
            : clean.includes('video')
              ? 'videos'
              : undefined;
      await this.handleGallery(ctx, sub);
      return;
    }

    // Profile & Duty
    if (
      clean === 'profile & duty' ||
      clean === 'my profile' ||
      clean === 'profile' ||
      clean === 'info' ||
      clean === 'status' ||
      clean === 'my status' ||
      lower === '1'
    ) {
      await this.handleInfo(ctx);
      return;
    }

    // Events
    if (
      clean === 'events' ||
      clean === 'event' ||
      clean === 'upcoming events' ||
      clean === 'services' ||
      lower === 'events'
    ) {
      await this.handleEvents(ctx);
      return;
    }

    // Announcements
    if (
      clean === 'announcements' ||
      clean === 'announcement' ||
      clean === 'news' ||
      clean === 'bulletins' ||
      clean === 'bulletin' ||
      lower === 'announcements'
    ) {
      await this.handleAnnouncements(ctx);
      return;
    }

    // Schedule / Roster
    if (
      clean === 'schedule' ||
      clean === 'duty roster' ||
      clean === 'duty schedule' ||
      clean === 'duty' ||
      clean === 'roster' ||
      lower === 'schedule'
    ) {
      await this.handleSchedule(ctx);
      return;
    }

    // Organogram
    if (
      clean === 'organogram' ||
      clean === 'structure' ||
      clean === 'hierarchy' ||
      lower === 'organogram'
    ) {
      await this.handleOrganogram(ctx);
      return;
    }

    // Leadership & Approvals
    if (
      clean === 'leadership & approvals' ||
      clean === 'leadership' ||
      clean === 'pending approvals' ||
      clean === 'pending' ||
      clean === 'approvals' ||
      lower === '4' ||
      lower === 'pending'
    ) {
      await this.handlePendingRegistrations(ctx);
      return;
    }

    // Main Menu / Start
    if (
      clean === 'main menu' ||
      clean === 'menu' ||
      clean === 'start' ||
      clean === 'hi' ||
      clean === 'hello' ||
      clean === 'hey' ||
      lower === 'menu' ||
      lower === 'start'
    ) {
      await this.handleMenuCommand(ctx);
      return;
    }

    // Form submission detection
    if (this.workersService.isRegistrationFormText(text)) {
      const analysis = await this.workersService.analyzeRegistrationForm(text);
      if (!analysis.isValid || !analysis.data.fullName) {
        await ctx.replyWithMarkdown(`⚠️ *Incomplete Registration Form.* Please ensure all fields are filled.\nReply /template for the template.`);
        return;
      }

      if (analysis.data.phone) {
        const existingWorker = await this.workersService.findByPhone(analysis.data.phone);
        if (existingWorker) {
          await ctx.replyWithMarkdown(
            `❌ *REGISTRATION REJECTED: PHONE ALREADY REGISTERED*\n────────────────────────────\nA church worker record already exists with the phone number *${analysis.data.phone}* (${existingWorker.fullName}, ${existingWorker.department.toUpperCase()}).\n\nContact your HOD or Admin for updates.`,
          );
          return;
        }

        const existingPending = await this.workersService.findPendingRequestByPhone(analysis.data.phone);
        if (existingPending) {
          await ctx.replyWithMarkdown(
            `⏳ *REGISTRATION ALREADY PENDING REVIEW*\n────────────────────────────\nA registration request for *${existingPending.fullName}* (${analysis.data.phone}) is already pending approval from the *${existingPending.department.toUpperCase()}* department.`,
          );
          return;
        }
      }

      const telegramId = ctx.from?.id?.toString();
      const request = await this.workersService.createRegistrationRequest(analysis.data, undefined);
      await ctx.replyWithMarkdown(
        `📨 *REGISTRATION REQUEST SUBMITTED!*\n────────────────────────────\nThank you *${request.fullName}*! Your registration for *${request.department.toUpperCase()}* (${request.unit}) is pending review from your HOD.\n\nType /menu to return.`,
      );
      return;
    }

    // Unrecognized text -> show menu
    await this.handleMenuCommand(ctx);
  }

  // ==========================================
  // PUBLIC OUTBOUND HELPERS
  // ==========================================

  /**
   * Send text message to Telegram Chat / User ID (with automatic length chunking)
   */
  async sendMessage(chatId: string | number, text: string, options?: any) {
    if (!this.bot || !this.isRunning) return;
    try {
      const chunks = this.splitMessageChunks(text);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const opts = isLast ? options : undefined;
        try {
          await this.bot.telegram.sendMessage(chatId, chunks[i], { parse_mode: 'Markdown', ...opts });
        } catch (err: any) {
          await this.bot.telegram.sendMessage(chatId, chunks[i], { ...opts });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to send Telegram message to ${chatId}: ${err.message}`);
    }
  }

  /**
   * Send Photo to Telegram Chat
   */
  async sendPhoto(chatId: string | number, photo: Buffer | string, caption?: string) {
    if (!this.bot || !this.isRunning) return;
    try {
      await this.bot.telegram.sendPhoto(chatId, photo as any, { caption, parse_mode: 'Markdown' });
    } catch (err: any) {
      this.logger.error(`Failed to send Telegram photo to ${chatId}: ${err.message}`);
    }
  }

  /**
   * Send Document to Telegram Chat
   */
  async sendDocument(chatId: string | number, document: Buffer | string, fileName?: string, caption?: string) {
    if (!this.bot || !this.isRunning) return;
    try {
      await this.bot.telegram.sendDocument(chatId, { source: document as any, filename: fileName }, { caption, parse_mode: 'Markdown' });
    } catch (err: any) {
      this.logger.error(`Failed to send Telegram document to ${chatId}: ${err.message}`);
    }
  }
}
