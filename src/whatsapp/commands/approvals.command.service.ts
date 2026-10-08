import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { WorkersService } from '../../workers/workers.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class ApprovalsCommandService {
  constructor(
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Action: View Pending Registration Requests (Admin, HOD, and Unit Heads)
   */
  async handleViewPendingRequests(
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isAuthorized = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    if (!isAuthorized) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Access Denied:* Only Department Heads, Unit Heads, and System Administrators can view and approve pending registrations.`,
      );
      return;
    }

    const pendingRequests = isAdmin
      ? await this.workersService.findPendingRequestsForAdmin()
      : await this.workersService.findPendingRequestsForLeader(worker!);

    let deptContext = 'ALL DEPARTMENTS';
    if (!isAdmin && worker) {
      deptContext = worker.isHOD
        ? `${worker.department.toUpperCase()} DEPARTMENT`
        : `${worker.department.toUpperCase()} - ${worker.unit?.toUpperCase() || 'UNIT'}`;
    }

    if (pendingRequests.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📋 *PENDING REGISTRATION REQUESTS*\n───────────────────────────\nNo pending registration requests for *${deptContext}*.\n\n_Type *menu* to return._`,
      );
      return;
    }

    if (pendingRequests.length === 1) {
      const req = pendingRequests[0];
      const singleText =
        `📋 *PENDING REGISTRATION — ${deptContext}*\n` +
        `───────────────────────────\n` +
        `• *Full Name:* ${req.fullName}\n` +
        `• *Phone:* ${req.phone}\n` +
        `• *Department:* ${req.department.toUpperCase()}\n` +
        `• *Unit:* ${req.unit}\n` +
        (req.maritalStatus ? `• *Marital Status:* ${req.maritalStatus}\n` : '') +
        (req.birthday ? `• *Birthday:* ${req.birthday}\n` : '') +
        (req.address ? `• *Address:* ${req.address}\n` : '') +
        `\n───────────────────────────\n` +
        `👉 *Tap a button below*, or reply:\n` +
        `• *accept* (or *1*) to Approve\n` +
        `• *reject* (or *2*) to Decline`;

      await this.whatsappService.sendInteractiveButtons(remoteJid, {
        title: '📋 Pending Worker Approval',
        text: singleText,
        buttons: [
          { id: `accept_${req.id}`, text: '✅ Approve' },
          { id: `reject_${req.id}`, text: '❌ Reject' },
        ],
      });
      return;
    }

    let message =
      `📋 *PENDING REGISTRATIONS — ${deptContext} (${pendingRequests.length})*\n` +
      `───────────────────────────\n`;

    for (let i = 0; i < pendingRequests.length; i++) {
      const req = pendingRequests[i];
      message +=
        `\n*${i + 1}. ${req.fullName.toUpperCase()}*\n` +
        `• *Phone:* ${req.phone}\n` +
        `• *Dept:* ${req.department.toUpperCase()} | *Unit:* ${req.unit}\n` +
        `• *Actions:* Send *accept ${i + 1}* or *reject ${i + 1}*\n`;
    }

    message +=
      `\n───────────────────────────\n` +
      `💡 *QUICK ACTIONS:*\n` +
      `• To Approve: Send *accept <number>* (e.g. *accept 1*)\n` +
      `• To Reject: Send *reject <number>* (e.g. *reject 1*)\n` +
      `• Or tap the buttons below for Item #1`;

    const firstReq = pendingRequests[0];
    await this.whatsappService.sendInteractiveButtons(remoteJid, {
      title: '📋 Pending Worker Approvals',
      text: message,
      buttons: [
        { id: `accept_${firstReq.id}`, text: `✅ Approve #1 (${firstReq.fullName.split(' ')[0]})` },
        { id: `reject_${firstReq.id}`, text: `❌ Reject #1` },
      ],
    });
  }

  /**
   * Action: View List of Members (Admin, HOD, and Unit Heads)
   * - Admin sees all workers across all departments
   * - HOD sees all workers in their department
   * - Unit Head sees all workers in their unit
   */
  async handleViewMembers(
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isAuthorized = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));

    if (!isAuthorized) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Access Denied:* Only Department Heads, Unit Heads, and System Administrators can view the workforce member directory.`,
      );
      return;
    }

    const members = isAdmin
      ? await this.workersService.findMembersForAdmin()
      : await this.workersService.findMembersForLeader(worker!);

    let scopeLabel = 'ALL DEPARTMENTS & UNITS';
    if (!isAdmin && worker) {
      scopeLabel = worker.isHOD
        ? `${worker.department.toUpperCase()} DEPARTMENT`
        : `${worker.department.toUpperCase()} (${worker.unit || 'UNIT'})`;
    }

    if (members.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `👥 *WORKFORCE DIRECTORY — ${scopeLabel}*\n───────────────────────────\nNo registered workers found in this scope.\n\n_Type *menu* to return._`,
      );
      return;
    }

    let message =
      `👥 *WORKFORCE DIRECTORY — ${scopeLabel} (${members.length})*\n` +
      `───────────────────────────\n`;

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const leaderTag = m.isHOD ? ' [👑 HOD]' : m.isUnitHead ? ' [🎖️ Unit Head]' : '';
      const unitText = m.unit ? ` | Unit: ${m.unit}` : '';
      message +=
        `\n*${i + 1}. ${m.fullName.toUpperCase()}*${leaderTag}\n` +
        `• *Phone:* ${m.phone}\n` +
        `• *Dept:* ${m.department.toUpperCase()}${unitText}\n` +
        `• *Role:* ${m.role || 'Member'}\n`;
    }

    message += `\n───────────────────────────\n_Type *menu* to return to the main menu._`;
    await this.whatsappService.sendMessage(remoteJid, message);
  }

  /**
   * Action: Approve Registration Request (Admin, HOD, and Unit Heads)
   */
  async handleApproveRegistrationRequest(
    identifier: string | undefined,
    reviewer: Worker | null,
    remoteJid: string,
    isAdmin = false,
    quotedText?: string,
  ) {
    const isAuthorized = Boolean(isAdmin || (reviewer && (reviewer.isHOD || reviewer.isUnitHead)));

    if (!isAuthorized) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Access Denied:* Only Department Heads, Unit Heads, and System Administrators can approve registrations.`,
      );
      return;
    }

    try {
      const request = await this.workersService.resolvePendingRequest(
        identifier,
        reviewer,
        isAdmin,
        quotedText,
      );

      if (!request) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *No Matching Request Found*\n───────────────────────────\nCould not identify which pending registration to approve.\n\n_Type *pending* to view active pending requests and their numbers (e.g. *accept 1*)._`,
        );
        return;
      }

      const reviewerObj = isAdmin
        ? { fullName: reviewer?.fullName || 'System Admin', isAdmin: true }
        : reviewer!;

      const { worker } = await this.workersService.approveRegistrationRequest(
        request.id,
        reviewerObj,
      );

      await this.whatsappService.sendMessage(
        remoteJid,
        `✅ *REGISTRATION APPROVED!*\n───────────────────────────\n` +
        `• *Full Name:* ${worker.fullName}\n` +
        `• *Phone:* ${worker.phone}\n` +
        `• *Department:* ${worker.department.toUpperCase()} (${worker.unit})\n` +
        `• *Approved By:* ${reviewerObj.fullName}\n\n` +
        `The applicant has been successfully activated as a church worker and notified on WhatsApp!`,
      );

      // Notify the applicant of approval
      const applicantJid = worker.lid || `${this.workersService.normalizePhoneNumber(worker.phone)}@s.whatsapp.net`;
      await this.whatsappService.sendMessage(
        applicantJid,
        `🎉 *CONGRATULATIONS, ${worker.fullName.toUpperCase()}!*\n` +
        `───────────────────────────\n` +
        `Your registration request for *${worker.department.toUpperCase()}* department has been approved!\n\n` +
        `You are now officially registered as a church worker in Dominion City Kubwa.\n\n` +
        `📌 *Department:* ${worker.department.toUpperCase()}\n` +
        (worker.unit ? `📌 *Unit:* ${worker.unit}\n` : '') +
        `\nType *menu* to explore your schedules, announcements, and commands!`,
      );
    } catch (err: any) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Approval Failed:* ${err.message || 'Could not approve registration.'}`,
      );
    }
  }

  /**
   * Action: Reject Registration Request (Admin, HOD, and Unit Heads)
   */
  async handleRejectRegistrationRequest(
    identifier: string | undefined,
    reviewer: Worker | null,
    remoteJid: string,
    isAdmin = false,
    quotedText?: string,
  ) {
    const isAuthorized = Boolean(isAdmin || (reviewer && (reviewer.isHOD || reviewer.isUnitHead)));

    if (!isAuthorized) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Access Denied:* Only Department Heads, Unit Heads, and System Administrators can reject registrations.`,
      );
      return;
    }

    try {
      const request = await this.workersService.resolvePendingRequest(
        identifier,
        reviewer,
        isAdmin,
        quotedText,
      );

      if (!request) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *No Matching Request Found*\n───────────────────────────\nCould not identify which pending registration to decline.\n\n_Type *pending* to view active pending requests and their numbers (e.g. *reject 1*)._`,
        );
        return;
      }

      const reviewerObj = isAdmin
        ? { fullName: reviewer?.fullName || 'System Admin', isAdmin: true }
        : reviewer!;

      const rejectedReq = await this.workersService.rejectRegistrationRequest(
        request.id,
        reviewerObj,
      );

      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *REGISTRATION DECLINED*\n───────────────────────────\n` +
        `• *Applicant:* ${rejectedReq.fullName}\n` +
        `• *Department:* ${rejectedReq.department.toUpperCase()} (${rejectedReq.unit})\n` +
        `• *Declined By:* ${reviewerObj.fullName}\n\n` +
        `The registration request has been marked as rejected.`,
      );

      // Notify the applicant
      const applicantJid = rejectedReq.lid || `${this.workersService.normalizePhoneNumber(rejectedReq.phone)}@s.whatsapp.net`;
      await this.whatsappService.sendMessage(
        applicantJid,
        `ℹ️ *REGISTRATION UPDATE*\n───────────────────────────\n` +
        `Hello ${rejectedReq.fullName}, your registration request for *${rejectedReq.department.toUpperCase()}* department was not approved at this time.\n\n` +
        `Please contact your department leadership for further assistance.`,
      );
    } catch (err: any) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Rejection Failed:* ${err.message || 'Could not decline registration.'}`,
      );
    }
  }

  /**
   * Action: Appoint a member as Head of Unit (HOD can appoint within their department, Admin church-wide)
   */
  async handleAppointUnitHead(
    commandText: string,
    actor: Worker | null,
    remoteJid: string,
    isAdmin = false,
  ) {
    const isAuthorized = Boolean(isAdmin || (actor && actor.isHOD));

    if (!isAuthorized) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Access Denied:* Only Department Heads (HOD) and System Administrators can appoint a Head of Unit.`,
      );
      return;
    }

    const dept = actor?.department || 'media';
    const availableUnits = await this.workersService.getUnitsForDepartment(dept);

    // Strip command prefixes
    let params = commandText
      .replace(/^#?make\s+unit\s+head\s*/i, '')
      .replace(/^#?make\s+head\s*/i, '')
      .replace(/^#?set\s+unit\s+head\s*/i, '')
      .replace(/^#?set\s+head\s*/i, '')
      .replace(/^#?appoint\s+unit\s+head\s*/i, '')
      .replace(/^#?appoint\s+head\s*/i, '')
      .replace(/^#?assign\s+unit\s+head\s*/i, '')
      .replace(/^#?setunithead\s*/i, '')
      .replace(/^#?makehou\s*/i, '')
      .trim();

    if (
      !params ||
      params === '10' ||
      params.toLowerCase() === 'unit head' ||
      params.toLowerCase() === 'unithead' ||
      params.toLowerCase() === 'hou'
    ) {
      const unitList = availableUnits.map((u, i) => `${i + 1}. ${u}`).join('\n');
      const helpMsg =
        `🎖️ *APPOINT HEAD OF UNIT (HOU)*\n` +
        `────────────────────────────\n` +
        `As HOD of *${dept.toUpperCase()}* department, you can appoint any member in your department as Head of Unit.\n\n` +
        `📝 *Usage:* \n` +
        `• *make unit head <name or phone> <unit name>*\n` +
        `• E.g.: *make unit head Jessica Sound*\n` +
        `• E.g.: *make unit head 08012345678 IT / Livestream*\n` +
        `• E.g.: *make unit head 1 Sound* _(using number from members list)_\n\n` +
        `🎯 *Official Units in ${dept.toUpperCase()}:*\n` +
        unitList;

      await this.whatsappService.sendMessage(remoteJid, helpMsg);
      return;
    }

    // Determine target worker and target unit from params
    let matchedUnitName: string | null = null;
    let targetWorkerIdent: string = '';

    // Match against known units in department
    for (const u of availableUnits) {
      const uLower = u.toLowerCase();
      const pLower = params.toLowerCase();
      if (pLower.endsWith(uLower)) {
        matchedUnitName = u;
        targetWorkerIdent = params.substring(0, params.length - u.length).trim();
        break;
      }
      const uFirstWord = u.split(/[\s/&-]+/)[0].toLowerCase();
      if (uFirstWord.length >= 3 && pLower.endsWith(uFirstWord)) {
        matchedUnitName = u;
        targetWorkerIdent = params.substring(0, params.length - uFirstWord.length).trim();
        break;
      }
    }

    if (!matchedUnitName) {
      const parts = params.split(/\s+/);
      if (parts.length >= 2) {
        targetWorkerIdent = parts[0];
        matchedUnitName = parts.slice(1).join(' ');
      } else {
        targetWorkerIdent = params;
        matchedUnitName = '';
      }
    }

    try {
      const actorObj = isAdmin
        ? { fullName: actor?.fullName || 'System Admin', isAdmin: true }
        : actor!;

      const result = await this.workersService.appointUnitHead(
        targetWorkerIdent,
        matchedUnitName || '',
        actorObj,
      );

      const successNotice =
        `🎖️ *HEAD OF UNIT APPOINTED!* 🎉\n` +
        `────────────────────────────\n` +
        `• *Full Name:* ${result.worker.fullName}\n` +
        `• *Phone:* ${result.worker.phone}\n` +
        `• *Department:* ${result.worker.department.toUpperCase()}\n` +
        `• *Unit:* ${result.unit}\n` +
        `• *Role:* Head of Unit 🎖️\n` +
        `• *Appointed By:* ${result.appointedBy}\n\n` +
        `The worker's leadership profile has been updated and they have been notified on WhatsApp!`;

      await this.whatsappService.sendMessage(remoteJid, successNotice);

      // Notify the appointed worker on WhatsApp
      const workerJid =
        result.worker.lid ||
        `${this.workersService.normalizePhoneNumber(result.worker.phone)}@s.whatsapp.net`;

      await this.whatsappService.sendMessage(
        workerJid,
        `🎉🎖️ *CONGRATULATIONS, ${result.worker.fullName.toUpperCase()}!* 🎖️🎉\n` +
        `────────────────────────────\n` +
        `You have been appointed as the *Head of Unit (HOU)* in Dominion City Kubwa!\n\n` +
        `📌 *Department:* ${result.worker.department.toUpperCase()}\n` +
        `🎯 *Unit:* ${result.unit}\n` +
        `👑 *Appointed By:* ${result.appointedBy}\n\n` +
        `As Head of Unit, you can now:\n` +
        `• View all members in your unit (*members*)\n` +
        `• View & approve new member registrations for your unit (*pending*)\n` +
        `• Access workforce duty rosters & leadership tools\n\n` +
        `_Type *menu* to explore your updated leadership commands!_`,
      );
    } catch (err: any) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Appointment Failed:* ${err.message || 'Could not appoint Head of Unit.'}`,
      );
    }
  }
}


