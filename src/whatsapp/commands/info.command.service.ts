import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { WorkersService } from '../../workers/workers.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class InfoCommandService {
  constructor(
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * INFO / STATUS -> fetches user info and leadership status for registered worker
   */
  async sendWorkerInfo(worker: Worker, remoteJid: string, isAdmin = false) {
    const hod = await this.workersService.findHodByDepartment(worker.department);
    const hodName = hod ? `${hod.fullName} (${hod.phone})` : 'None currently assigned';

    let leadershipBadge = '👤 Church Worker';
    if (isAdmin && worker.isHOD) {
      leadershipBadge = '👑 Head of Department (HOD) & 🛠️ System Admin';
    } else if (isAdmin && worker.isUnitHead) {
      leadershipBadge = '🎖️ Head of Unit (Unit Head) & 🛠️ System Admin';
    } else if (isAdmin) {
      leadershipBadge = '🛠️ System Administrator';
    } else if (worker.isHOD) {
      leadershipBadge = '👑 Head of Department (HOD)';
    } else if (worker.isUnitHead) {
      leadershipBadge = '🎖️ Head of Unit (Unit Head)';
    }

    const infoText =
      `👤 *WORKER PROFILE & STATUS*\n` +
      `────────────────────────────\n` +
      `• *Full Name:* ${worker.fullName}\n` +
      `• *Phone:* ${worker.phone}\n` +
      `• *Leadership / Role:* ${leadershipBadge}\n` +
      `• *Department:* ${worker.department.toUpperCase()}\n` +
      (worker.unit ? `• *Unit:* ${worker.unit}\n` : '') +
      `• *Official Designation:* ${worker.role || 'Member'}\n` +
      `• *HOD Status:* ${worker.isHOD ? 'Yes (Head of Department) 👑' : 'No'}\n` +
      `• *Unit Head Status:* ${worker.isUnitHead ? 'Yes (Head of Unit) 🎖️' : 'No'}\n` +
      `• *Admin Status:* ${isAdmin ? 'Yes (System Administrator) 🛠️' : 'No'}\n` +
      `• *Marital Status:* ${worker.maritalStatus || 'Not specified'}\n` +
      `• *Attended DLI:* ${worker.attendedDLI || 'Not specified'}\n` +
      `• *Attended DCA:* ${worker.attendedDCA || 'Not specified'}\n` +
      `• *Encounter Retreat:* ${worker.attendedEncounter || 'Not specified'}\n` +
      `• *Full Address:* ${worker.address || 'Not specified'}\n` +
      `• *Date of Birth:* ${worker.birthday || 'Not specified'}\n` +
      `• *Department HOD:* ${hodName}\n` +
      `• *Account Status:* ${worker.isActive ? 'Active ✅' : 'Inactive ❌'}\n\n` +
      `_Type *menu* to return to main menu._`;

    await this.whatsappService.sendMessage(remoteJid, infoText);
  }

  /**
   * INFO / STATUS -> prompt for unregistered user
   */
  async sendUnregisteredInfoPrompt(rawPhone: string, remoteJid: string, isAdmin = false) {
    const isLid = remoteJid.endsWith('@lid');
    const phoneDisplay = !isLid && rawPhone ? ` (${rawPhone})` : '';
    const adminNote = isAdmin ? `\n🛠️ *Admin Status:* Recognized as a System Administrator.\n` : '';

    const text =
      `ℹ️ *WORKER PROFILE & STATUS*\n` +
      `────────────────────────────\n` +
      `Hello! Your phone number${phoneDisplay} is not currently registered as a church worker in the database.${adminNote}\n` +
      `📝 *How to register as a church worker:*\n` +
      `Type *register* or *template* to get the registration form, fill it and send it right here!\n\n` +
      `You can still view church departments, organogram, upcoming events, donations, and offering accounts anytime.\n\n` +
      `_Type *menu* to open the main menu._`;

    await this.whatsappService.sendMessage(remoteJid, text);
  }
}
