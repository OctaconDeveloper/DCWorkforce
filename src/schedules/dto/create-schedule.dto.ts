import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Department } from '../../common/enums/department.enum';

export class CreateScheduleDto {
  @ApiProperty({
    enum: Department,
    example: Department.CHOIR,
    description: 'Department assigned to this schedule',
  })
  @IsString()
  @IsNotEmpty()
  department: string;

  @ApiProperty({ example: 'Sunday Choir Rehearsal & Sound Check' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: '2026-10-12', description: 'Date in YYYY-MM-DD format' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ example: '07:00 AM', description: 'Schedule start time' })
  @IsString()
  @IsNotEmpty()
  time: string;

  @ApiProperty({ example: 'Main Auditorium / Choir Gallery' })
  @IsString()
  @IsNotEmpty()
  venue: string;

  @ApiPropertyOptional({ example: 'Full rehearsal for Thanksgiving Sunday special song.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'DEPARTMENT', description: 'DEPARTMENT, UNIT, WORKER, or ALL' })
  @IsString()
  @IsOptional()
  targetScope?: string;

  @ApiPropertyOptional({ example: 'IT / Livestream & Broadcast' })
  @IsString()
  @IsOptional()
  targetUnit?: string;

  @ApiPropertyOptional({ example: '08101889830, 08144527833' })
  @IsString()
  @IsOptional()
  targetWorkers?: string;

  @ApiPropertyOptional({ example: 'Dr. David Araka' })
  @IsString()
  @IsOptional()
  createdBy?: string;

  @ApiPropertyOptional({ example: 'HOD' })
  @IsString()
  @IsOptional()
  creatorRole?: string;
}

export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {}

export class QueryScheduleDto {
  @ApiPropertyOptional({ description: 'Department name' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'IT / Livestream & Broadcast' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Filter schedules from this date' })
  @IsString()
  @IsOptional()
  fromDate?: string;
}

