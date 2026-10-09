import { Module, forwardRef } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WorkersModule } from '../workers/workers.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { EventsModule } from '../events/events.module';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { AdminModule } from '../admin/admin.module';
import { DepartmentsModule } from '../departments/departments.module';
import { BirthdayNotifierService } from './birthday-notifier.service';
import { DatabaseBackupService } from './database-backup.service';
import { WhatsAppQueueService } from './whatsapp-queue.service';
import {
  MenuCommandService,
  InfoCommandService,
  DepartmentsCommandService,
  OrganogramCommandService,
  EventsCommandService,
  AnnouncementsCommandService,
  DonationsCommandService,
  OfferingCommandService,
  ScheduleCommandService,
  RegistrationCommandService,
  ApprovalsCommandService,
  AdminCommandService,
  BroadcastCommandService,
  GalleryCommandService,
  OnboardingCommandService,
} from './commands';

const COMMAND_SERVICES = [
  MenuCommandService,
  InfoCommandService,
  DepartmentsCommandService,
  OrganogramCommandService,
  EventsCommandService,
  AnnouncementsCommandService,
  DonationsCommandService,
  OfferingCommandService,
  ScheduleCommandService,
  RegistrationCommandService,
  ApprovalsCommandService,
  AdminCommandService,
  BroadcastCommandService,
  GalleryCommandService,
  OnboardingCommandService,
];

@Module({
  imports: [
    WorkersModule,
    forwardRef(() => SchedulesModule),
    AnnouncementsModule,
    EventsModule,
    forwardRef(() => BroadcastModule),
    AdminModule,
    DepartmentsModule,
  ],
  providers: [
    WhatsappService,
    BirthdayNotifierService,
    DatabaseBackupService,
    WhatsAppQueueService,
    ...COMMAND_SERVICES,
  ],
  exports: [
    WhatsappService,
    BirthdayNotifierService,
    DatabaseBackupService,
    WhatsAppQueueService,
    ...COMMAND_SERVICES,
  ],
})
export class WhatsappModule {}


