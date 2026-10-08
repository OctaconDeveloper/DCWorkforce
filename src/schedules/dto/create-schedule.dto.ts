import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Department } from '../../common/enums/department.enum';

export class CreateScheduleDto {
  @ApiProperty({
    enum: Department,
    example: Department.CHOIR,
    description: 'Department assigned to this schedule',
  })
  @IsEnum(Department)
  @IsNotEmpty()
  department: Department;

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
}

export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {}

export class QueryScheduleDto {
  @ApiPropertyOptional({ enum: Department })
  @IsEnum(Department)
  @IsOptional()
  department?: Department;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Filter schedules from this date' })
  @IsString()
  @IsOptional()
  fromDate?: string;
}
