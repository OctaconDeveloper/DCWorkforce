import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateEventDto {
  @ApiProperty({ example: 'Kingdom Men Breakfast Conference' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Special ministry session for authentic leaders and godly families.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '2026-10-25', description: 'Event date in YYYY-MM-DD format' })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiPropertyOptional({ example: '08:00 AM' })
  @IsString()
  @IsOptional()
  time?: string;

  @ApiPropertyOptional({ example: 'Main Sanctuary' })
  @IsString()
  @IsOptional()
  venue?: string;

  @ApiPropertyOptional({ example: 'ALL', description: 'Target scope: ALL, DEPARTMENT, or UNIT' })
  @IsString()
  @IsOptional()
  targetScope?: string;

  @ApiPropertyOptional({ example: 'media' })
  @IsString()
  @IsOptional()
  targetDepartment?: string;

  @ApiPropertyOptional({ example: 'IT/Livestream' })
  @IsString()
  @IsOptional()
  targetUnit?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  createdBy?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  creatorRole?: string;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}

export class QueryEventDto {
  @ApiPropertyOptional({ description: 'Filter events from this date onwards (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetScope?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetDepartment?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetUnit?: string;
}
