import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { proto, downloadMediaMessage, WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import { AdminService } from '../../admin/admin.service';
import { WorkersService } from '../../workers/workers.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class AdminCommandService {
  constructor(
    private readonly adminService: AdminService,
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Check if a phone number belongs to an Admin
   */
  async checkIsAdmin(phone: string): Promise<boolean> {
    try {
      const admin = await this.adminService.findByPhone(phone);
      return Boolean(admin);
    } catch {
      return false;
    }
  }

  /**
   * Admin Stats Overview
   */
  async handleAdminStats(remoteJid: string) {
    const stats = await this.adminService.getStats();
    let statsMsg =
      `📊 *CHURCH WORKERS SYSTEM METRICS*\n` +
      `───────────────────\n` +
      `• *Total Registered Workers:* ${stats.totalWorkers}\n` +
      `• *Active Workers:* ${stats.activeWorkers}\n` +
      `• *Upcoming Duty Schedules:* ${stats.upcomingSchedules}\n` +
      `• *Active Announcements:* ${stats.activeAnnouncements}\n\n` +
      `🏛️ *Workers By Department:*\n`;

    for (const [dept, count] of Object.entries(stats.workersByDepartment)) {
      statsMsg += `• ${dept.toUpperCase()}: *${count}*\n`;
    }

    await this.whatsappService.sendMessage(remoteJid, statsMsg);
  }

  /**
   * Admin Feature: Bulk add workers via WhatsApp text command
   */
  async handleAdminBulkAddText(messageText: string, remoteJid: string) {
    await this.whatsappService.sendMessage(remoteJid, '⏳ *Processing batch workers import...*');

    try {
      const result = await this.workersService.importFromText(messageText);

      let summary =
        `📋 *ADMIN BULK IMPORT REPORT*\n` +
        `───────────────────\n` +
        `• Total Processed: *${result.total}*\n` +
        `• ✅ Created: *${result.created}*\n` +
        `• 🔄 Updated: *${result.updated}*\n` +
        `• ❌ Failed: *${result.failed}*\n`;

      if (result.errors.length > 0) {
        summary += `\n⚠️ *Errors:*\n`;
        result.errors.slice(0, 5).forEach((e) => {
          summary += `• Row ${e.row} [${e.identifier}]: ${e.error}\n`;
        });
        if (result.errors.length > 5) {
          summary += `• ...and ${result.errors.length - 5} more.\n`;
        }
      }

      await this.whatsappService.sendMessage(remoteJid, summary);
    } catch (err: any) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Import Failed:* ${err.message || 'Unknown error occurred'}`,
      );
    }
  }

  /**
   * Admin Feature: Bulk add workers via attached Excel / CSV document
   */
  async handleAdminDocumentUpload(
    msg: proto.IWebMessageInfo,
    remoteJid: string,
    sock: WASocket | null,
  ) {
    if (!sock) return;

    await this.whatsappService.sendMessage(remoteJid, '📥 *Downloading and processing document...*');

    try {
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage,
        },
      )) as Buffer;

      const fileName = msg.message?.documentMessage?.fileName || 'upload.csv';
      const result = await this.workersService.importFromBuffer(buffer);

      let summary =
        `📋 *SPREADSHEET IMPORT REPORT (${fileName})*\n` +
        `───────────────────\n` +
        `• Total Processed: *${result.total}*\n` +
        `• ✅ Created: *${result.created}*\n` +
        `• 🔄 Updated: *${result.updated}*\n` +
        `• ❌ Failed: *${result.failed}*\n`;

      if (result.errors.length > 0) {
        summary += `\n⚠️ *Errors:*\n`;
        result.errors.slice(0, 5).forEach((e) => {
          summary += `• Row ${e.row} [${e.identifier}]: ${e.error}\n`;
        });
        if (result.errors.length > 5) {
          summary += `• ...and ${result.errors.length - 5} more.\n`;
        }
      }

      await this.whatsappService.sendMessage(remoteJid, summary);
    } catch (err: any) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `❌ *Document Import Failed:* ${err.message || 'Could not parse document'}`,
      );
    }
  }
}
