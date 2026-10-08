import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DepartmentsService } from '../../departments/departments.service';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class DepartmentsCommandService {
  constructor(
    private readonly departmentsService: DepartmentsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * DEPARTMENTS -> show list of departments, HOD, and units + unit heads
   */
  async sendDepartmentsAndUnits(remoteJid: string, specificDept?: string) {
    const text = this.departmentsService.formatDepartmentsAndUnitsText(specificDept);
    await this.whatsappService.sendMessage(remoteJid, text);
  }
}
