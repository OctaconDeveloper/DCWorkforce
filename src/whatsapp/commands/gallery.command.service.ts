import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class GalleryCommandService {
  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Main Gallery Menu
   */
  async sendGalleryMenu(remoteJid: string) {
    const text =
      `🎨 *DOMINION CITY KUBWA — GALLERY & RESOURCES*\n` +
      `────────────────────────────\n` +
      `Welcome to our digital message and media library!\n\n` +
      `Please reply with a keyword or choose an option:\n\n` +
      `1️⃣ *MESSAGES* (Type *messages*, *audio*, or *pdf*)\n` +
      `   • 🎙️ Audio sermons & podcasts\n` +
      `   • 📄 PDF study outlines, notes & bulletins\n\n` +
      `2️⃣ *MEDIA* (Type *media*, *photos*, or *videos*)\n` +
      `   • 📸 Service photo albums & pictures\n` +
      `   • 🎬 Video highlights & ministrations\n\n` +
      `────────────────────────────\n` +
      `💡 _Type *messages*, *audio*, *pdf*, *media*, *photos*, or *videos* to browse._\n` +
      `↩️ _Type *menu* to return to the Main Menu._`;

    await this.whatsappService.sendInteractiveButtons(remoteJid, {
      title: '🎨 Gallery & Resources',
      text,
      footer: 'DC Kubwa Workforce',
      buttons: [
        { id: 'messages', text: '📖 Messages' },
        { id: 'media', text: '📸 Media' },
        { id: 'menu', text: '🏠 Main Menu' },
      ],
    });
  }

  /**
   * Sub-menu: Messages (Audio & PDF)
   */
  async sendMessagesSubMenu(remoteJid: string) {
    await this.sendComingSoonResponse(
      remoteJid,
      'Sermons & Study Messages (Audio & PDF)',
      'Audio sermons, podcasts, and digital PDF study outlines are currently being curated and will be available soon!',
    );
  }

  /**
   * Sub: Audio Messages
   */
  async sendAudioMessages(remoteJid: string) {
    await this.sendComingSoonResponse(
      remoteJid,
      'Audio Messages & Sermons',
      'Sunday sermon recordings, worship tracks, and podcast episodes are currently being prepared for direct streaming and download.',
    );
  }

  /**
   * Sub: PDF Messages
   */
  async sendPdfMessages(remoteJid: string) {
    await this.sendComingSoonResponse(
      remoteJid,
      'PDF Messages & Study Guides',
      'Weekly sermon study outlines, DLI course materials, and monthly devotionals will be available for download shortly.',
    );
  }

  /**
   * Sub: Media (Photos & Videos)
   */
  async sendMediaGallery(remoteJid: string) {
    await this.sendComingSoonResponse(
      remoteJid,
      'Photo & Video Media Gallery',
      'High-definition service photo albums, program recap videos, and media archives are currently in development and coming soon!',
    );
  }

  /**
   * Sub: Photos
   */
  async sendPhotosGallery(remoteJid: string) {
    await this.sendComingSoonResponse(
      remoteJid,
      'Service Photo Albums & Pictures',
      'Sunday service photos, special program galleries, and workforce memories are being organized and will be available soon!',
    );
  }

  /**
   * Sub: Videos
   */
  async sendVideosGallery(remoteJid: string) {
    await this.sendComingSoonResponse(
      remoteJid,
      'Video Highlights & Ministrations',
      'Service video recaps, choir ministrations, and program highlights are currently being prepared for online streaming and download.',
    );
  }

  /**
   * Helper: Send a standardized "Coming Soon" interactive response with Menu button
   */
  private async sendComingSoonResponse(
    remoteJid: string,
    featureTitle: string,
    details: string,
  ) {
    const text =
      `✨ *FEATURE COMING SOON!*\n` +
      `────────────────────────────\n` +
      `📌 *${featureTitle.toUpperCase()}*\n\n` +
      `${details}\n\n` +
      `────────────────────────────\n` +
      `↩️ _Reply with *menu* to return to Main Menu or *gallery* for Gallery._`;

    await this.whatsappService.sendInteractiveButtons(remoteJid, {
      title: '✨ Coming Soon',
      text,
      footer: 'Dominion City Kubwa',
      buttons: [
        { id: 'menu', text: '🏠 Main Menu' },
        { id: 'gallery', text: '🎨 Gallery' },
      ],
    });
  }
}
