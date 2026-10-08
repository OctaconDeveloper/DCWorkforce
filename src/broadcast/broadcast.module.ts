import { Module, forwardRef } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { BroadcastGroupsService } from './broadcast-groups.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => WhatsappModule),
    forwardRef(() => TelegramModule),
  ],
  providers: [BroadcastService, BroadcastGroupsService],
  exports: [BroadcastService, BroadcastGroupsService],
})
export class BroadcastModule {}

