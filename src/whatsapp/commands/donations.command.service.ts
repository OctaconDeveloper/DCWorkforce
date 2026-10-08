import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class DonationsCommandService {
  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * DONATIONS -> shows list of active church donations / projects
   */
  async sendDonations(remoteJid: string) {
    const donationsText =
      `❤️ *DOMINION CITY KUBWA — ACTIVE DONATION DRIVES & PROJECTS*\n` +
      `────────────────────────────\n` +
      `_"Give, and it will be given to you: good measure, pressed down, shaken together, and running over..." — Luke 6:38_\n\n` +
      `Here are the church's ongoing projects and giving drives:\n\n` +
      `1️⃣ 🏗️ *SANCTUARY & CHURCH EXPANSION FUND*\n` +
      `• Purpose: Sanctuary acoustic treatment, seating capacity expansion, and high-definition livestream broadcasting equipment.\n` +
      `• Narration Tag: *Building Fund*\n\n` +
      `2️⃣ 🤝 *GOLDEN HEART WELFARE OUTREACH*\n` +
      `• Purpose: Providing food packages, medical emergency support, and welfare packages to vulnerable families and widows.\n` +
      `• Narration Tag: *Welfare*\n\n` +
      `3️⃣ 👧 *CHILDREN & TEENS MINISTRY UPGRADE*\n` +
      `• Purpose: Interactive learning equipment, sound setup, and safe modern classroom amenities for our kids.\n` +
      `• Narration Tag: *Kids Ministry*\n\n` +
      `4️⃣ 🌍 *GLOBAL MISSIONS & PRISON EVANGELISM*\n` +
      `• Purpose: Rural medical missions, prison ministry supplies, and community outreaches.\n` +
      `• Narration Tag: *Missions*\n\n` +
      `────────────────────────────\n` +
      `💡 _Type *offering* to view verified bank account details for transfers._`;

    await this.whatsappService.sendMessage(remoteJid, donationsText);
  }
}
