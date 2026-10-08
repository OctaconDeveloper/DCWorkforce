import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { WorkersService } from '../../workers/workers.service';
import { WhatsappService } from '../whatsapp.service';
import { MenuCommandService } from './menu.command.service';

@Injectable()
export class OnboardingCommandService {
  private readonly logger = new Logger(OnboardingCommandService.name);

  // In-memory map for multi-step onboarding sessions (remoteJid -> timestamp)
  private pendingSessions = new Map<string, number>();
  private readonly sessionTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    @Inject(forwardRef(() => MenuCommandService))
    private readonly menuCommandService: MenuCommandService,
  ) {}

  /**
   * Check if user is in an active interactive onboarding session
   */
  isPendingOnboarding(remoteJid: string): boolean {
    const timestamp = this.pendingSessions.get(remoteJid);
    if (!timestamp) return false;

    if (Date.now() - timestamp > this.sessionTtlMs) {
      this.pendingSessions.delete(remoteJid);
      return false;
    }
    return true;
  }

  /**
   * Clear pending onboarding session
   */
  clearPendingSession(remoteJid: string) {
    this.pendingSessions.delete(remoteJid);
  }

  /**
   * Entry point for `onboard`, `claim`, `link`, `verify`, `change device` commands
   */
  async handleOnboardCommand(
    commandText: string,
    remoteJid: string,
    lid?: string | null,
    rawPhone?: string | null,
    isAdmin = false,
  ) {
    const lower = commandText.toLowerCase().trim();

    // Extract identifier argument if provided (e.g., "onboard 08012345678" or "link john@email.com")
    let identifier = '';
    const prefixes = [
      'onboard',
      'onboarding',
      'claim profile',
      'claim account',
      'claim',
      'link account',
      'link profile',
      'link device',
      'link',
      'verify me',
      'verify account',
      'verify',
      'change device',
      'device change',
    ];

    for (const prefix of prefixes) {
      if (lower.startsWith(prefix)) {
        identifier = commandText.substring(prefix.length).replace(/[:=-]/g, '').trim();
        break;
      }
    }

    // If identifier was provided directly on the same line, process immediately
    if (identifier && identifier.length >= 3) {
      this.clearPendingSession(remoteJid);
      await this.processOnboarding(remoteJid, identifier, lid, rawPhone, isAdmin);
      return;
    }

    // Otherwise, start interactive onboarding prompt
    this.pendingSessions.set(remoteJid, Date.now());

    const prompt =
      `🚀 *WORKER SELF-ONBOARDING & DEVICE LINKING*\n` +
      `────────────────────────────\n` +
      `Welcome to the Dominion City Kubwa Workforce Portal!\n\n` +
      `If you have already been registered as a worker (or changed your WhatsApp device/phone number), you can link your profile immediately in one simple step.\n\n` +
      `📱 *Please reply with your registered Phone Number or Email:*\n` +
      `_(e.g., *08012345678* or *john@example.com*)_\n\n` +
      `────────────────────────────\n` +
      `💡 _New to DC Kubwa Workforce? Reply *register* to fill the membership form._\n` +
      `↩️ _Reply *menu* to cancel and return to main menu._`;

    await this.whatsappService.sendMessage(remoteJid, prompt);
  }

  /**
   * Handle text reply from user during an active onboarding session
   */
  async handlePendingOnboardingInput(
    remoteJid: string,
    input: string,
    lid?: string | null,
    rawPhone?: string | null,
    isAdmin = false,
  ) {
    this.clearPendingSession(remoteJid);
    await this.processOnboarding(remoteJid, input, lid, rawPhone, isAdmin);
  }

  /**
   * Core logic: Look up worker or pending application and complete onboarding
   */
  private async processOnboarding(
    remoteJid: string,
    identifier: string,
    lid?: string | null,
    rawPhone?: string | null,
    isAdmin = false,
  ) {
    const cleanInput = identifier.trim();

    // 1. Search for matching Worker or Pending Registration Request
    const { worker, pendingRequest } = await this.workersService.findWorkerForOnboarding(cleanInput);

    // ==========================================
    // CASE 1: Registered Worker Found
    // ==========================================
    if (worker) {
      const effectiveLid = lid || (remoteJid.endsWith('@lid') ? remoteJid : null);
      const updatedWorker = await this.workersService.completeWorkerOnboarding(
        worker.id,
        effectiveLid,
        rawPhone && !rawPhone.includes('@lid') ? rawPhone : null,
      );

      const leaderTag = updatedWorker.isHOD
        ? ' (Head of Department)'
        : updatedWorker.isUnitHead
        ? ' (Head of Unit)'
        : updatedWorker.role && updatedWorker.role !== 'Member'
        ? ` (${updatedWorker.role})`
        : '';

      const successNotice =
        `🎉 *ONBOARDING COMPLETED SUCCESSFULLY!*\n` +
        `────────────────────────────\n` +
        `Welcome, *${updatedWorker.fullName}*!\n` +
        `Your WhatsApp device has been linked to your church workforce profile.\n\n` +
        `📌 *Department:* ${updatedWorker.department.toUpperCase()}\n` +
        (updatedWorker.unit ? `📌 *Unit:* ${updatedWorker.unit}\n` : '') +
        `📌 *Role:* ${updatedWorker.role}${leaderTag}\n` +
        (updatedWorker.phone ? `📞 *Phone:* ${updatedWorker.phone}\n` : '') +
        `\n────────────────────────────\n` +
        `✅ *All workforce features are now active on this device!*`;

      await this.whatsappService.sendMessage(remoteJid, successNotice);

      // Immediately launch their personalized workforce Main Menu
      await this.menuCommandService.sendMainMenu(updatedWorker, remoteJid, isAdmin);
      return;
    }

    // ==========================================
    // CASE 2: Pending Registration Request Found
    // ==========================================
    if (pendingRequest) {
      const pendingNotice =
        `⏳ *REGISTRATION PENDING APPROVAL*\n` +
        `────────────────────────────\n` +
        `Hello *${pendingRequest.fullName}*!\n\n` +
        `We found your registration submission for *${pendingRequest.department.toUpperCase()}* (${pendingRequest.unit}).\n` +
        `Your application is currently under review by your Head of Department (HOD) / Church Admin.\n\n` +
        `🔔 Your WhatsApp profile has been linked, and you will receive an instant notification here the moment your application is approved!\n\n` +
        `────────────────────────────\n` +
        `↩️ _Type *menu* to return to the guest menu._`;

      await this.whatsappService.sendMessage(remoteJid, pendingNotice);
      return;
    }

    // ==========================================
    // CASE 3: No Matching Record Found
    // ==========================================
    const notFoundMessage =
      `🔍 *NO REGISTERED RECORD FOUND*\n` +
      `────────────────────────────\n` +
      `We could not find an active worker profile matching: "*${cleanInput}*".\n\n` +
      `💡 *Next Steps:*\n` +
      `1️⃣ *Check for typos:* Reply with *onboard <phone>* (e.g. *onboard 08012345678*) or your registered email.\n` +
      `2️⃣ *New Workforce Member:* Reply *register* to receive the registration form.\n` +
      `3️⃣ *Assistance:* Contact your Head of Department or Church Admin to verify your recorded phone number.\n\n` +
      `↩️ _Reply *menu* to return to the main menu._`;

    await this.whatsappService.sendMessage(remoteJid, notFoundMessage);
  }
}
