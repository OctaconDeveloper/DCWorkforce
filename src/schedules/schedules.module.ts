import { Module, forwardRef } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { ScheduleNotifierService } from './schedule-notifier.service';
import { WorkersModule } from '../workers/workers.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    WorkersModule,
    forwardRef(() => WhatsappModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [SchedulesController],
  providers: [SchedulesService, ScheduleNotifierService],
  exports: [SchedulesService, ScheduleNotifierService],
})
export class SchedulesModule {}

