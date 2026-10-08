import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DepartmentsService } from '../../departments/departments.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class OrganogramCommandService {
  constructor(
    private readonly departmentsService: DepartmentsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * ORGANOGRAM -> show church structural organogram
   */
  async sendOrganogram(remoteJid: string) {
    const text = this.departmentsService.formatOrganogramText();
    await this.whatsappService.sendMessage(remoteJid, text);
  }
}
