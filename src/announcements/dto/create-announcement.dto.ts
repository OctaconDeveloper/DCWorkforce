import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AnnouncementTarget } from '../../common/enums/department.enum';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'General Workers Fasting & Prayer Session' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'There will be a mandatory workers prayer vigil this Friday starting by 10:00 PM.',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    example: 'ALL',
    description: 'Target audience scope: ALL, DEPARTMENT, or UNIT',
    default: 'ALL',
  })
  @IsString()
  @IsOptional()
  targetScope?: string;

  @ApiPropertyOptional({
    enum: AnnouncementTarget,
    example: AnnouncementTarget.ALL,
    description: 'Target department: specific department or "all"',
    default: AnnouncementTarget.ALL,
  })
  @IsString()
  @IsOptional()
  targetDepartment?: string;

  @ApiPropertyOptional({
    example: 'Sound',
    description: 'Target unit name',
  })
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

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}

export class QueryAnnouncementDto {
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
