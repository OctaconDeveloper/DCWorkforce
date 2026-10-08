import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { WorkersService } from '../../workers/workers.service';
import { WhatsappService } from '../whatsapp.service';
import { Department } from '../../common/enums/department.enum';

@Injectable()
export class RegistrationCommandService {
  private readonly logger = new Logger(RegistrationCommandService.name);

  constructor(
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Send empty member registration template with sample
   */
  async sendRegistrationTemplate(remoteJid: string) {
    const template =
      `📋 *MEMBER REGISTRATION TEMPLATE*\n` +
      `────────────────────────────\n` +
      `Copy, fill in the details and send back:\n\n` +
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
      `9. Full Address: 123 Sample Street, City\n` +
      `10. Date of Birth: 15 June\n\n` +
      `_Tip: You can paste multiple member blocks separated by a blank line._`;

    await this.whatsappService.sendMessage(remoteJid, template);
  }

  /**
   * Handle formatted member registration submission
   */
  async handleRegistrationFormSubmission(
    messageText: string,
    senderPhone: string,
    remoteJid: string,
    isAdmin: boolean,
    lid?: string | null,
    onBulkAdd?: (text: string, jid: string) => Promise<void>,
  ) {
    try {
      const blocks = this.workersService.splitIntoMemberBlocks(messageText);
      if (blocks.length > 1 && isAdmin && onBulkAdd) {
        await onBulkAdd(messageText, remoteJid);
        return;
      }

      const cleanSenderPhone = senderPhone && !senderPhone.includes('@lid') ? senderPhone : undefined;
      const analysis = await this.workersService.analyzeRegistrationForm(messageText, cleanSenderPhone);

      // Check if critical fields (Full Name, Phone) are missing or invalid
      if (!analysis.isValid || !analysis.data.fullName) {
        let errorHeader = `⚠️ *INCOMPLETE / INVALID REGISTRATION FORM*\n\n`;

        if (!analysis.deptValidation.isValidDept && analysis.data.department) {
          errorHeader +=
            `❌ *INVALID DEPARTMENT:* "${analysis.data.department}"\n` +
            `Type *departments* to see the list of registered departments.\n\n`;
        } else if (!analysis.deptValidation.isValidUnit && analysis.data.unit) {
          errorHeader +=
            `❌ *INVALID UNIT FOR ${analysis.data.department?.toUpperCase() || 'DEPARTMENT'}:* "${analysis.data.unit}"\n` +
            `Official Units: ${analysis.deptValidation.availableUnits.join(', ')}\n\n`;
        }

        let receivedSection = '';
        if (analysis.received.length > 0) {
          receivedSection =
            `📥 *WHAT WE RECEIVED FROM YOU:*\n` +
            analysis.received.map((r) => `• ✅ *${r.field}:* ${r.value}`).join('\n') +
            `\n\n`;
        }

        let missingSection = '';
        if (analysis.missing.length > 0) {
          missingSection =
            `⚠️ *MISSING FROM YOUR SUBMISSION:*\n` +
            analysis.missing.map((m) => `• ❌ *${m.field}* (e.g. _${m.example}_)`).join('\n') +
            `\n\n`;
        }

        const phoneVal = analysis.data.phone || cleanSenderPhone || '';
        const suggestedUnit =
          analysis.deptValidation.availableUnits.length > 0
            ? analysis.deptValidation.availableUnits[0]
            : 'Sound';

        const prefilledTemplate =
          `📋 *PLEASE COPY, COMPLETE & RESEND:* \n` +
          `1. Full Name: ${analysis.data.fullName || ''}\n` +
          `2. Marital Status: ${analysis.data.maritalStatus || 'Single'}\n` +
          `3. Department: ${analysis.data.department || 'Media'}\n` +
          `4. Unit: ${analysis.data.unit || suggestedUnit}\n` +
          `5. Have you attended DLI?: ${analysis.data.attendedDLI || 'Yes'}\n` +
          `6. Have you attended DCA?: ${analysis.data.attendedDCA || 'Yes'}\n` +
          `7. Phone Number: ${phoneVal}\n` +
          `8. Encounter retreat: Attended: ${analysis.data.attendedEncounter || 'yes'}\n` +
          `9. Full Address: ${analysis.data.address || ''}\n` +
          `10. Date of Birth: ${analysis.data.birthday || '15 June'}`;

        await this.whatsappService.sendMessage(
          remoteJid,
          errorHeader + receivedSection + missingSection + prefilledTemplate,
        );
        return;
      }

      // Check sender identity and role
      const normalizedSender = senderPhone ? this.workersService.normalizePhoneNumber(senderPhone) : null;
      const senderWorker = await this.workersService.findByPhoneOrLid(normalizedSender, lid);

      const targetDept = this.workersService.normalizeDepartment(analysis.data.department);
      const targetUnit = analysis.data.unit?.trim().toLowerCase() || '';

      // Determine Auto-Acceptance / Express Entry:
      // 1. System Admin: Express entry for any department / unit
      // 2. Head of Department (HOD): Auto-accepted IF target department matches HOD's department
      // 3. Head of Unit (Unit Head): Auto-accepted IF target department AND target unit match HOU's
      let isAutoAccepted = false;
      let authorizedBy = '';

      if (isAdmin) {
        isAutoAccepted = true;
        authorizedBy = 'System Admin (Express Entry)';
      } else if (senderWorker?.isHOD && senderWorker.department === targetDept) {
        isAutoAccepted = true;
        authorizedBy = `HOD ${senderWorker.fullName} (${targetDept.toUpperCase()})`;
      } else if (
        senderWorker?.isUnitHead &&
        senderWorker.department === targetDept &&
        (!senderWorker.unit || senderWorker.unit.trim().toLowerCase() === targetUnit)
      ) {
        isAutoAccepted = true;
        authorizedBy = `Unit Head ${senderWorker.fullName} (${senderWorker.unit})`;
      }

      // ==========================================
      // A. DIRECT / AUTO-ACCEPTED REGISTRATION
      // ==========================================
      if (isAutoAccepted) {
        const applicantLid = cleanSenderPhone === analysis.data.phone ? lid : undefined;
        const { worker, isNew } = await this.workersService.upsertWorkerFromForm(analysis.data, applicantLid);
        const title = isNew ? '✅ *WORKER REGISTRATION SUCCESSFUL!*' : '🔄 *WORKER PROFILE UPDATED!*';

        const senderReceipt =
          `${title}\n` +
          `────────────────────────────\n` +
          `• *Full Name:* ${worker.fullName}\n` +
          `• *Phone:* ${worker.phone}\n` +
          `• *Department:* ${worker.department.toUpperCase()} (${worker.role})\n` +
          (worker.unit ? `• *Unit:* ${worker.unit}\n` : '') +
          `• *Authorized By:* ${authorizedBy}\n` +
          `• *Marital Status:* ${worker.maritalStatus || 'Not specified'}\n` +
          `• *Attended DLI:* ${worker.attendedDLI || 'Not specified'}\n` +
          `• *Attended DCA:* ${worker.attendedDCA || 'Not specified'}\n` +
          `• *Encounter Retreat:* ${worker.attendedEncounter || 'Not specified'}\n` +
          `• *Full Address:* ${worker.address || 'Not specified'}\n` +
          `• *Date of Birth:* ${worker.birthday || 'Not specified'}\n\n` +
          `_Type *menu* to open the main menu._`;

        await this.whatsappService.sendMessage(remoteJid, senderReceipt);

        // If a leader registered another person, notify that worker on WhatsApp
        const normalizedApplicantPhone = this.workersService.normalizePhoneNumber(worker.phone);
        if (normalizedSender && normalizedSender !== normalizedApplicantPhone) {
          const applicantJid = worker.lid || `${normalizedApplicantPhone}@s.whatsapp.net`;
          await this.whatsappService.sendMessage(
            applicantJid,
            `🎉 *WELCOME TO DC KUBWA WORKFORCE!*\n` +
            `────────────────────────────\n` +
            `Hello *${worker.fullName}*, you have been officially registered as a church worker in Dominion City Kubwa!\n\n` +
            `📌 *Department:* ${worker.department.toUpperCase()}\n` +
            (worker.unit ? `📌 *Unit:* ${worker.unit}\n` : '') +
            `\nType *menu* or *help* anytime to view your profile, duty schedules, and announcements!`,
          );
        }
        return;
      }

      // ==========================================
      // B. PENDING REGISTRATION WORKFLOW
      // ==========================================
      const request = await this.workersService.createRegistrationRequest(analysis.data, lid);
      const shortId = request.id.substring(0, 8);

      // 1. Send receipt ONLY to the applicant/submitter (receipt confirmation, NOT the leader review alert)
      const applicantNotice =
        `📨 *REGISTRATION REQUEST SUBMITTED!*\n` +
        `────────────────────────────\n` +
        `Thank you *${request.fullName}*! Your registration details have been submitted.\n\n` +
        `📌 *Department:* ${request.department.toUpperCase()}\n` +
        `📌 *Unit:* ${request.unit}\n` +
        `⏳ *Status:* Pending Approval from your Department Head (HOD) / Admin.\n\n` +
        `You will receive an instant notification here on WhatsApp once your registration is approved!\n\n` +
        `_Type *menu* to return._`;

      await this.whatsappService.sendMessage(remoteJid, applicantNotice);

      // 2. Notify the HOD of that department (and admins) with approval actions
      const hod = await this.workersService.findHodByDepartment(request.department);
      const leaderAlert =
        `🔔 *NEW WORKER REGISTRATION REQUEST*\n` +
        `────────────────────────────\n` +
        `A new member has submitted a registration request for *${request.department.toUpperCase()}* department:\n\n` +
        `• *Full Name:* ${request.fullName}\n` +
        `• *Phone:* ${request.phone}\n` +
        `• *Department:* ${request.department.toUpperCase()}\n` +
        `• *Unit:* ${request.unit}\n` +
        `• *Marital Status:* ${request.maritalStatus || 'Not specified'}\n` +
        `• *Attended DLI:* ${request.attendedDLI || 'Not specified'}\n` +
        `• *Attended DCA:* ${request.attendedDCA || 'Not specified'}\n` +
        `• *Encounter Retreat:* ${request.attendedEncounter || 'Not specified'}\n` +
        `• *Address:* ${request.address || 'Not specified'}\n` +
        `• *Birthday:* ${request.birthday || 'Not specified'}\n\n` +
        `────────────────────────────\n` +
        `👉 *Tap a button below*, or reply:\n` +
        `• *accept* (or *1*) to Approve\n` +
        `• *reject* (or *2*) to Decline`;

      const normalizedApplicantPhone = this.workersService.normalizePhoneNumber(request.phone);

      // Send to HOD if registered and NOT the applicant themselves
      if (hod) {
        const hodPhone = this.workersService.normalizePhoneNumber(hod.phone);
        const hodJid = hod.lid || `${hodPhone}@s.whatsapp.net`;
        if (hodPhone !== normalizedApplicantPhone && hodJid !== remoteJid) {
          await this.whatsappService.sendInteractiveButtons(hodJid, {
            title: '🔔 New Worker Registration',
            text: leaderAlert,
            buttons: [
              { id: `accept_${request.id}`, text: '✅ Approve' },
              { id: `reject_${request.id}`, text: '❌ Reject' },
            ],
          });
        }
      } else {
        this.logger.warn(`No HOD registered for ${request.department} to approve request ${request.id}`);
      }
    } catch (err: any) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Registration Failed:* ${err.message || 'An error occurred while saving the worker details.'}`,
      );
    }
  }
}
