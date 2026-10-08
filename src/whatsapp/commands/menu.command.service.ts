import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { WorkersService } from '../../workers/workers.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class MenuCommandService {
  constructor(
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Send Main Category Menu for Registered Workers
   */
  async sendMainMenu(worker: Worker, remoteJid: string, isAdmin = false) {
    const isLeader = Boolean(isAdmin || worker.isHOD || worker.isUnitHead);
    const leaderTag = worker.isHOD ? ' (HOD)' : worker.isUnitHead ? ' (Unit Head)' : '';

    let menuBody =
      `👋 *WELCOME, ${worker.fullName.toUpperCase()}!*\n` +
      `⛪ *DC Kubwa Workforce Portal*\n` +
      `📌 *Department:* ${worker.department.toUpperCase()}${worker.unit ? ' - ' + worker.unit : ''}${leaderTag}\n` +
      `────────────────────────────\n` +
      `Please select a category by replying with a number:\n\n` +
      `1️⃣ *👤 My Profile & Duty*\n` +
      `   _Profile info, duty schedule, registration_\n\n` +
      `2️⃣ *🏛️ Church Info & Bulletins*\n` +
      `   _Departments, organogram, events, news_\n\n` +
      `3️⃣ *💳 Giving & Projects*\n` +
      `   _Tithes, offerings & donation drives_\n`;

    if (isLeader) {
      menuBody +=
        `\n4️⃣ *👑 Leadership & Approvals*\n` +
        `   _Pending requests, member directory, unit heads, broadcast alerts, announcements & events_\n`;
    }

    menuBody +=
      `\n5️⃣ *🎨 Gallery & Media Library*\n` +
      `   _Audio sermons, PDF notes, photo & video highlights_\n`;

    menuBody +=
      `\n────────────────────────────\n` +
      `💡 *Tip:* You can also type any command directly (e.g. *events*, *gallery*, *schedule*, *broadcast*, *offering*, *pending*). Type *help* for full guide.`;

    await this.whatsappService.sendMessage(remoteJid, menuBody);
  }

  /**
   * Send Main Category Menu for Guests / Unregistered Users
   */
  async sendGuestMainMenu(rawPhone: string, remoteJid: string) {
    const isLid = remoteJid.endsWith('@lid');
    const phoneDisplay = !isLid && rawPhone ? ` (${rawPhone})` : '';

    const menuBody =
      `👋 *WELCOME TO DC KUBWA WORKFORCE!*\n` +
      `_...raising leaders that transform society_\n` +
      `────────────────────────────\n` +
      `Hello! You are browsing as a guest/member${phoneDisplay}.\n\n` +
      `📌 *CHOOSE AN OPTION:*\n\n` +
      `1️⃣ *📝 Join Workforce / Register*\n` +
      `   _New to workforce? Reply *1* or *register* to receive the worker registration form_\n\n` +
      `2️⃣ *🏛️ Church Departments*\n` +
      `   _Departments, units & leadership info_\n\n` +
      `3️⃣ *💳 Giving & Projects*\n` +
      `   _Tithe & offering bank accounts, donation drives_\n\n` +
      `4️⃣ *🎨 Gallery & Media Library*\n` +
      `   _Audio sermons, study PDFs & media highlights_\n\n` +
      `────────────────────────────\n` +
      `💡 *Quick Start:* Type *1* or *register* to get the registration form!`;

    await this.whatsappService.sendMessage(remoteJid, menuBody);
  }

  /**
   * Category 1 Sub-menu: Profile & Duty / Onboarding
   */
  async sendProfileSubMenu(worker: Worker | null, remoteJid: string, isAdmin = false) {
    if (!worker && !isAdmin) {
      const text =
        `👤 *WORKER REGISTRATION & STATUS*\n` +
        `────────────────────────────\n` +
        `• Type *register* or *template* — Receive the blank worker registration form\n` +
        `• Type *status* or *info* — Check your worker registration status\n\n` +
        `↩️ Type *menu* to return to the main menu.`;
      await this.whatsappService.sendMessage(remoteJid, text);
      return;
    }

    const text =
      `👤 *MY PROFILE & DUTY*\n` +
      `────────────────────────────\n` +
      `• Type *info* or *status* — View your worker profile & leadership status\n` +
      `• Type *schedule* — View your upcoming department duty schedules\n` +
      `• Type *template* or *register* — Get the blank worker registration form\n\n` +
      `↩️ Type *menu* to return to the main menu.`;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Category 2 Sub-menu: Church Information & Bulletins
   */
  async sendChurchInfoSubMenu(worker: Worker | null, remoteJid: string, isAdmin = false) {
    if (!worker && !isAdmin) {
      const text =
        `🏛️ *CHURCH DEPARTMENTS & INFORMATION*\n` +
        `────────────────────────────\n` +
        `• Type *departments* — Church departments, HODs, units & unit heads\n` +
        `• Type *departments <name>* — Search a specific department (e.g. *departments media*)\n\n` +
        `💡 _Note: Leadership organogram, events & bulletins are available to registered workers. Type *register* to join!_\n\n` +
        `↩️ Type *menu* to return to the main menu.`;
      await this.whatsappService.sendMessage(remoteJid, text);
      return;
    }

    const text =
      `🏛️ *CHURCH INFO & BULLETINS*\n` +
      `────────────────────────────\n` +
      `• Type *departments* — Church departments, HODs, units & unit heads\n` +
      `• Type *organogram* — View church structural organogram\n` +
      `• Type *events* — Upcoming church events & weekly service schedule\n` +
      `• Type *announcements* — Latest church news & bulletins\n\n` +
      `↩️ Type *menu* to return to the main menu.`;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Category 3 Sub-menu: Giving & Projects
   */
  async sendGivingSubMenu(remoteJid: string) {
    const text =
      `💳 *GIVING & DONATION PROJECTS*\n` +
      `────────────────────────────\n` +
      `• Type *offering* or *tithe* — View bank accounts for tithes & offerings\n` +
      `• Type *donations* or *projects* — View active church projects & donation drives\n\n` +
      `↩️ Type *menu* to return to the main menu.`;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Category 4 Sub-menu: Leadership & Approvals
   */
  async sendLeadershipSubMenu(worker: Worker | null, remoteJid: string, isAdmin = false) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* This category is reserved for HODs, Unit Heads, and Administrators.`,
      );
      return;
    }

    let text =
      `👑 *LEADERSHIP, BROADCASTS & APPROVALS*\n` +
      `────────────────────────────\n` +
      `📢 *BROADCAST NOTIFICATIONS:*\n`;

    if (worker?.isUnitHead || isAdmin) {
      text += `• \`broadcast unit <msg>\` — Broadcast to your unit members\n`;
    }
    if (worker?.isHOD || isAdmin) {
      text += `• \`broadcast dept <msg>\` — Broadcast to all department members\n`;
    }
    if (isAdmin) {
      text +=
        `• \`broadcast all <msg>\` — Church-wide broadcast to all workers\n` +
        `• \`broadcast group <name> <msg>\` — Broadcast to custom group\n` +
        `• Type *groups* — View & manage custom broadcast groups\n`;
    }

    text +=
      `\n📝 *ANNOUNCEMENTS & EVENTS:*\n` +
      `• Type *add announcement* — Create a new announcement (with template)\n` +
      `• Type *my announcements* — View & delete your announcements\n` +
      `• Type *add event* — Create an upcoming event (with template)\n` +
      `• Type *my events* — View & delete your events\n\n` +
      `👥 *MEMBERS, SEARCH & APPROVALS:*\n` +
      `• \`search <name/phone/unit>\` — Search workforce members\n` +
      `• Type *members* — View registered workers in your department/unit\n` +
      `• Type *pending* — View pending registrations with quick approve buttons\n` +
      `• Type *accept <#>* or *reject <#>* — Quick approve/reject (e.g. *accept 1*)\n`;

    if (isAdmin || (worker && worker.isHOD)) {
      text += `• Type *make unit head <name> <unit>* — Appoint a Head of Unit\n`;
    }

    if (isAdmin) {
      text +=
        `\n🛠️ *ADMINISTRATOR TOOLS:*\n` +
        `• Type *#stats* — View worker statistics & summary metrics\n` +
        `• Type *#addworkers* — Bulk register workers via text\n` +
        `• Type *#birthdays* — Manually trigger birthday broadcast\n` +
        `• *Excel / CSV Upload* — Send a file to bulk import workers\n`;
    }

    text += `\n↩️ Type *menu* to return to the main menu.`;

    await this.whatsappService.sendMessage(remoteJid, text);
  }

  /**
   * Show all available commands in clean grouped categories (Comprehensive Guide)
   */
  async sendHelpAndCommandsMenu(
    worker: Worker | null,
    remoteJid: string,
    isFirstTime = false,
    isAdmin = false,
  ) {
    if (!worker && !isAdmin) {
      const guestHelp =
        `📖 *DC KUBWA WORKFORCE BOT GUIDE*\n` +
        `────────────────────────────\n` +
        `Hello! You are browsing as a guest/member.\n\n` +
        `📁 *1. 👤 WORKER REGISTRATION*\n` +
        `• *register* or *template* — Get the blank worker registration form\n` +
        `• *status* or *info* — Check your registration status\n\n` +
        `📁 *2. 🏛️ CHURCH INFO*\n` +
        `• *departments* — Church departments, HODs, units & unit heads\n\n` +
        `📁 *3. 💳 GIVING & ACCOUNTS*\n` +
        `• *offering* — Tithe, offering & donation bank accounts\n` +
        `• *donations* — Active church projects & donation drives\n\n` +
        `📁 *4. 🎨 GALLERY & RESOURCES*\n` +
        `• *gallery* (or *4*) — Audio sermons, study PDFs & media\n\n` +
        `────────────────────────────\n` +
        `💡 Type *menu* anytime to access the main menu!`;

      await this.whatsappService.sendMessage(remoteJid, guestHelp);
      return;
    }

    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    const unitText = worker?.unit ? ` (${worker.unit})` : '';
    const leaderTag = worker?.isHOD ? ' (HOD)' : worker?.isUnitHead ? ' (Unit Head)' : '';

    const welcomeHeader = isFirstTime && worker
      ? `🎉 *WELCOME TO DC KUBWA WORKFORCE!*\n` +
        `Hello *${worker.fullName}*, we're glad to have you here.\n` +
        `📌 *Department:* ${worker.department.toUpperCase()}${unitText}${leaderTag}\n` +
        `────────────────────────────\n` +
        `Here is the complete command guide:\n\n`
      : `📖 *DC KUBWA WORKFORCE BOT COMMANDS*\n` +
        `────────────────────────────\n`;

    let helpText =
      welcomeHeader +
      `📁 *1. 👤 MY PROFILE & DUTY*\n` +
      `• *info* or *status* — View profile & leadership status\n` +
      `• *schedule* — View department duty schedule\n` +
      `• *register* / *template* — Worker registration form\n\n` +
      `📁 *2. 🏛️ CHURCH INFORMATION*\n` +
      `• *departments* — Departments, HODs, units & unit heads\n` +
      `• *organogram* — Church leadership structural organogram\n` +
      `• *events* — Upcoming church events & weekly service schedule\n` +
      `• *announcements* — Latest church news & updates\n\n` +
      `📁 *3. 💳 GIVING & PROJECTS*\n` +
      `• *offering* — Tithe, offering & donation bank accounts\n` +
      `• *donations* — Active church projects & donation drives\n`;

    if (isLeader) {
      helpText +=
        `\n📁 *4. 👑 LEADERSHIP, BROADCASTS & APPROVALS*\n` +
        `• \`search <name/phone/unit>\` — Search workforce directory\n` +
        (worker?.isUnitHead || isAdmin ? `• \`broadcast unit <msg>\` — Broadcast to your unit\n` : '') +
        (worker?.isHOD || isAdmin ? `• \`broadcast dept <msg>\` — Broadcast to your department\n` : '') +
        (isAdmin ? `• \`broadcast all <msg>\` — Church-wide broadcast\n• \`broadcast group <name> <msg>\` — Group broadcast\n• *groups* — Manage custom broadcast lists\n` : '') +
        `• *add announcement* / *my announcements* — Create & manage announcements\n` +
        `• *add event* / *my events* — Create & manage upcoming events\n` +
        `• *pending* — View pending registrations with approval buttons\n` +
        `• *members* — View registered workers in your department/unit\n` +
        `• *accept <#>* / *reject <#>* — Quick approve/reject (e.g. *accept 1* or *a1*)\n` +
        (isAdmin || (worker && worker.isHOD)
          ? `• *make unit head <name> <unit>* — Appoint a Head of Unit\n`
          : '');
    }

    helpText +=
      `\n📁 *5. 🎨 GALLERY & RESOURCES*\n` +
      `• *gallery* (or *5*) — Audio sermons, study PDFs & media highlights\n` +
      `• *messages* — Audio sermons & PDF study notes (Coming Soon)\n` +
      `• *media* — Photo albums & video highlights (Coming Soon)\n`;

    if (isAdmin) {
      helpText +=
        `\n📁 *6. 🛠️ ADMINISTRATOR TOOLS*\n` +
        `• *#stats* — Summary metrics & workforce stats\n` +
        `• *#addworkers* — Bulk text registration\n` +
        `• *#birthdays* — Manually trigger birthday broadcast\n` +
        `• *Excel / CSV Upload* — Send spreadsheet to bulk import\n`;
    }

    helpText +=
      `\n────────────────────────────\n` +
      `💡 Type *menu* anytime to view the interactive category menu.`;

    await this.whatsappService.sendMessage(remoteJid, helpText);
  }
}
