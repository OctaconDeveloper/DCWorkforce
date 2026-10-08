import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class OfferingCommandService {
  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * OFFERING -> shows account numbers for offering and tithe
   */
  async sendOfferingAndTithe(remoteJid: string) {
    const offeringText =
      `💳 *DOMINION CITY KUBWA — TITHE, OFFERING & GIVING ACCOUNTS*\n` +
      `────────────────────────────\n` +
      `_"Bring the whole tithe into the storehouse, that there may be food in my house..." — Malachi 3:10_\n\n` +
      `Please use the following verified church bank accounts for your transfers:\n\n` +
      `🏦 *ACCOUNT 1: TITHE & GENERAL OFFERINGS*\n` +
      `• Bank Name: *Zenith Bank*\n` +
      `• Account Name: *Dominion City Kubwa*\n` +
      `• Account Number: *1012345678*\n\n` +
      `🏗️ *ACCOUNT 2: BUILDING & CHURCH EXPANSION PROJECT*\n` +
      `• Bank Name: *Zenith Bank*\n` +
      `• Account Name: *Dominion City Kubwa Building*\n` +
      `• Account Number: *1018765432*\n\n` +
      `❤️ *ACCOUNT 3: WELFARE & GOLDEN HEART OUTREACH*\n` +
      `• Bank Name: *Zenith Bank*\n` +
      `• Account Name: *Dominion City Kubwa Welfare*\n` +
      `• Account Number: *1019876543*\n\n` +
      `────────────────────────────\n` +
      `📌 *Transfer Note:* Please put the purpose of transfer in the narration (e.g. _Tithe_, _Offering_, _Building_, or _Welfare_).\n\n` +
      `May the Lord richly bless your seeds and cheerful giving! 🙏`;

    await this.whatsappService.sendMessage(remoteJid, offeringText);
  }
}
