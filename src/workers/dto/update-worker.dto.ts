import { PartialType } from '@nestjs/swagger';
import { CreateWorkerDto } from './create-worker.dto';
import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Department } from '../../common/enums/department.enum';
import { Type } from 'class-transformer';

export class UpdateWorkerDto extends PartialType(CreateWorkerDto) {}

export class QueryWorkerDto {
  @ApiPropertyOptional({ enum: Department, description: 'Filter by department' })
  @IsEnum(Department)
  @IsOptional()
  department?: Department;

  @ApiPropertyOptional({ example: true, description: 'Filter by active status' })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'Grace', description: 'Search term for name, phone, or role' })
  @IsString()
  @IsOptional()
  q?: string;
}
