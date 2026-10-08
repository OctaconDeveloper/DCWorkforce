import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  generateWAMessageFromContent,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { WorkersService } from '../workers/workers.service';
import { BirthdayNotifierService } from './birthday-notifier.service';
import { Worker } from '@prisma/client';
import {
  MenuCommandService,
  InfoCommandService,
  DepartmentsCommandService,
  OrganogramCommandService,
  EventsCommandService,
  AnnouncementsCommandService,
  DonationsCommandService,
  OfferingCommandService,
  ScheduleCommandService,
  RegistrationCommandService,
  ApprovalsCommandService,
  AdminCommandService,
  BroadcastCommandService,
  GalleryCommandService,
  OnboardingCommandService,
} from './commands';

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private sock: WASocket | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private readonly reconnectAttemptsMax = 10;

  // Anti-spam in-memory rate limiter: remoteJid -> timestamps[]
  private rateLimitMap = new Map<string, number[]>();

  constructor(
    private readonly configService: ConfigService,
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => BirthdayNotifierService))
    private readonly birthdayNotifierService: BirthdayNotifierService,
    private readonly menuCommandService: MenuCommandService,
    private readonly infoCommandService: InfoCommandService,
    private readonly departmentsCommandService: DepartmentsCommandService,
    private readonly organogramCommandService: OrganogramCommandService,
    private readonly eventsCommandService: EventsCommandService,
    private readonly announcementsCommandService: AnnouncementsCommandService,
    private readonly donationsCommandService: DonationsCommandService,
    private readonly offeringCommandService: OfferingCommandService,
    private readonly scheduleCommandService: ScheduleCommandService,
    private readonly registrationCommandService: RegistrationCommandService,
    private readonly approvalsCommandService: ApprovalsCommandService,
    private readonly adminCommandService: AdminCommandService,
    private readonly broadcastCommandService: BroadcastCommandService,
    private readonly galleryCommandService: GalleryCommandService,
    private readonly onboardingCommandService: OnboardingCommandService,
  ) {}

  async onModuleInit() {
    await this.connectToWhatsApp();
  }

  async onModuleDestroy() {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * Initialize Baileys WhatsApp Connection
   */
  async connectToWhatsApp() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const sessionPath = path.resolve(
        process.cwd(),
        this.configService.get<string>('WHATSAPP_SESSION_PATH') || './whatsapp-auth',
      );

      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.log(`Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: Browsers.macOS('Desktop'),
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        printQRInTerminal: false,
        getMessage: async () => {
          return proto.Message.fromObject({});
        },
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.logger.log('Scan the QR code below to connect WhatsApp Bot:');
          qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
          this.isConnecting = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.logger.warn(
            `WhatsApp connection closed due to: ${lastDisconnect?.error?.message || 'Unknown'}. Reconnecting: ${shouldReconnect}`,
          );

          if (shouldReconnect) {
            if (this.reconnectAttempts < this.reconnectAttemptsMax) {
              this.reconnectAttempts++;
              const delay = Math.min(this.reconnectAttempts * 2000, 30000);
              this.logger.log(`Attempting reconnection #${this.reconnectAttempts} in ${delay}ms...`);
              setTimeout(() => this.connectToWhatsApp(), delay);
            } else {
              this.logger.error('Max reconnection attempts reached. Please restart the application.');
            }
          } else {
            this.logger.error('Device logged out. Please delete the session folder and scan QR code again.');
          }
        } else if (connection === 'open') {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.logger.log('🚀 WhatsApp Bot connected successfully and ready!');
        }
      });

      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
          for (const msg of m.messages) {
            if (!msg.key.fromMe) {
              await this.handleIncomingMessage(msg);
            }
          }
        }
      });
    } catch (err: any) {
      this.isConnecting = false;
      this.logger.error(`Error connecting to WhatsApp: ${err.message}`, err.stack);
    }
  }

  /**
   * Main Router for incoming WhatsApp Messages
   */
  private async handleIncomingMessage(msg: proto.IWebMessageInfo) {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.includes('@g.us')) {
      // Ignore group chats for private bot interaction
      return;
    }

    // Apply anti-spam rate limiting
    if (this.isRateLimited(remoteJid)) {
      this.logger.warn(`Rate limit exceeded for JID: ${remoteJid}. Ignoring message.`);
      return;
    }

    const participant = msg.key.participant;
    let rawPhone = remoteJid.split('@')[0];
    let lid: string | undefined = undefined;

    if (remoteJid.endsWith('@lid')) {
      lid = remoteJid;
    } else if (participant && participant.endsWith('@lid')) {
      lid = participant;
    }

    const normalizedPhone = rawPhone.replace(/\D/g, '');
    const messageText = this.extractMessageText(msg).trim();
    const isDocument = Boolean(msg.message?.documentMessage);
    const lower = messageText.toLowerCase().trim();

    // 1. Resolve Worker Record (by normalized phone or LID)
    const worker = await this.workersService.findByPhoneOrLid(normalizedPhone, lid);

    // Auto-link LID to worker record if chatting from a newly linked companion device
    if (worker && lid && worker.lid !== lid) {
      await this.workersService.linkLid(worker.id, lid);
    }

    // 2. Check if sender is an Admin (using direct phone or linked worker phone)
    const effectivePhone = normalizedPhone || (worker ? worker.phone : null);
    const isAdmin = effectivePhone ? await this.adminCommandService.checkIsAdmin(effectivePhone) : false;

    // Check for Broadcast Commands first (even on document/media uploads)
    if (
      lower.startsWith('broadcast') ||
      lower.startsWith('notify') ||
      lower.startsWith('#broadcast') ||
      lower.startsWith('#notify')
    ) {
      await this.broadcastCommandService.handleBroadcast(
        messageText,
        worker,
        remoteJid,
        isAdmin,
        msg,
        this.sock,
      );
      return;
    }

    // Check if user is in an active interactive onboarding session
    if (this.onboardingCommandService.isPendingOnboarding(remoteJid)) {
      if (
        lower !== 'menu' &&
        lower !== 'cancel' &&
        lower !== 'stop' &&
        lower !== '#cancel'
      ) {
        await this.onboardingCommandService.handlePendingOnboardingInput(
          remoteJid,
          messageText,
          lid,
          effectivePhone || rawPhone,
          isAdmin,
        );
        return;
      } else {
        this.onboardingCommandService.clearPendingSession(remoteJid);
      }
    }

    // Onboarding / Profile Claiming / Device Change Command
    if (
      lower.startsWith('onboard') ||
      lower.startsWith('#onboard') ||
      lower.startsWith('claim') ||
      lower.startsWith('#claim') ||
      lower.startsWith('link profile') ||
      lower.startsWith('link account') ||
      lower.startsWith('link device') ||
      lower.startsWith('link ') ||
      lower === 'link' ||
      lower.startsWith('verify me') ||
      lower.startsWith('verify account') ||
      lower.startsWith('verify') ||
      lower.startsWith('change device') ||
      lower.startsWith('device change')
    ) {
      await this.onboardingCommandService.handleOnboardCommand(
        messageText,
        remoteJid,
        lid,
        effectivePhone || rawPhone,
        isAdmin,
      );
      return;
    }

    // Admin Document Upload Handler (.csv, .xlsx for workers import)
    if (isAdmin && isDocument) {
      await this.adminCommandService.handleAdminDocumentUpload(msg, remoteJid, this.sock);
      return;
    }

    // Template Command (#template, #format, #addworker, #register, form)
    if (
      lower === '#template' ||
      lower === '#format' ||
      lower === '#addworker' ||
      lower === '#register' ||
      lower === 'template' ||
      lower === 'register' ||
      lower === 'form'
    ) {
      await this.registrationCommandService.sendRegistrationTemplate(remoteJid);
      return;
    }

    // Admin Bulk Add Text Command (#addworkers or add workers:)
    if (
      isAdmin &&
      (lower.startsWith('#addworkers') || lower.startsWith('add workers:'))
    ) {
      await this.adminCommandService.handleAdminBulkAddText(messageText, remoteJid);
      return;
    }

    // Admin / HOD Birthday Check Command (#checkbirthdays or #birthdays)
    if (
      (isAdmin || (worker && worker.isHOD)) &&
      (lower === '#checkbirthdays' ||
        lower === '#birthdays' ||
        lower === '#testbirthday')
    ) {
      await this.sendMessage(remoteJid, '⏳ *Checking and dispatching birthday notifications...*');
      const res = await this.birthdayNotifierService.checkAndDispatchBirthdays(true);
      await this.sendMessage(
        remoteJid,
        `🎂 *BIRTHDAY BROADCAST REPORT*\n───────────────────\n• Today Celebrants: *${res.todayCount}*\n• 2-Day Reminders: *${res.reminderCount}*\n\n✅ Notifications successfully checked & dispatched.`,
      );
      return;
    }

    // Announcement Submission Template Detection (Title: ... and Message: ...)
    if (
      lower.includes('title:') &&
      lower.includes('message:') &&
      !this.workersService.isRegistrationFormText(messageText)
    ) {
      await this.announcementsCommandService.handleCreateAnnouncement(
        messageText,
        worker,
        remoteJid,
        isAdmin,
      );
      return;
    }

    // Event Submission Template Detection (Title: ... and Date: ...)
    if (
      lower.includes('title:') &&
      lower.includes('date:') &&
      !this.workersService.isRegistrationFormText(messageText)
    ) {
      await this.eventsCommandService.handleCreateEvent(
        messageText,
        worker,
        remoteJid,
        isAdmin,
      );
      return;
    }

    // Member Registration Format Detection
    if (this.workersService.isRegistrationFormText(messageText)) {
      await this.registrationCommandService.handleRegistrationFormSubmission(
        messageText,
        effectivePhone || rawPhone,
        remoteJid,
        isAdmin,
        lid,
        (text, jid) => this.adminCommandService.handleAdminBulkAddText(text, jid),
      );
      return;
    }

    // Admin Stats Command
    if (isAdmin && lower === '#stats') {
      await this.adminCommandService.handleAdminStats(remoteJid);
      return;
    }

    const quotedText = this.extractQuotedText(msg);

    // 3. Process Commands for EVERYONE (Registered Workers, Leaders, and General Members)
    await this.processPublicAndWorkerCommands(
      worker,
      messageText,
      remoteJid,
      isAdmin,
      effectivePhone || rawPhone,
      quotedText,
      msg,
    );
  }

  /**
   * Process commands available to everyone (Info, Departments, Organogram, Events, Announcements, Donations, Offering, etc.)
   */
  private async processPublicAndWorkerCommands(
    worker: Worker | null,
    commandText: string,
    remoteJid: string,
    isAdmin = false,
    rawPhone = '',
    quotedText?: string,
    msg?: proto.IWebMessageInfo,
  ) {
    const lower = commandText.toLowerCase().trim();
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    // Track interaction if worker is registered
    if (worker) {
      await this.workersService.markInteracted(worker.id);
    }

    // ==========================================
    // 1. CATEGORY SUB-MENUS & SHORTCUTS
    // ==========================================
    // Category 1: Profile & Duty
    if (
      (!quotedText && lower === '1') ||
      lower === 'profile menu' ||
      lower === 'my duty' ||
      lower === 'duty menu'
    ) {
      await this.menuCommandService.sendProfileSubMenu(worker, remoteJid, isAdmin);
      return;
    }

    // Category 2: Church Info & Bulletins
    if (
      (!quotedText && lower === '2') ||
      lower === 'church' ||
      lower === 'church info' ||
      lower === 'church menu' ||
      lower === 'bulletins'
    ) {
      await this.menuCommandService.sendChurchInfoSubMenu(worker, remoteJid, isAdmin);
      return;
    }

    // Category 3: Giving & Projects
    if (
      (!quotedText && lower === '3') ||
      lower === 'giving' ||
      lower === 'give' ||
      lower === 'giving menu'
    ) {
      await this.menuCommandService.sendGivingSubMenu(remoteJid);
      return;
    }

    // Category 4: Leadership & Approvals
    if (
      isLeader &&
      ((!quotedText && lower === '4') ||
        lower === 'leadership' ||
        lower === 'leader' ||
        lower === 'leadership menu' ||
        lower === 'admin menu')
    ) {
      await this.menuCommandService.sendLeadershipSubMenu(worker, remoteJid, isAdmin);
      return;
    }

    // Category 5: Gallery & Media Library
    if (
      (!quotedText && lower === '5') ||
      lower === 'gallery' ||
      lower === 'media library' ||
      lower === 'resources' ||
      lower === 'gallery menu' ||
      lower === '#gallery'
    ) {
      await this.galleryCommandService.sendGalleryMenu(remoteJid);
      return;
    }

    // ==========================================
    // BROADCAST NOTIFICATION & GROUPS
    // ==========================================
    if (
      lower.startsWith('broadcast') ||
      lower.startsWith('notify') ||
      lower.startsWith('#broadcast') ||
      lower.startsWith('#notify')
    ) {
      await this.broadcastCommandService.handleBroadcast(
        commandText,
        worker,
        remoteJid,
        isAdmin,
        msg,
        this.sock,
      );
      return;
    }

    if (
      lower === 'groups' ||
      lower === 'broadcast groups' ||
      lower.startsWith('add group ') ||
      lower.startsWith('create group ') ||
      lower.startsWith('group add ') ||
      lower.startsWith('group view ') ||
      lower.startsWith('view group ') ||
      lower.startsWith('group remove ') ||
      lower.startsWith('delete group ') ||
      lower.startsWith('remove group ')
    ) {
      await this.broadcastCommandService.handleGroupCommands(commandText, remoteJid, isAdmin);
      return;
    }

    // ==========================================
    // ANNOUNCEMENTS MANAGEMENT
    // ==========================================
    if (
      lower === 'add announcement' ||
      lower === 'create announcement' ||
      lower === 'new announcement' ||
      lower === '#addannouncement'
    ) {
      await this.announcementsCommandService.sendAnnouncementTemplate(remoteJid, worker, isAdmin);
      return;
    }

    if (
      lower === 'my announcements' ||
      lower === 'my dept announcements' ||
      lower === 'my unit announcements' ||
      lower === 'manage announcements'
    ) {
      await this.announcementsCommandService.listManagedAnnouncements(worker, remoteJid, isAdmin);
      return;
    }

    if (
      lower.startsWith('delete announcement ') ||
      lower.startsWith('remove announcement ') ||
      lower.startsWith('delete ann ')
    ) {
      const id = commandText.replace(/^(delete|remove)\s+(announcement|ann)\s+/i, '').trim();
      await this.announcementsCommandService.handleDeleteAnnouncement(id, worker, remoteJid, isAdmin);
      return;
    }

    // ==========================================
    // EVENTS MANAGEMENT
    // ==========================================
    if (
      lower === 'add event' ||
      lower === 'create event' ||
      lower === 'new event' ||
      lower === '#addevent'
    ) {
      await this.eventsCommandService.sendEventTemplate(remoteJid, worker, isAdmin);
      return;
    }

    if (
      lower === 'my events' ||
      lower === 'my dept events' ||
      lower === 'my unit events' ||
      lower === 'manage events'
    ) {
      await this.eventsCommandService.listManagedEvents(worker, remoteJid, isAdmin);
      return;
    }

    if (
      lower.startsWith('delete event ') ||
      lower.startsWith('remove event ')
    ) {
      const id = commandText.replace(/^(delete|remove)\s+event\s+/i, '').trim();
      await this.eventsCommandService.handleDeleteEvent(id, worker, remoteJid, isAdmin);
      return;
    }

    // ==========================================
    // ==========================================
    // GALLERY (Messages, Audio, PDF, Media, Photos, Videos)
    // ==========================================
    if (
      lower === 'audio' ||
      lower === 'audio message' ||
      lower === 'audio messages' ||
      lower === 'sermon audio' ||
      lower === 'podcasts' ||
      lower === 'podcast' ||
      lower === '🎙️ audio' ||
      lower.startsWith('gallery audio') ||
      lower.startsWith('audio ')
    ) {
      await this.galleryCommandService.sendAudioMessages(remoteJid);
      return;
    }

    if (
      lower === 'pdf' ||
      lower === 'pdf message' ||
      lower === 'pdf messages' ||
      lower === 'sermon notes' ||
      lower === 'study notes' ||
      lower === 'study outlines' ||
      lower === 'outlines' ||
      lower === '📄 pdf' ||
      lower.startsWith('gallery pdf') ||
      lower.startsWith('pdf ')
    ) {
      await this.galleryCommandService.sendPdfMessages(remoteJid);
      return;
    }

    if (
      lower === 'photos' ||
      lower === 'photo' ||
      lower === 'pictures' ||
      lower === 'picture' ||
      lower === '📸 photos' ||
      lower === '📸 photo' ||
      lower.startsWith('gallery photo') ||
      lower.startsWith('photo ')
    ) {
      await this.galleryCommandService.sendPhotosGallery(remoteJid);
      return;
    }

    if (
      lower === 'videos' ||
      lower === 'video' ||
      lower === 'video highlights' ||
      lower === 'highlights' ||
      lower === '🎬 videos' ||
      lower === '🎬 video' ||
      lower.startsWith('gallery video') ||
      lower.startsWith('video ')
    ) {
      await this.galleryCommandService.sendVideosGallery(remoteJid);
      return;
    }

    if (
      lower === 'messages' ||
      lower === 'message' ||
      lower === 'sermons' ||
      lower === 'sermon' ||
      lower === 'messages gallery' ||
      lower === 'gallery 1' ||
      lower === '📖 messages' ||
      lower.startsWith('gallery message')
    ) {
      await this.galleryCommandService.sendMessagesSubMenu(remoteJid);
      return;
    }

    if (
      lower === 'media' ||
      lower === 'media gallery' ||
      lower === 'gallery 2' ||
      lower === '📸 media' ||
      lower.startsWith('gallery media')
    ) {
      await this.galleryCommandService.sendMediaGallery(remoteJid);
      return;
    }

    if (
      (!quotedText && lower === '5') ||
      lower === 'gallery' ||
      lower === 'media library' ||
      lower === 'resources' ||
      lower === 'gallery menu' ||
      lower === '🎨 gallery' ||
      lower === '#gallery'
    ) {
      await this.galleryCommandService.sendGalleryMenu(remoteJid);
      return;
    }

    // ==========================================
    // DIRECT PUBLIC & WORKER COMMANDS
    // ==========================================

    // a. INFO / STATUS -> fetches user info and leadership status
    if (
      lower === 'info' ||
      lower === 'status' ||
      lower === 'my_info' ||
      lower === 'my info' ||
      lower === 'my_status' ||
      lower === 'my status' ||
      lower === 'profile' ||
      lower === 'my profile'
    ) {
      if (worker) {
        await this.infoCommandService.sendWorkerInfo(worker, remoteJid, isAdmin);
      } else {
        await this.infoCommandService.sendUnregisteredInfoPrompt(rawPhone, remoteJid, isAdmin);
      }
      return;
    }

    // b. DEPARTMENTS -> list of departments, HODs, units & unit heads
    if (
      lower === 'departments' ||
      lower === 'department' ||
      lower === 'depts' ||
      lower === 'dept' ||
      lower.startsWith('departments ') ||
      lower.startsWith('dept_') ||
      lower.startsWith('contact')
    ) {
      let filterDept: string | undefined = undefined;
      if (lower.startsWith('departments ') || lower.startsWith('department ')) {
        filterDept = lower.replace(/^departments?\s+/i, '').trim();
      } else if (lower.startsWith('dept_')) {
        filterDept = lower.replace(/^dept_/i, '').trim();
      } else if (lower.startsWith('contact ') && !lower.endsWith('contact')) {
        filterDept = lower.replace(/^contact\s+/i, '').trim();
      }
      await this.departmentsCommandService.sendDepartmentsAndUnits(remoteJid, filterDept);
      return;
    }

    // c. ORGANOGRAM -> show church organogram (Workers Only)
    if (
      lower === 'organogram' ||
      lower === 'organogram_menu' ||
      lower === 'structure' ||
      lower === 'hierarchy'
    ) {
      if (!worker && !isAdmin) {
        await this.sendMessage(
          remoteJid,
          `🔒 *Registered Workers Only:* The church structural organogram is available to registered church workforce members.\n\nType *register* to receive the registration form!`,
        );
        return;
      }
      await this.organogramCommandService.sendOrganogram(remoteJid);
      return;
    }

    // d. EVENTS -> show upcoming church events (Workers Only)
    if (
      lower === 'events' ||
      lower === 'event' ||
      lower === 'upcoming events' ||
      lower === 'services' ||
      lower === 'service times'
    ) {
      if (!worker && !isAdmin) {
        await this.sendMessage(
          remoteJid,
          `🔒 *Registered Workers Only:* Internal events and program rosters are available to registered church workers.\n\nType *register* to receive the registration form!`,
        );
        return;
      }
      await this.eventsCommandService.sendUpcomingEvents(remoteJid, worker, isAdmin);
      return;
    }

    // e. ANNOUNCEMENTS -> show active church announcements (Workers Only)
    if (
      lower === 'announcements' ||
      lower === 'announcement' ||
      lower === 'news' ||
      lower === 'bulletin'
    ) {
      if (!worker && !isAdmin) {
        await this.sendMessage(
          remoteJid,
          `🔒 *Registered Workers Only:* Church bulletins and announcements are available to registered church workers.\n\nType *register* to receive the registration form!`,
        );
        return;
      }
      await this.announcementsCommandService.sendAnnouncements(remoteJid, worker, isAdmin);
      return;
    }

    // f. DONATIONS -> shows list of active church donations / projects
    if (
      lower === 'donations' ||
      lower === 'donation' ||
      lower === 'donate' ||
      lower === 'projects' ||
      lower === 'project'
    ) {
      await this.donationsCommandService.sendDonations(remoteJid);
      return;
    }

    // g. OFFERING -> shows account numbers for offering and tithe
    if (
      lower === 'offering' ||
      lower === 'offerings' ||
      lower === 'offerring' ||
      lower === 'tithe' ||
      lower === 'tithes' ||
      lower === 'account' ||
      lower === 'accounts' ||
      lower === 'bank' ||
      lower === 'giving account' ||
      (!worker && !quotedText && lower === '4')
    ) {
      await this.offeringCommandService.sendOfferingAndTithe(remoteJid);
      return;
    }

    // ==========================================
    // Worker Specific: Schedule
    // ==========================================
    if (
      lower === 'schedule' ||
      lower === 'my_schedule' ||
      lower === 'my schedule' ||
      lower === 'duty' ||
      lower === 'roster'
    ) {
      if (worker) {
        await this.scheduleCommandService.sendWorkerSchedule(worker, remoteJid);
      } else {
        await this.scheduleCommandService.sendUnregisteredSchedulePrompt(remoteJid);
      }
      return;
    }

    // ==========================================
    // Leadership: Pending Approvals (#pending, accept, reject)
    // ==========================================
    if (
      lower === 'pending' ||
      lower === 'pending_requests' ||
      lower === '#pending' ||
      lower === '8'
    ) {
      await this.approvalsCommandService.handleViewPendingRequests(worker, remoteJid, isAdmin);
      return;
    }

    // ==========================================
    // Leadership: Members Directory (Admin, HOD, Unit Head)
    // ==========================================
    if (
      lower === 'members' ||
      lower === 'workers' ||
      lower === 'team' ||
      lower === 'list members' ||
      lower === 'my members' ||
      lower === 'unit members' ||
      lower === 'my team' ||
      lower === '9'
    ) {
      await this.approvalsCommandService.handleViewMembers(worker, remoteJid, isAdmin);
      return;
    }

    // ==========================================
    // Leadership: Approve Actions (Button clicks, Shortcodes, Quoted Replies, Names)
    // ==========================================
    const isQuotedRegNotification = Boolean(
      quotedText &&
      (quotedText.includes('REGISTRATION') ||
        quotedText.includes('Department') ||
        quotedText.includes('Phone:')),
    );

    if (
      isLeader &&
      (lower.startsWith('accept_') ||
        lower.startsWith('#accept') ||
        lower.startsWith('accept ') ||
        lower === 'accept' ||
        lower.startsWith('approve ') ||
        lower.startsWith('approve_') ||
        lower === 'approve' ||
        lower === 'approved' ||
        lower === 'yes' ||
        lower === 'accept it' ||
        lower.startsWith('a ') ||
        /^a\d+$/.test(lower) ||
        (isQuotedRegNotification && (lower === '1' || lower === 'y')))
    ) {
      let identifier = '';
      if (lower.startsWith('accept_')) {
        identifier = commandText.replace(/^accept_/i, '').trim();
      } else if (lower.startsWith('#accept')) {
        identifier = commandText.replace(/^#accept[_ ]?/i, '').trim();
      } else if (lower.startsWith('accept ')) {
        identifier = commandText.replace(/^accept\s+/i, '').trim();
      } else if (lower.startsWith('approve ') || lower.startsWith('approve_')) {
        identifier = commandText.replace(/^approve[_ ]?/i, '').trim();
      } else if (lower.startsWith('a ')) {
        identifier = commandText.replace(/^a\s+/i, '').trim();
      } else if (/^a\d+$/.test(lower)) {
        identifier = lower.replace(/^a/, '');
      }

      await this.approvalsCommandService.handleApproveRegistrationRequest(
        identifier,
        worker,
        remoteJid,
        isAdmin,
        quotedText,
      );
      return;
    }

    // ==========================================
    // Leadership: Reject Actions (Button clicks, Shortcodes, Quoted Replies, Names)
    // ==========================================
    if (
      isLeader &&
      (lower.startsWith('reject_') ||
        lower.startsWith('#reject') ||
        lower.startsWith('reject ') ||
        lower === 'reject' ||
        lower.startsWith('decline ') ||
        lower.startsWith('decline_') ||
        lower === 'decline' ||
        lower === 'declined' ||
        lower === 'no' ||
        lower.startsWith('r ') ||
        /^r\d+$/.test(lower) ||
        (isQuotedRegNotification && (lower === '2' || lower === 'n')))
    ) {
      let identifier = '';
      if (lower.startsWith('reject_')) {
        identifier = commandText.replace(/^reject_/i, '').trim();
      } else if (lower.startsWith('#reject')) {
        identifier = commandText.replace(/^#reject[_ ]?/i, '').trim();
      } else if (lower.startsWith('reject ')) {
        identifier = commandText.replace(/^reject\s+/i, '').trim();
      } else if (lower.startsWith('decline ') || lower.startsWith('decline_')) {
        identifier = commandText.replace(/^decline[_ ]?/i, '').trim();
      } else if (lower.startsWith('r ')) {
        identifier = commandText.replace(/^r\s+/i, '').trim();
      } else if (/^r\d+$/.test(lower)) {
        identifier = lower.replace(/^r/, '');
      }

      await this.approvalsCommandService.handleRejectRegistrationRequest(
        identifier,
        worker,
        remoteJid,
        isAdmin,
        quotedText,
      );
      return;
    }

    // ==========================================
    // Leadership: Appoint Head of Unit (HOD & Admin)
    // ==========================================
    if (
      (isAdmin || (worker && worker.isHOD)) &&
      (lower === '10' ||
        lower.startsWith('make unit head') ||
        lower.startsWith('make head') ||
        lower.startsWith('set unit head') ||
        lower.startsWith('set head') ||
        lower.startsWith('appoint unit head') ||
        lower.startsWith('appoint head') ||
        lower.startsWith('assign unit head') ||
        lower.startsWith('make hou') ||
        lower.startsWith('appoint hou') ||
        lower.startsWith('set hou') ||
        lower.startsWith('#setunithead') ||
        lower.startsWith('makehou') ||
        lower === 'make unit head' ||
        lower === 'set unit head' ||
        lower === 'appoint unit head' ||
        lower === 'unit head' ||
        lower === 'unithead' ||
        lower === 'hou')
    ) {
      await this.approvalsCommandService.handleAppointUnitHead(
        commandText,
        worker,
        remoteJid,
        isAdmin,
      );
      return;
    }

    // ==========================================
    // Help & Commands Menu
    // ==========================================
    if (
      lower === 'help' ||
      lower === '/help' ||
      lower === 'commands' ||
      lower === '/commands' ||
      lower === 'guide' ||
      lower === '?'
    ) {
      await this.menuCommandService.sendHelpAndCommandsMenu(worker, remoteJid, false, isAdmin);
      return;
    }

    // ==========================================
    // Main Menu / Default Response
    // ==========================================
    if (
      lower === 'menu' ||
      lower === 'main menu' ||
      lower === 'mainmenu' ||
      lower === '🏠 main menu' ||
      lower === '🏠 menu' ||
      lower === 'start' ||
      lower === 'hi' ||
      lower === 'hello' ||
      lower === 'hey'
    ) {
      if (worker) {
        await this.menuCommandService.sendMainMenu(worker, remoteJid, isAdmin);
      } else {
        await this.menuCommandService.sendGuestMainMenu(rawPhone, remoteJid);
      }
      return;
    }

    // If message cannot be processed / is unrecognized, show the full commands guide:
    await this.menuCommandService.sendHelpAndCommandsMenu(worker, remoteJid, false, isAdmin);
  }

  /**
   * Helper: Anti-spam Rate Limiting
   */
  private isRateLimited(remoteJid: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimitMap.get(remoteJid) || [];
    const recent = timestamps.filter((t) => now - t < 5000); // within 5 seconds

    if (recent.length >= 5) {
      return true;
    }

    recent.push(now);
    this.rateLimitMap.set(remoteJid, recent);
    return false;
  }

  /**
   * Helper: Extract message text from multiple possible Baileys formats
   */
  private extractMessageText(msg: proto.IWebMessageInfo): string {
    const m = msg.message;
    if (!m) return '';

    // Un-nest viewOnceMessage or interactiveMessage wrapper
    const innerMsg: any =
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      m;

    if (innerMsg.conversation) return innerMsg.conversation;
    if (innerMsg.extendedTextMessage?.text) return innerMsg.extendedTextMessage.text;

    // 1. Native Flow Button / Single Select interactive response
    if (innerMsg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
      try {
        const parsed = JSON.parse(innerMsg.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
        if (parsed.id) return parsed.id;
        if (parsed.display_text) return parsed.display_text;
      } catch { }
    }

    if (innerMsg.interactiveResponseMessage?.body?.text) {
      return innerMsg.interactiveResponseMessage.body.text;
    }

    // 2. Buttons response message
    if (innerMsg.buttonsResponseMessage?.selectedButtonId) {
      return innerMsg.buttonsResponseMessage.selectedButtonId;
    }
    if (innerMsg.buttonsResponseMessage?.selectedDisplayText) {
      return innerMsg.buttonsResponseMessage.selectedDisplayText;
    }

    // 3. List response message
    if (innerMsg.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return innerMsg.listResponseMessage.singleSelectReply.selectedRowId;
    }
    if (innerMsg.listResponseMessage?.title) {
      return innerMsg.listResponseMessage.title;
    }

    // 4. Template button response
    if (innerMsg.templateButtonReplyMessage?.selectedId) {
      return innerMsg.templateButtonReplyMessage.selectedId;
    }
    if (innerMsg.templateButtonReplyMessage?.selectedDisplayText) {
      return innerMsg.templateButtonReplyMessage.selectedDisplayText;
    }

    // 5. Media captions
    if (innerMsg.imageMessage?.caption) return innerMsg.imageMessage.caption;
    if (innerMsg.videoMessage?.caption) return innerMsg.videoMessage.caption;
    if (innerMsg.documentMessage?.caption) return innerMsg.documentMessage.caption;

    return '';
  }

  /**
   * Helper: Extract quoted message text context if user swiped/replied to a message
   */
  private extractQuotedText(msg: proto.IWebMessageInfo): string | undefined {
    const m = msg.message;
    if (!m) return undefined;

    const innerMsg: any =
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      m;

    const contextInfo =
      innerMsg.extendedTextMessage?.contextInfo ||
      innerMsg.interactiveResponseMessage?.contextInfo ||
      innerMsg.buttonsResponseMessage?.contextInfo;

    const quotedMsg = contextInfo?.quotedMessage;
    if (!quotedMsg) return undefined;

    return (
      quotedMsg.conversation ||
      quotedMsg.extendedTextMessage?.text ||
      quotedMsg.imageMessage?.caption ||
      quotedMsg.documentMessage?.caption ||
      undefined
    );
  }

  /**
   * Send regular text message
   */
  async sendMessage(remoteJid: string, text: string) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(remoteJid, { text });
    } catch (err: any) {
      this.logger.error(`Failed to send WhatsApp message to ${remoteJid}: ${err.message}`);
    }
  }

  /**
   * Send Image message
   */
  async sendImageMessage(remoteJid: string, image: Buffer, caption?: string) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(remoteJid, { image, caption });
    } catch (err: any) {
      this.logger.error(`Failed to send image message to ${remoteJid}: ${err.message}`);
    }
  }

  /**
   * Send Document message (PDF, Docx, etc.)
   */
  async sendDocumentMessage(
    remoteJid: string,
    document: Buffer,
    fileName: string,
    mimetype: string,
    caption?: string,
  ) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(remoteJid, {
        document,
        fileName,
        mimetype,
        caption,
      });
    } catch (err: any) {
      this.logger.error(`Failed to send document message to ${remoteJid}: ${err.message}`);
    }
  }

  /**
   * Send Audio / Voice Note message
   */
  async sendAudioMessage(remoteJid: string, audio: Buffer, ptt = false) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(remoteJid, {
        audio,
        mimetype: 'audio/mp4',
        ptt,
      });
    } catch (err: any) {
      this.logger.error(`Failed to send audio message to ${remoteJid}: ${err.message}`);
    }
  }

  /**
   * Send Video message
   */
  async sendVideoMessage(remoteJid: string, video: Buffer, caption?: string) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(remoteJid, { video, caption });
    } catch (err: any) {
      this.logger.error(`Failed to send video message to ${remoteJid}: ${err.message}`);
    }
  }

  /**
   * Send interactive message with native flow / quick-reply buttons and fallback
   */
  async sendInteractiveButtons(
    remoteJid: string,
    content: {
      title?: string;
      text: string;
      footer?: string;
      buttons: Array<{ id: string; text: string }>;
    },
  ) {
    if (!this.sock) return;

    try {
      // 1. Primary Reliable Delivery: Send clear, formatted text response with action hints
      await this.sock.sendMessage(remoteJid, { text: content.text });
    } catch (err: any) {
      this.logger.error(`Failed to send message to ${remoteJid}: ${err.message}`);
    }
  }
}
