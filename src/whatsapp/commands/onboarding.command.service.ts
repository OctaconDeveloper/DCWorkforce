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
    this.clearPendingSession(remoteJid);

    await this.whatsappService.sendMessage(
      remoteJid,
      `⚠️ *ONBOARDING VIA WHATSAPP IS DISABLED*\n` +
      `────────────────────────────\n` +
      `Direct profile onboarding and device claiming via WhatsApp has been disabled.\n\n` +
      `• *New to workforce?* Type *register* or *template* to fill out the official worker registration form.\n` +
      `• *Already registered?* If your profile is not linked or you changed phone numbers, please contact your Head of Department (HOD) or Church Administrator.\n\n` +
      `_Type *menu* to return to the main menu._`,
    );
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
    await this.handleOnboardCommand(input, remoteJid, lid, rawPhone, isAdmin);
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
        `🎉 *ONBOARDING COMPLETED AUTOMATICALLY!*\n` +
        `────────────────────────────\n` +
        `We detected your WhatsApp number and verified your workforce profile!\n\n` +
        `Welcome, *${updatedWorker.fullName}*!\n` +
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
      `🔍 *NO REGISTERED WORKER PROFILE FOUND*\n` +
      `────────────────────────────\n` +
      `Your WhatsApp number (*${cleanInput}*) is not yet registered in the church workforce database.\n\n` +
      `💡 *Next Steps:*\n` +
      `1️⃣ *New Worker:* Reply *register* to receive the registration form and join workforce!\n` +
      `2️⃣ *Already Registered with a different number?:* Contact your Head of Department (HOD) or Church Admin to update your official phone number.\n\n` +
      `↩️ _Reply *menu* to return to the main menu._`;

    await this.whatsappService.sendMessage(remoteJid, notFoundMessage);
  }
}
