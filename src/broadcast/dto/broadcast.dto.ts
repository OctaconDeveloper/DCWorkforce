import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBroadcastGroupDto {
  @ApiProperty({ example: 'youth-leaders' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Youth workers and coordinators' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: ['uuid-1', 'uuid-2'], description: 'List of initial worker IDs' })
  @IsArray()
  @IsOptional()
  workerIds?: string[];
}

export class AddGroupMemberDto {
  @ApiProperty({ example: 'uuid-1', description: 'Worker ID or Phone Number' })
  @IsString()
  @IsNotEmpty()
  workerIdentifier: string;
}

export interface BroadcastMediaPayload {
  buffer: Buffer;
  mimetype: string;
  fileName?: string;
  type: 'image' | 'document' | 'audio' | 'video';
  ptt?: boolean; // Push-to-talk voice note
}
