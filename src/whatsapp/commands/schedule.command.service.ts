import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { SchedulesService } from '../../schedules/schedules.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class ScheduleCommandService {
  constructor(
    private readonly schedulesService: SchedulesService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * SCHEDULE -> show upcoming duty schedules for worker's department
   */
  async sendWorkerSchedule(worker: Worker, remoteJid: string) {
    const schedules = await this.schedulesService.findUpcomingForDepartment(
      worker.department,
      5,
    );

    if (!schedules || schedules.length === 0) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `📅 *UPCOMING DUTY SCHEDULES*\n────────────────────────────\n` +
        `No upcoming duty schedules found for *${worker.department.toUpperCase()}* department.\n\n` +
        `_Type *menu* to return._`,
      );
      return;
    }

    let response = `📅 *UPCOMING DUTY SCHEDULES (${worker.department.toUpperCase()})*\n────────────────────────────\n`;

    schedules.forEach((sch, index) => {
      response += `\n*${index + 1}. ${sch.title}*\n`;
      response += `🗓️ Date: ${sch.date} | ⏰ Time: ${sch.time}\n`;
      response += `📍 Venue: ${sch.venue}\n`;
      if (sch.description) {
        response += `📝 Details: ${sch.description}\n`;
      }
    });

    response += `\n────────────────────────────\n_Type *menu* to return._`;
    await this.whatsappService.sendMessage(remoteJid, response);
  }

  /**
   * Schedule prompt for unregistered users
   */
  async sendUnregisteredSchedulePrompt(remoteJid: string) {
    await this.whatsappService.sendMessage(
      remoteJid,
      `📅 *DUTY SCHEDULES*\n────────────────────────────\n` +
      `Duty rosters are organized by church departments.\n\n` +
      `To view your specific duty assignments, you must be a registered church worker.\n\n` +
      `Type *register* to fill the worker registration form or type *events* to see upcoming church-wide services!`,
    );
  }
}
