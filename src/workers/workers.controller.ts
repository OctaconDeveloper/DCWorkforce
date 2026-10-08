import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { WorkersService } from './workers.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto, QueryWorkerDto } from './dto/update-worker.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Department } from '../common/enums/department.enum';

@ApiTags('Workers')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('workers')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @ApiOperation({ summary: 'Register a new church worker' })
  @ApiResponse({ status: 201, description: 'Worker created successfully' })
  @ApiResponse({ status: 409, description: 'Phone number already exists' })
  @Post()
  create(@Body() createWorkerDto: CreateWorkerDto) {
    return this.workersService.create(createWorkerDto);
  }

  @ApiOperation({ summary: 'List and filter workers by department, status or search query' })
  @ApiResponse({ status: 200, description: 'List of workers' })
  @Get()
  findAll(@Query() query: QueryWorkerDto) {
    return this.workersService.findAll(query);
  }

  @ApiOperation({ summary: 'Search workers by name, role or phone number' })
  @ApiQuery({ name: 'q', required: true, example: 'John' })
  @Get('search')
  search(@Query('q') q: string) {
    return this.workersService.findAll({ q });
  }

  @ApiOperation({ summary: 'Get worker details by UUID' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workersService.findOne(id);
  }

  @ApiOperation({ summary: 'Update worker information' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateWorkerDto: UpdateWorkerDto) {
    return this.workersService.update(id, updateWorkerDto);
  }

  @ApiOperation({ summary: 'Delete worker by ID' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workersService.remove(id);
  }

  @ApiOperation({ summary: 'Bulk import workers via CSV or Excel (.xlsx) file upload' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV or XLSX file containing church workers list',
        },
      },
    },
  })
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importWorkers(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Please upload a valid CSV or Excel file');
    }
    return this.workersService.importFromBuffer(file.buffer);
  }

  @ApiOperation({ summary: 'Bulk add workers via raw multiline CSV text' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          example:
            'John Doe, 2348012345678, choir, Member, 1995-04-12, 2022-01-15, false\nMary Jane, 2348098765432, ushering, HOD, 1990-08-20, 2020-05-10, true',
        },
      },
      required: ['text'],
    },
  })
  @Post('bulk-text')
  async importFromText(@Body('text') text: string) {
    if (!text || typeof text !== 'string') {
      throw new BadRequestException('Please provide a valid multi-line text string');
    }
    return this.workersService.importFromText(text);
  }
}
