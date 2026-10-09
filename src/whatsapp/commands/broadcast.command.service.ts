import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { Worker } from '@prisma/client';
import { proto, downloadMediaMessage, WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import { BroadcastService } from '../../broadcast/broadcast.service';
import { BroadcastGroupsService } from '../../broadcast/broadcast-groups.service';
import { BroadcastMediaPayload } from '../../broadcast/dto/broadcast.dto';
import { WhatsappService } from '../whatsapp.service';

@Injectable()
export class BroadcastCommandService {
  private readonly logger = new Logger(BroadcastCommandService.name);

  constructor(
    @Inject(forwardRef(() => BroadcastService))
    private readonly broadcastService: BroadcastService,
    @Inject(forwardRef(() => BroadcastGroupsService))
    private readonly broadcastGroupsService: BroadcastGroupsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Helper: Extract media buffer and payload from current or quoted message
   */
  async extractMediaPayload(
    msg: proto.IWebMessageInfo,
    sock: WASocket | null,
  ): Promise<BroadcastMediaPayload | undefined> {
    if (!sock) return undefined;

    const m = msg.message;
    if (!m) return undefined;

    const innerMsg: any =
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      m;

    // Check if current message has media
    let targetMsg = msg;
    let mediaObj = innerMsg.imageMessage || innerMsg.documentMessage || innerMsg.audioMessage || innerMsg.videoMessage;

    // If not on current message, check quoted message
    if (!mediaObj) {
      const contextInfo =
        innerMsg.extendedTextMessage?.contextInfo ||
        innerMsg.interactiveResponseMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;
      if (quoted) {
        mediaObj = quoted.imageMessage || quoted.documentMessage || quoted.audioMessage || quoted.videoMessage;
        if (mediaObj && contextInfo?.stanzaId && contextInfo?.participant) {
          targetMsg = {
            key: {
              remoteJid: msg.key.remoteJid,
              id: contextInfo.stanzaId,
              participant: contextInfo.participant,
            },
            message: quoted,
          } as proto.IWebMessageInfo;
        }
      }
    }

    if (!mediaObj) return undefined;

    try {
      const buffer = (await downloadMediaMessage(
        targetMsg,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage,
        },
      )) as Buffer;

      if (!buffer || buffer.length === 0) return undefined;

      let type: 'image' | 'document' | 'audio' | 'video' = 'document';
      if (mediaObj.mimetype?.startsWith('image/')) type = 'image';
      else if (mediaObj.mimetype?.startsWith('audio/')) type = 'audio';
      else if (mediaObj.mimetype?.startsWith('video/')) type = 'video';
      else if (innerMsg.imageMessage || targetMsg.message?.imageMessage) type = 'image';

      return {
        buffer,
        mimetype: mediaObj.mimetype || 'application/octet-stream',
        fileName: mediaObj.fileName || `attachment_${Date.now()}`,
        type,
        ptt: Boolean(mediaObj.ptt),
      };
    } catch (err: any) {
      this.logger.warn(`Failed to extract broadcast media: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Handle Broadcast Commands (broadcast unit, broadcast dept, broadcast all, broadcast group)
   */
  async handleBroadcast(
    rawText: string,
    worker: Worker | null,
    remoteJid: string,
    isAdmin = false,
    msg?: proto.IWebMessageInfo,
    sock?: WASocket | null,
  ) {
    const isLeader = Boolean(isAdmin || (worker && (worker.isHOD || worker.isUnitHead)));
    if (!isLeader) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Leadership Access Only:* Broadcast notifications are reserved for Head of Units, Head of Departments, and Church Administrators.`,
      );
      return;
    }

    // Extract potential media
    let mediaPayload: BroadcastMediaPayload | undefined = undefined;
    if (msg && sock) {
      mediaPayload = await this.extractMediaPayload(msg, sock);
    }

    // Remove leading broadcast trigger from text
    let cleanText = rawText
      .replace(/^(broadcast|notify|#broadcast|#notify)\s+/i, '')
      .trim();

    // 1. BROADCAST UNIT (Head of Unit, HOD, Admin)
    if (/^unit\b/i.test(cleanText)) {
      const messageBody = cleanText.replace(/^unit\s*/i, '').trim();
      if (!messageBody && !mediaPayload) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Missing Message:* Please provide the text or media to broadcast.\n\n*Format:*\n\`broadcast unit <multi-line message>\`\n_Or attach an image/doc/audio with caption \`broadcast unit <message>\`_`,
        );
        return;
      }

      if (!worker?.isUnitHead && !worker?.isHOD && !isAdmin) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⛔ *Unauthorized:* Only Head of Units or HODs can broadcast to a unit.`,
        );
        return;
      }

      if (!worker?.unit && !isAdmin) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *No Unit Assigned:* You do not have an active unit assigned to your profile.`,
        );
        return;
      }

      await this.whatsappService.sendMessage(remoteJid, `⏳ *Dispatching broadcast to ${worker?.unit || 'unit'} members (with 3-5s safe delivery pacing)...*`);
      try {
        const result = await this.broadcastService.broadcastToUnit(worker!, messageBody, mediaPayload);
        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ *UNIT BROADCAST COMPLETED*\n────────────────────────────\n• Target: *${result.targetDescription}*\n• Delivered: *${result.deliveredCount} / ${result.totalTargeted}* workers\n• Failed: *${result.failedCount}*`,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Broadcast Failed:* ${err.message}`);
      }
      return;
    }

    // 2. BROADCAST DEPT (Head of Department, Admin)
    if (/^dept\b|^department\b/i.test(cleanText)) {
      let deptName = '';
      let messageBody = '';

      // Check if Admin specified a custom department name e.g. "broadcast dept media Hello"
      const parts = cleanText.replace(/^(dept|department)\s*/i, '').trim();

      if (isAdmin && parts.includes(' ')) {
        const firstWord = parts.split(' ')[0].toLowerCase();
        // Check if first word is a known department
        deptName = firstWord;
        messageBody = parts.slice(firstWord.length).trim();
      } else {
        messageBody = parts;
      }

      if (!messageBody && !mediaPayload) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Missing Message:* Please provide the text or media to broadcast.\n\n*Format:*\n\`broadcast dept <multi-line message>\`\n_Or attach an image/doc/audio with caption \`broadcast dept <message>\`_`,
        );
        return;
      }

      if (!worker?.isHOD && !isAdmin) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⛔ *Unauthorized:* Only Head of Departments and Church Admins can broadcast department-wide.`,
        );
        return;
      }

      await this.whatsappService.sendMessage(remoteJid, `⏳ *Dispatching broadcast to department members (with 3-5s safe delivery pacing)...*`);
      try {
        let result;
        if (isAdmin && deptName) {
          result = await this.broadcastService.broadcastToSpecificDepartment(deptName, messageBody, mediaPayload);
        } else if (worker?.isHOD) {
          result = await this.broadcastService.broadcastToDepartment(worker, messageBody, mediaPayload);
        } else {
          result = await this.broadcastService.broadcastToSpecificDepartment(worker?.department || 'media', messageBody, mediaPayload);
        }

        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ *DEPARTMENT BROADCAST COMPLETED*\n────────────────────────────\n• Target: *${result.targetDescription}*\n• Delivered: *${result.deliveredCount} / ${result.totalTargeted}* workers\n• Failed: *${result.failedCount}*`,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Broadcast Failed:* ${err.message}`);
      }
      return;
    }

    // 3. BROADCAST GROUP (Admin Only)
    if (/^group\b/i.test(cleanText)) {
      if (!isAdmin) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `🔒 *Admin Access Only:* Custom group broadcasts can only be initiated by Church Administrators.`,
        );
        return;
      }

      const afterGroup = cleanText.replace(/^group\s*/i, '').trim();
      const firstSpaceIdx = afterGroup.indexOf(' ');
      let groupName = '';
      let messageBody = '';

      if (firstSpaceIdx === -1) {
        groupName = afterGroup;
      } else {
        groupName = afterGroup.substring(0, firstSpaceIdx).trim();
        messageBody = afterGroup.substring(firstSpaceIdx).trim();
      }

      if (!groupName || (!messageBody && !mediaPayload)) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Usage:* \`broadcast group <group-name> <multi-line message>\`\n\nExample:\n\`broadcast group youth-leaders Mandatory meeting tomorrow 5 PM\``,
        );
        return;
      }

      await this.whatsappService.sendMessage(remoteJid, `⏳ *Dispatching broadcast to group "${groupName}" (with 3-5s safe delivery pacing)...*`);
      try {
        const result = await this.broadcastService.broadcastToGroup(groupName, messageBody, mediaPayload);
        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ *GROUP BROADCAST COMPLETED*\n────────────────────────────\n• Target: *${result.targetDescription}*\n• Delivered: *${result.deliveredCount} / ${result.totalTargeted}* workers\n• Failed: *${result.failedCount}*`,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Broadcast Failed:* ${err.message}`);
      }
      return;
    }

    // 4. BROADCAST ALL (Admin Only)
    if (/^all\b/i.test(cleanText) || (isAdmin && !cleanText.startsWith('unit') && !cleanText.startsWith('dept') && !cleanText.startsWith('group'))) {
      if (!isAdmin) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `🔒 *Admin Access Only:* Church-wide broadcasts can only be initiated by Church Administrators. As HOD, use \`broadcast dept <msg>\`. As Unit Head, use \`broadcast unit <msg>\`.`,
        );
        return;
      }

      const messageBody = cleanText.replace(/^all\s*/i, '').trim() || cleanText;
      if (!messageBody && !mediaPayload) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Usage:* \`broadcast all <multi-line message>\`\n_Or attach media with caption \`broadcast all <message>\`_`,
        );
        return;
      }

      await this.whatsappService.sendMessage(remoteJid, `⏳ *Dispatching church-wide broadcast to all active workers (with 3-5s safe delivery pacing)...*`);
      try {
        const result = await this.broadcastService.broadcastToAllWorkers(messageBody, mediaPayload);
        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ *CHURCH-WIDE BROADCAST COMPLETED*\n────────────────────────────\n• Target: *All Registered Workforce*\n• Delivered: *${result.deliveredCount} / ${result.totalTargeted}* workers\n• Failed: *${result.failedCount}*`,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Broadcast Failed:* ${err.message}`);
      }
      return;
    }


    // Default usage guide if command didn't match
    let guide =
      `📢 *BROADCAST NOTIFICATION GUIDE*\n` +
      `────────────────────────────\n` +
      `Send instant multi-line messages, images, PDFs, audio/voice notes to your workforce:\n\n`;

    if (worker?.isUnitHead || isAdmin) {
      guide += `• \`broadcast unit <message>\` — Send to all workers in your unit\n`;
    }
    if (worker?.isHOD || isAdmin) {
      guide += `• \`broadcast dept <message>\` — Send to all workers in your department\n`;
    }
    if (isAdmin) {
      guide +=
        `• \`broadcast all <message>\` — Church-wide broadcast to all workers\n` +
        `• \`broadcast group <name> <message>\` — Send to a custom broadcast group\n` +
        `• Type *groups* to view and manage custom broadcast lists\n`;
    }
    guide += `\n💡 _You can attach images, PDFs, or voice notes with the broadcast command as caption!_`;

    await this.whatsappService.sendMessage(remoteJid, guide);
  }

  /**
   * Handle Custom Broadcast Groups Management (Admin Only)
   */
  async handleGroupCommands(
    rawText: string,
    remoteJid: string,
    isAdmin = false,
  ) {
    if (!isAdmin) {
      await this.whatsappService.sendMessage(
        remoteJid,
        `🔒 *Admin Access Only:* Broadcast groups management is reserved for Church Administrators.`,
      );
      return;
    }

    const lower = rawText.toLowerCase().trim();

    // 1. LIST GROUPS (`groups` or `broadcast groups`)
    if (lower === 'groups' || lower === 'broadcast groups' || lower === '#groups') {
      const groups = await this.broadcastGroupsService.getAllGroups();
      if (groups.length === 0) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `📁 *CUSTOM BROADCAST GROUPS*\n────────────────────────────\n` +
          `No custom broadcast groups created yet.\n\n` +
          `*To create a group:*\n\`add group <name> [optional description]\`\n_Example: \`add group youth-leads Coordinators & youth executives\`_`,
        );
        return;
      }

      let text = `📁 *CUSTOM BROADCAST GROUPS*\n────────────────────────────\n`;
      groups.forEach((g, i) => {
        text += `*${i + 1}. ${g.name.toUpperCase()}* (${g.memberCount} members)\n`;
        if (g.description) text += `   _${g.description}_\n`;
      });
      text +=
        `\n────────────────────────────\n` +
        `*Group Commands:*\n` +
        `• \`group view <name>\` — View members in group\n` +
        `• \`group add <name> <phone/name>\` — Add member to group\n` +
        `• \`group remove <name> <phone/name>\` — Remove member\n` +
        `• \`delete group <name>\` — Delete group\n` +
        `• \`broadcast group <name> <message>\` — Broadcast to group`;

      await this.whatsappService.sendMessage(remoteJid, text);
      return;
    }

    // 2. CREATE GROUP (`add group <name> [desc]`)
    if (lower.startsWith('add group ') || lower.startsWith('create group ')) {
      const payload = rawText.replace(/^(add|create)\s+group\s+/i, '').trim();
      const firstSpace = payload.indexOf(' ');
      let name = '';
      let description: string | undefined = undefined;

      if (firstSpace === -1) {
        name = payload;
      } else {
        name = payload.substring(0, firstSpace).trim();
        description = payload.substring(firstSpace).trim();
      }

      if (!name) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Usage:* \`add group <group-name> [optional description]\``,
        );
        return;
      }

      try {
        const group = await this.broadcastGroupsService.createGroup({ name, description });
        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ *Broadcast Group Created!*\n────────────────────────────\n• Name: *${group.name}*\n• Description: ${group.description || 'None'}\n\n*Next:* Add members by typing:\n\`group add ${group.name} <worker-phone-or-name>\``,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Error:* ${err.message}`);
      }
      return;
    }

    // 3. VIEW GROUP (`group view <name>`)
    if (lower.startsWith('group view ') || lower.startsWith('view group ')) {
      const name = rawText.replace(/^(group view|view group)\s+/i, '').trim();
      try {
        const group = await this.broadcastGroupsService.getGroupByName(name);
        let text =
          `📁 *BROADCAST GROUP: ${group.name.toUpperCase()}*\n` +
          `────────────────────────────\n` +
          `• Description: ${group.description || 'None'}\n` +
          `• Total Members: *${group.members.length}*\n\n` +
          `👥 *MEMBERS LIST:*\n`;

        if (group.members.length === 0) {
          text += `_No members yet. Type \`group add ${group.name} <phone/name>\` to add._\n`;
        } else {
          group.members.forEach((m, idx) => {
            text += `${idx + 1}. *${m.worker.fullName}* (${m.worker.department.toUpperCase()}${m.worker.unit ? ' - ' + m.worker.unit : ''}) — ${m.worker.phone}\n`;
          });
        }

        text +=
          `\n────────────────────────────\n` +
          `• Type \`group add ${group.name} <phone>\` to add\n` +
          `• Type \`broadcast group ${group.name} <message>\` to broadcast`;

        await this.whatsappService.sendMessage(remoteJid, text);
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Error:* ${err.message}`);
      }
      return;
    }

    // 4. ADD MEMBER TO GROUP (`group add <name> <phone/name>`)
    if (lower.startsWith('group add ') || lower.startsWith('add member to group ')) {
      const payload = rawText.replace(/^(group add|add member to group)\s+/i, '').trim();
      const parts = payload.split(/\s+/);
      const groupName = parts[0];
      const workerIdentifier = parts.slice(1).join(' ').trim();

      if (!groupName || !workerIdentifier) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Usage:* \`group add <group-name> <worker phone or name>\`\nExample: \`group add youth-leads 08012345678\``,
        );
        return;
      }

      try {
        const res = await this.broadcastGroupsService.addMember(groupName, workerIdentifier);
        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ Added *${res.worker.fullName}* (${res.worker.department.toUpperCase()}) to group *${groupName}*!`,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Error:* ${err.message}`);
      }
      return;
    }

    // 5. REMOVE MEMBER FROM GROUP (`group remove <name> <phone/name>`)
    if (lower.startsWith('group remove ') || lower.startsWith('remove member from group ')) {
      const payload = rawText.replace(/^(group remove|remove member from group)\s+/i, '').trim();
      const parts = payload.split(/\s+/);
      const groupName = parts[0];
      const workerIdentifier = parts.slice(1).join(' ').trim();

      if (!groupName || !workerIdentifier) {
        await this.whatsappService.sendMessage(
          remoteJid,
          `⚠️ *Usage:* \`group remove <group-name> <worker phone or name>\``,
        );
        return;
      }

      try {
        const res = await this.broadcastGroupsService.removeMember(groupName, workerIdentifier);
        await this.whatsappService.sendMessage(
          remoteJid,
          `✅ Removed *${res.workerName}* from group *${groupName}*.`,
        );
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Error:* ${err.message}`);
      }
      return;
    }

    // 6. DELETE GROUP (`delete group <name>`)
    if (lower.startsWith('delete group ') || lower.startsWith('remove group ')) {
      const name = rawText.replace(/^(delete group|remove group)\s+/i, '').trim();
      try {
        const res = await this.broadcastGroupsService.deleteGroup(name);
        await this.whatsappService.sendMessage(remoteJid, `✅ ${res.message}`);
      } catch (err: any) {
        await this.whatsappService.sendMessage(remoteJid, `❌ *Error:* ${err.message}`);
      }
      return;
    }
  }
}
