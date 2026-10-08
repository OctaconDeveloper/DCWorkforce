import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { WorkersModule } from './workers/workers.module';
import { SchedulesModule } from './schedules/schedules.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { EventsModule } from './events/events.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { DepartmentsModule } from './departments/departments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    PrismaModule,
    AuthModule,
    AdminModule,
    DepartmentsModule,
    WorkersModule,
    SchedulesModule,
    AnnouncementsModule,
    EventsModule,
    BroadcastModule,
    WhatsappModule,
  ],
})
export class AppModule {}
