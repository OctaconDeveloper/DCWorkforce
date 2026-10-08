import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsEmail,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Department } from '../../common/enums/department.enum';

export class CreateWorkerDto {
  @ApiProperty({ example: 'Sister Grace Johnson', description: 'Full name of worker' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  fullName: string;

  @ApiProperty({
    example: '2348012345678',
    description: 'Phone number (can be 080..., +234..., or 234...)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone: string;

  @ApiProperty({
    enum: Department,
    example: Department.CHOIR,
    description: 'Assigned church department',
  })
  @IsEnum(Department, {
    message:
      'Department must be one of: choir, ushering, media, protocol, prayer, children, welfare',
  })
  @IsNotEmpty()
  department: Department;

  @ApiPropertyOptional({ example: 'IT/Livestream', description: 'Assigned departmental unit (e.g. IT/Livestream, Sound, Camera)' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ example: 'Choir Leader / Soprano', default: 'Member' })
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({ example: 'grace@example.com' })
  @IsEmail({}, { message: 'Invalid email address' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '1995-06-15', description: 'Birthday (e.g. 1995-06-15 or 21 Aug)' })
  @IsString()
  @IsOptional()
  birthday?: string;

  @ApiPropertyOptional({ example: '2021-03-01', description: 'Joined date in YYYY-MM-DD' })
  @IsString()
  @IsOptional()
  joinedDate?: string;

  @ApiPropertyOptional({ example: 'Single', description: 'Marital status (Single, Married, etc.)' })
  @IsString()
  @IsOptional()
  maritalStatus?: string;

  @ApiPropertyOptional({ example: 'yes', description: 'Attended DLI (yes / no)' })
  @IsString()
  @IsOptional()
  attendedDLI?: string;

  @ApiPropertyOptional({ example: 'yes', description: 'Attended DCA (yes / no)' })
  @IsString()
  @IsOptional()
  attendedDCA?: string;

  @ApiPropertyOptional({ example: 'yes', description: 'Attended Encounter retreat (yes / no)' })
  @IsString()
  @IsOptional()
  attendedEncounter?: string;

  @ApiPropertyOptional({ example: 'zone 5 power Dutse alhaji', description: 'Residential full address' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  isHOD?: boolean;
}
