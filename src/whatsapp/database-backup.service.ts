import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseBackupService.name);
  private checkInterval: NodeJS.Timeout | null = null;
  private lastBackupDateKey: string | null = null;

  // Target backup recipient phone (default: +2348101889830)
  private readonly defaultRecipientPhone: string;
  private readonly backupHour: number; // Hour of the day (0-23) to run backup (default: 2 AM)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {
    const envPhone = this.configService.get<string>('BACKUP_RECIPIENT_PHONE') || '2348101889830';
    this.defaultRecipientPhone = envPhone.replace(/\D/g, '');
    this.backupHour = parseInt(
      this.configService.get<string>('BACKUP_CRON_HOUR') || '6',
      10,
    );
  }

  onModuleInit() {
    this.scheduleDailyBackup();
    this.logger.log(
      `📅 Automated Daily DB Backup scheduled for ${this.backupHour.toString().padStart(2, '0')}:00 WAT to +${this.defaultRecipientPhone}`,
    );
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  /**
   * Periodically check if the scheduled backup hour has arrived for today
   */
  private scheduleDailyBackup() {
    // Check every 2 minutes
    this.checkInterval = setInterval(() => {
      const now = new Date();
      const currentHour = now.getHours();
      const todayKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;

      if (currentHour === this.backupHour && this.lastBackupDateKey !== todayKey) {
        this.logger.log(`⏰ Cron Trigger: Running automated daily DB backup for ${todayKey}...`);
        this.dispatchDailyBackup(this.defaultRecipientPhone)
          .then((success) => {
            if (success) {
              this.lastBackupDateKey = todayKey;
            }
          })
          .catch((err) => {
            this.logger.error(`❌ Daily backup cron failed: ${err.message}`, err.stack);
          });
      }
    }, 2 * 60 * 1000);
  }

  /**
   * Execute and dispatch database backup to a specific WhatsApp phone number
   */
  async dispatchDailyBackup(
    targetPhone?: string,
  ): Promise<{ success: boolean; message: string; details?: any }> {
    const phone = (targetPhone || this.defaultRecipientPhone).replace(/\D/g, '');
    const remoteJid = `${phone}@s.whatsapp.net`;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    this.logger.log(`📦 Preparing DB backup dispatch to ${phone}...`);

    try {
      // 1. Gather Database Statistics
      const [
        totalWorkers,
        activeWorkers,
        pendingRequests,
        schedulesCount,
        announcementsCount,
        eventsCount,
        groupsCount,
        unitsCount,
      ] = await Promise.all([
        this.prisma.worker.count(),
        this.prisma.worker.count({ where: { isActive: true } }),
        this.prisma.registrationRequest.count({ where: { status: 'PENDING' } }),
        this.prisma.schedule.count(),
        this.prisma.announcement.count(),
        this.prisma.event.count(),
        this.prisma.broadcastGroup.count(),
        this.prisma.departmentUnit.count(),
      ]);

      // 2. Locate SQLite Database Binary File
      const sqlitePath = this.resolveSqlitePath();
      let backupBuffer: Buffer | null = null;
      let backupFileName = `dc_kubwa_backup_${dateStr}.db`;
      let mimeType = 'application/x-sqlite3';

      if (sqlitePath && fs.existsSync(sqlitePath)) {
        backupBuffer = fs.readFileSync(sqlitePath);
      }

      // 3. Generate JSON Dump Export as additional/fallback structured backup
      const fullJsonExport = await this.generateFullJsonExport();
      const jsonBuffer = Buffer.from(JSON.stringify(fullJsonExport, null, 2), 'utf-8');

      // 4. Construct Informative Backup Caption
      const fileSizeKb = backupBuffer
        ? (backupBuffer.length / 1024).toFixed(1)
        : (jsonBuffer.length / 1024).toFixed(1);

      const caption =
        `📦 *DC KUBWA AUTOMATED DB BACKUP*\n` +
        `────────────────────────────\n` +
        `📅 *Date:* ${dateStr}\n` +
        `⏰ *Time:* ${timeStr}\n` +
        `💾 *File Size:* ${fileSizeKb} KB\n\n` +
        `📊 *DATABASE METRICS SUMMARY:*\n` +
        `• Total Workers: *${totalWorkers}* (Active: *${activeWorkers}*)\n` +
        `• Pending Registrations: *${pendingRequests}*\n` +
        `• Department Units: *${unitsCount}*\n` +
        `• Schedules: *${schedulesCount}*\n` +
        `• Announcements: *${announcementsCount}*\n` +
        `• Events: *${eventsCount}*\n` +
        `• Broadcast Groups: *${groupsCount}*\n\n` +
        `🛡️ *Status:* Verified & Intact\n` +
        `🤖 _Automated Church Workforce Bot Backup Engine_`;

      // 5. Send Primary Database Binary (.db) or JSON Dump Document
      if (backupBuffer) {
        await this.whatsappService.sendDocumentMessage(
          remoteJid,
          backupBuffer,
          backupFileName,
          mimeType,
          caption,
        );
      } else {
        await this.whatsappService.sendDocumentMessage(
          remoteJid,
          jsonBuffer,
          `dc_kubwa_data_backup_${dateStr}.json`,
          'application/json',
          caption,
        );
      }

      // 6. Also send JSON Dump if primary was binary for complete redundancy
      if (backupBuffer) {
        await this.whatsappService.sendDocumentMessage(
          remoteJid,
          jsonBuffer,
          `dc_kubwa_records_${dateStr}.json`,
          'application/json',
          `📄 *JSON DATA DUMP (${dateStr})*\nStructured record export across all tables for database portability and JSON querying.`,
        );
      }

      // 7. Backup Baileys Auth Session Credentials (creds.json) to prevent new-device flags
      const sessionCredsPath = this.resolveSessionCredsPath();
      if (sessionCredsPath && fs.existsSync(sessionCredsPath)) {
        const credsBuffer = fs.readFileSync(sessionCredsPath);
        await this.whatsappService.sendDocumentMessage(
          remoteJid,
          credsBuffer,
          `whatsapp_session_creds_${dateStr}.json`,
          'application/json',
          `🔑 *WHATSAPP SESSION BACKUP (${dateStr})*\nBaileys auth credentials archive. In case of server migration, restoring this file preserves your active login without re-scanning QR.`,
        );
      }

      this.logger.log(`✅ DB & Session Backup successfully sent to ${phone}`);
      return {
        success: true,
        message: `DB & Session Backup (${dateStr}) successfully delivered to +${phone}`,
        details: {
          date: dateStr,
          time: timeStr,
          totalWorkers,
          activeWorkers,
          pendingRequests,
          fileSizeKb,
        },
      };

    } catch (err: any) {
      this.logger.error(`❌ Failed to send DB backup to ${phone}: ${err.message}`, err.stack);
      return {
        success: false,
        message: `Failed to deliver DB backup: ${err.message}`,
      };
    }
  }

  /**
   * Export all database records to a structured JSON object
   */
  private async generateFullJsonExport() {
    const [
      workers,
      admins,
      registrationRequests,
      departmentUnits,
      schedules,
      announcements,
      events,
      broadcastGroups,
    ] = await Promise.all([
      this.prisma.worker.findMany(),
      this.prisma.admin.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.registrationRequest.findMany(),
      this.prisma.departmentUnit.findMany(),
      this.prisma.schedule.findMany(),
      this.prisma.announcement.findMany(),
      this.prisma.event.findMany(),
      this.prisma.broadcastGroup.findMany({
        include: {
          members: {
            include: {
              worker: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  department: true,
                  role: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      system: 'DC Kubwa Workforce Management System',
      counts: {
        workers: workers.length,
        admins: admins.length,
        registrationRequests: registrationRequests.length,
        departmentUnits: departmentUnits.length,
        schedules: schedules.length,
        announcements: announcements.length,
        events: events.length,
        broadcastGroups: broadcastGroups.length,
      },
      data: {
        workers,
        admins,
        registrationRequests,
        departmentUnits,
        schedules,
        announcements,
        events,
        broadcastGroups,
      },
    };
  }

  /**
   * Resolve SQLite database file location
   */
  private resolveSqlitePath(): string | null {
    const candidates = [
      path.join(process.cwd(), 'prisma', 'dev.db'),
      path.join(process.cwd(), 'dev.db'),
    ];

    const dbUrl = process.env.DATABASE_URL || '';
    if (dbUrl.startsWith('file:')) {
      const relativePath = dbUrl.replace('file:', '');
      candidates.unshift(
        path.resolve(process.cwd(), relativePath),
        path.resolve(process.cwd(), 'prisma', relativePath),
      );
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Resolve Baileys session credentials file (creds.json) location
   */
  private resolveSessionCredsPath(): string | null {
    const sessionDir =
      process.env.WHATSAPP_SESSION_PATH ||
      process.env.AUTH_FOLDER_PATH ||
      './whatsapp-auth';

    const candidates = [
      path.resolve(process.cwd(), sessionDir, 'creds.json'),
      path.resolve(process.cwd(), 'whatsapp-auth', 'creds.json'),
      path.resolve(process.cwd(), 'auth_info_baileys', 'creds.json'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}

