import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { WorkersModule } from '../workers/workers.module';
import { DepartmentsModule } from '../departments/departments.module';
import { EventsModule } from '../events/events.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { AdminModule } from '../admin/admin.module';
import { BroadcastModule } from '../broadcast/broadcast.module';

@Module({
  imports: [
    WorkersModule,
    DepartmentsModule,
    EventsModule,
    AnnouncementsModule,
    forwardRef(() => SchedulesModule),
    AdminModule,
    forwardRef(() => BroadcastModule),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
