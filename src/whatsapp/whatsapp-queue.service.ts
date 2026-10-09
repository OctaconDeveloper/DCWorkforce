import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { WASocket } from '@whiskeysockets/baileys';

export type MessagePriority = 'HIGH' | 'NORMAL';

export interface QueuedMessage {
  id: string;
  remoteJid: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'interactive';
  payload: any;
  priority: MessagePriority;
  createdAt: number;
  resolve?: (value: any) => void;
  reject?: (reason?: any) => void;
}

@Injectable()
export class WhatsAppQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppQueueService.name);

  private queue: QueuedMessage[] = [];
  private isProcessing = false;
  private sock: WASocket | null = null;

  // Rate Limiting (max 20 messages per minute window)
  private readonly maxPerMinute = 20;
  private sentTimestamps: number[] = [];

  constructor() {}

  onModuleDestroy() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Bind active Baileys socket instance to the queue
   */
  setSocket(sock: WASocket | null) {
    this.sock = sock;
    if (this.sock && this.queue.length > 0 && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Enqueue a Text Message
   */
  async enqueueText(
    remoteJid: string,
    text: string,
    priority: MessagePriority = 'HIGH',
  ): Promise<any> {
    return this.enqueue({
      id: `text_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remoteJid,
      type: 'text',
      payload: { text },
      priority,
      createdAt: Date.now(),
    });
  }

  /**
   * Enqueue an Image Message
   */
  async enqueueImage(
    remoteJid: string,
    image: Buffer,
    caption?: string,
    priority: MessagePriority = 'NORMAL',
  ): Promise<any> {
    return this.enqueue({
      id: `img_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remoteJid,
      type: 'image',
      payload: { image, caption },
      priority,
      createdAt: Date.now(),
    });
  }

  /**
   * Enqueue a Document Message (PDF, Excel, etc.)
   */
  async enqueueDocument(
    remoteJid: string,
    document: Buffer,
    fileName: string,
    mimetype: string,
    caption?: string,
    priority: MessagePriority = 'NORMAL',
  ): Promise<any> {
    return this.enqueue({
      id: `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remoteJid,
      type: 'document',
      payload: { document, fileName, mimetype, caption },
      priority,
      createdAt: Date.now(),
    });
  }

  /**
   * Enqueue an Audio / Voice Note Message
   */
  async enqueueAudio(
    remoteJid: string,
    audio: Buffer,
    ptt = false,
    priority: MessagePriority = 'NORMAL',
  ): Promise<any> {
    return this.enqueue({
      id: `audio_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remoteJid,
      type: 'audio',
      payload: { audio, mimetype: 'audio/mp4', ptt },
      priority,
      createdAt: Date.now(),
    });
  }

  /**
   * Enqueue a Video Message
   */
  async enqueueVideo(
    remoteJid: string,
    video: Buffer,
    caption?: string,
    priority: MessagePriority = 'NORMAL',
  ): Promise<any> {
    return this.enqueue({
      id: `video_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remoteJid,
      type: 'video',
      payload: { video, caption },
      priority,
      createdAt: Date.now(),
    });
  }

  /**
   * Generic internal enqueue with priority ordering
   */
  private enqueue(msg: QueuedMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      msg.resolve = resolve;
      msg.reject = reject;

      if (msg.priority === 'HIGH') {
        // Insert high-priority messages ahead of normal priority ones
        const firstNormalIndex = this.queue.findIndex((m) => m.priority === 'NORMAL');
        if (firstNormalIndex !== -1) {
          this.queue.splice(firstNormalIndex, 0, msg);
        } else {
          this.queue.push(msg);
        }
      } else {
        this.queue.push(msg);
      }

      this.processQueue();
    });
  }

  /**
   * Continuous Outbound Queue Consumer
   */
  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      if (!this.sock) {
        this.logger.warn('WhatsApp socket not ready yet. Pausing outbound queue.');
        break;
      }

      // Check per-minute rate limit window
      await this.enforceRateLimit();

      const item = this.queue.shift()!;
      try {
        // 1. Simulate Human Presence (composing typing state for 1.2s - 2.0s)
        await this.simulatePresence(item.remoteJid, item.type);

        // 2. Dispatch the actual message
        await this.dispatchMessage(item);
        if (item.resolve) item.resolve(true);

        this.recordSentTimestamp();

        // 3. Mandatory 3-5 seconds random anti-ban jitter delay
        const delayMs = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (err: any) {
        this.logger.error(`Error sending queued WhatsApp message to ${item.remoteJid}: ${err.message}`);
        if (item.reject) item.reject(err);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Enforce max 20 messages per minute sliding window
   */
  private async enforceRateLimit() {
    const now = Date.now();
    this.sentTimestamps = this.sentTimestamps.filter((t) => now - t < 60000);

    if (this.sentTimestamps.length >= this.maxPerMinute) {
      const oldestTimestamp = this.sentTimestamps[0];
      const waitTime = 60000 - (now - oldestTimestamp) + 500;
      this.logger.log(`⏳ Rate limit reached (20 msgs/min). Throttling queue for ${(waitTime / 1000).toFixed(1)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  private recordSentTimestamp() {
    this.sentTimestamps.push(Date.now());
  }

  /**
   * Simulate realistic typing presence
   */
  private async simulatePresence(remoteJid: string, type: string) {
    if (!this.sock) return;
    try {
      if (type === 'audio') {
        await this.sock.sendPresenceUpdate('recording', remoteJid);
      } else {
        await this.sock.sendPresenceUpdate('composing', remoteJid);
      }
      // Natural typing duration: 1.2s to 2.0s
      const typingDuration = Math.floor(Math.random() * 800) + 1200;
      await new Promise((resolve) => setTimeout(resolve, typingDuration));
      await this.sock.sendPresenceUpdate('paused', remoteJid);
    } catch {
      // Ignore presence update errors to keep messaging flow robust
    }
  }

  /**
   * Send the payload via Baileys socket
   */
  private async dispatchMessage(item: QueuedMessage) {
    if (!this.sock) return;

    switch (item.type) {
      case 'text':
        await this.sock.sendMessage(item.remoteJid, { text: item.payload.text });
        break;
      case 'image':
        await this.sock.sendMessage(item.remoteJid, {
          image: item.payload.image,
          caption: item.payload.caption,
        });
        break;
      case 'document':
        await this.sock.sendMessage(item.remoteJid, {
          document: item.payload.document,
          fileName: item.payload.fileName,
          mimetype: item.payload.mimetype,
          caption: item.payload.caption,
        });
        break;
      case 'audio':
        await this.sock.sendMessage(item.remoteJid, {
          audio: item.payload.audio,
          mimetype: item.payload.mimetype,
          ptt: item.payload.ptt,
        });
        break;
      case 'video':
        await this.sock.sendMessage(item.remoteJid, {
          video: item.payload.video,
          caption: item.payload.caption,
        });
        break;
      default:
        if (item.payload.text) {
          await this.sock.sendMessage(item.remoteJid, { text: item.payload.text });
        }
    }
  }

  /**
   * Check current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
