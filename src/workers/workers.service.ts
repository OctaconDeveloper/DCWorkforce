import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentsService } from '../departments/departments.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto, QueryWorkerDto } from './dto/update-worker.dto';
import { Department } from '../common/enums/department.enum';
import { Worker, RegistrationRequest } from '@prisma/client';
import * as xlsx from 'xlsx';

export interface BulkImportResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; identifier: string; error: string }[];
  workers: Worker[];
}

@Injectable()
export class WorkersService implements OnModuleInit {
  private readonly logger = new Logger(WorkersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentsService: DepartmentsService,
  ) {}

  async onModuleInit() {
    await this.ensureMediaHODExists();
  }

  /**
   * Ensure +2348101889830 is initialized as Media Head of Department (HOD) - Dr. David Araka
   */
  async ensureMediaHODExists() {
    try {
      const mediaHodPhone = '2348101889830';
      const mediaHodLid = '123428854100150@lid';

      const existing = await this.prisma.worker.findFirst({
        where: {
          OR: [
            { phone: mediaHodPhone },
            { lid: mediaHodLid },
            { fullName: { contains: 'David Araka' } },
          ],
        },
      });

      if (existing) {
        await this.prisma.worker.update({
          where: { id: existing.id },
          data: {
            fullName: existing.fullName || 'Dr. David Araka',
            phone: mediaHodPhone,
            lid: mediaHodLid,
            department: 'media',
            role: 'Head of Department',
            isHOD: true,
            isActive: true,
          },
        });
        this.logger.log(`🎬 Verified and synced Dr. David Araka as Media Head of Department (${mediaHodPhone})`);
      } else {
        await this.prisma.worker.create({
          data: {
            fullName: 'Dr. David Araka',
            phone: mediaHodPhone,
            department: 'media',
            unit: 'Media Operations',
            role: 'Head of Department',
            isHOD: true,
            isUnitHead: false,
            isActive: true,
            lid: mediaHodLid,
            address: 'Dominion City Kubwa, Abuja',
          },
        });
        this.logger.log(`🎬 Created and initialized Dr. David Araka as Media Head of Department (${mediaHodPhone})`);
      }
    } catch (err: any) {
      this.logger.warn(`Could not ensure Media HOD initialization: ${err.message}`);
    }
  }

  /**
   * Format phone number for clean human display (e.g. +2348101889830)
   */
  formatDisplayPhone(phone: string): string {
    if (!phone) return 'Not specified';
    const clean = phone.replace(/\D/g, '');
    if (clean.startsWith('234') && clean.length === 13) {
      return `+${clean}`;
    }
    if (clean.startsWith('0') && clean.length === 11) {
      return `+234${clean.substring(1)}`;
    }
    if (clean.length > 13) {
      return `+${clean}`;
    }
    return clean ? `+${clean}` : 'Not specified';
  }

  /**
   * Normalizes phone number into international numeric string (e.g. 2348012345678)
   */


  normalizePhoneNumber(rawPhone: string): string {
    if (!rawPhone) return '';
    let cleaned = rawPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').trim();
    cleaned = cleaned.replace(/[^0-9]/g, '');

    // Nigerian local 080... or 070... format -> 23480...
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      cleaned = '234' + cleaned.substring(1);
    }

    return cleaned;
  }

  /**
   * Normalize department names with typo tolerance (e.g., Mdia -> media, Ushers -> ushering)
   */
  normalizeDepartment(rawDept?: string): string {
    if (!rawDept) return 'media';
    const cleaned = rawDept.toLowerCase().trim().replace(/[^a-z]/g, '');

    if (
      cleaned.startsWith('medi') ||
      cleaned === 'mdia' ||
      cleaned === 'media' ||
      cleaned.includes('stream') ||
      cleaned.includes('sound') ||
      cleaned.includes('camera') ||
      cleaned.includes('it')
    ) {
      return 'media';
    }
    if (
      cleaned.startsWith('choir') ||
      cleaned.startsWith('sing') ||
      cleaned.startsWith('music') ||
      cleaned.startsWith('praise') ||
      cleaned.startsWith('band')
    ) {
      return 'choir';
    }
    if (cleaned.startsWith('usher') || cleaned === 'ushering' || cleaned === 'ushers') {
      return 'ushering';
    }
    if (cleaned.startsWith('proto') || cleaned === 'protocol') {
      return 'protocol';
    }
    if (cleaned.startsWith('pray') || cleaned.startsWith('interces')) {
      return 'prayer';
    }
    if (
      cleaned.startsWith('child') ||
      cleaned.startsWith('teen') ||
      cleaned.startsWith('junior') ||
      cleaned.includes('sunday')
    ) {
      return 'children';
    }
    if (cleaned.startsWith('welf') || cleaned.startsWith('hospit') || cleaned.startsWith('care')) {
      return 'welfare';
    }

    const validDepartments = Object.values(Department).map((d) => d.toLowerCase());
    return validDepartments.includes(cleaned) ? cleaned : 'media';
  }

  async create(createWorkerDto: CreateWorkerDto): Promise<Worker> {
    const normalizedPhone = this.normalizePhoneNumber(createWorkerDto.phone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      throw new BadRequestException('Invalid phone number format');
    }

    const existing = await this.prisma.worker.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existing) {
      throw new ConflictException(
        `Worker with phone ${normalizedPhone} already exists (${existing.fullName})`,
      );
    }

    const department = this.normalizeDepartment(createWorkerDto.department);

    return this.prisma.worker.create({
      data: {
        fullName: createWorkerDto.fullName.trim(),
        phone: normalizedPhone,
        department,
        unit: createWorkerDto.unit?.trim() || null,
        role: createWorkerDto.role || 'Member',
        email: createWorkerDto.email,
        birthday: createWorkerDto.birthday,
        joinedDate: createWorkerDto.joinedDate,
        maritalStatus: createWorkerDto.maritalStatus,
        attendedDLI: createWorkerDto.attendedDLI,
        attendedDCA: createWorkerDto.attendedDCA,
        attendedEncounter: createWorkerDto.attendedEncounter,
        address: createWorkerDto.address,
        isActive: createWorkerDto.isActive !== undefined ? createWorkerDto.isActive : true,
        isHOD: createWorkerDto.isHOD !== undefined ? createWorkerDto.isHOD : false,
      },
    });
  }

  async findAll(query?: QueryWorkerDto): Promise<Worker[]> {
    const where: any = {};

    if (query?.department) {
      where.department = this.normalizeDepartment(query.department);
    }

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query?.q) {
      const searchTerm = query.q.trim();
      const normalizedPhone = this.normalizePhoneNumber(searchTerm);

      where.OR = [
        { fullName: { contains: searchTerm } },
        { role: { contains: searchTerm } },
        { unit: { contains: searchTerm } },
        { phone: { contains: normalizedPhone || searchTerm } },
      ];
    }

    return this.prisma.worker.findMany({
      where,
      orderBy: [{ department: 'asc' }, { fullName: 'asc' }],
    });
  }

  async findOne(id: string): Promise<Worker> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) {
      throw new NotFoundException(`Worker with ID ${id} not found`);
    }
    return worker;
  }

  /**
   * Helper to generate Nigerian phone number variants (080..., 23480..., 80...)
   */
  getPhoneVariants(rawPhone: string): string[] {
    const normalized = this.normalizePhoneNumber(rawPhone);
    if (!normalized) return [];

    const variants = new Set<string>();
    variants.add(normalized);

    if (normalized.startsWith('234') && normalized.length === 13) {
      variants.add('0' + normalized.substring(3));
      variants.add(normalized.substring(3));
    } else if (normalized.startsWith('0') && normalized.length === 11) {
      variants.add('234' + normalized.substring(1));
      variants.add(normalized.substring(1));
    } else if (normalized.length === 10) {
      variants.add('0' + normalized);
      variants.add('234' + normalized);
    }

    return Array.from(variants);
  }

  async findByPhone(rawPhone: string): Promise<Worker | null> {
    const variants = this.getPhoneVariants(rawPhone);
    if (variants.length === 0) return null;

    return this.prisma.worker.findFirst({
      where: {
        OR: variants.map((p) => ({ phone: p })),
        isActive: true,
      },
    });
  }

  async findByPhoneOrLid(rawPhone?: string | null, rawLid?: string | null): Promise<Worker | null> {
    const variants = rawPhone ? this.getPhoneVariants(rawPhone) : [];
    const cleanLid = rawLid?.trim() || null;

    if (variants.length === 0 && !cleanLid) return null;

    const conditions: any[] = [];
    if (variants.length > 0) {
      variants.forEach((p) => conditions.push({ phone: p }));
    }
    if (cleanLid) {
      conditions.push({ lid: cleanLid });
    }

    return this.prisma.worker.findFirst({
      where: {
        OR: conditions,
        isActive: true,
      },
    });
  }

  async findByTelegramId(telegramId: string | number): Promise<Worker | null> {
    if (!telegramId) return null;
    return this.prisma.worker.findFirst({
      where: {
        telegramId: telegramId.toString(),
        isActive: true,
      },
    });
  }

  async linkLid(workerId: string, lid: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id: workerId },
      data: { lid: lid.trim() },
    });
  }

  async linkTelegramId(workerId: string, telegramId: string | number, username?: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id: workerId },
      data: {
        telegramId: telegramId.toString(),
        telegramUsername: username?.trim() || undefined,
        lastInteractedAt: new Date(),
      },
    });
  }

  async findHodByDepartment(department: string): Promise<Worker | null> {
    return this.prisma.worker.findFirst({
      where: {
        department: this.normalizeDepartment(department),
        isHOD: true,
        isActive: true,
      },
    });
  }

  async findUnitHeadByDepartmentAndUnit(department: string, unit: string): Promise<Worker | null> {
    return this.prisma.worker.findFirst({
      where: {
        department: this.normalizeDepartment(department),
        unit: { equals: unit },
        isUnitHead: true,
        isActive: true,
      },
    });
  }

  async findLeadersForDepartmentAndUnit(department: string, unit?: string | null): Promise<Worker[]> {
    const normalizedDept = this.normalizeDepartment(department);
    return this.prisma.worker.findMany({
      where: {
        department: normalizedDept,
        isActive: true,
        OR: [
          { isHOD: true },
          ...(unit ? [{ isUnitHead: true, unit: { equals: unit } }] : [{ isUnitHead: true }]),
        ],
      },
    });
  }

  isLeader(worker: Worker): boolean {
    return Boolean(
      worker.isHOD ||
      worker.isUnitHead ||
      worker.role?.toLowerCase().includes('head') ||
      worker.role?.toLowerCase().includes('lead') ||
      worker.role?.toLowerCase().includes('director'),
    );
  }

  async findByDepartment(department: string, onlyActive = true): Promise<Worker[]> {
    return this.prisma.worker.findMany({
      where: {
        department: this.normalizeDepartment(department),
        ...(onlyActive ? { isActive: true } : {}),
      },
      orderBy: [{ isHOD: 'desc' }, { role: 'asc' }, { fullName: 'asc' }],
    });
  }

  async update(id: string, updateWorkerDto: UpdateWorkerDto): Promise<Worker> {
    await this.findOne(id);

    const data: any = { ...updateWorkerDto };

    if (updateWorkerDto.phone) {
      const normalizedPhone = this.normalizePhoneNumber(updateWorkerDto.phone);
      const existing = await this.prisma.worker.findUnique({
        where: { phone: normalizedPhone },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Another worker already has phone number ${normalizedPhone}`,
        );
      }
      data.phone = normalizedPhone;
    }

    if (updateWorkerDto.department) {
      data.department = this.normalizeDepartment(updateWorkerDto.department);
    }

    if (updateWorkerDto.unit !== undefined) {
      data.unit = updateWorkerDto.unit?.trim() || null;
    }

    return this.prisma.worker.update({
      where: { id },
      data,
    });
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const worker = await this.findOne(id);
    await this.prisma.worker.delete({ where: { id } });
    return { success: true, message: `Worker ${worker.fullName} deleted successfully` };
  }

  async markInteracted(id: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: { lastInteractedAt: new Date() },
    });
  }

  /**
   * Bulk import workers from file buffer (CSV or Excel)
   */
  async importFromBuffer(fileBuffer: Buffer): Promise<BulkImportResult> {
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    return this.processBatchRows(rows);
  }

  /**
   * Bulk import workers from CSV file buffer
   */
  async importFromCsv(fileBuffer: Buffer): Promise<BulkImportResult> {
    return this.importFromBuffer(fileBuffer);
  }

  /**
   * Bulk import workers from Excel file buffer
   */
  async importFromExcel(fileBuffer: Buffer): Promise<BulkImportResult> {
    return this.importFromBuffer(fileBuffer);
  }

  /**
   * Clean WhatsApp hidden characters, directional marks, and unicode spaces
   */
  cleanWhatsAppText(text: string): string {
    if (!text) return '';
    return text
      // Remove zero-width characters, word joiners, bidi marks, and BOM
      .replace(/[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      // Normalize diverse unicode whitespace to standard space
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  }

  /**
   * Check if text matches the WhatsApp registration format
   */
  isRegistrationFormText(text: string): boolean {
    const cleaned = this.cleanWhatsAppText(text);
    const lower = cleaned.toLowerCase();
    const hasName = lower.includes('full name') || lower.includes('name:');
    const hasOtherKey =
      lower.includes('marital status') ||
      lower.includes('dli') ||
      lower.includes('dca') ||
      lower.includes('encounter') ||
      lower.includes('full address') ||
      lower.includes('date of birth') ||
      lower.includes('phone number') ||
      lower.includes('department') ||
      lower.includes('unit');

    return hasName && hasOtherKey;
  }

  /**
   * Parse WhatsApp formatted member registration text
   */
  parseRegistrationForm(text: string, fallbackPhone?: string): Partial<CreateWorkerDto> | null {
    const cleanedText = this.cleanWhatsAppText(text);
    const lines = cleanedText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const data: Partial<CreateWorkerDto> = {};

    for (const rawLine of lines) {
      // Strip any numbering prefix (e.g. 1., 1), (1), #1, 1 -, •, -, *) and leading markdown symbols
      const line = rawLine
        .replace(/^\s*(?:[#\(\[\{]?\d+[\.\)\-:\/\]\}]*|\d+\s*[-.]|[-*•>~])\s*/, '')
        .replace(/^[*_~]+/, '')
        .trim();

      // Full Name
      const nameMatch = line.match(/^(?:full\s*name|fullname|name|worker\s*name)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (nameMatch) {
        data.fullName = nameMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Marital Status
      const maritalMatch = line.match(/^(?:marital\s*status|marital)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (maritalMatch) {
        data.maritalStatus = maritalMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Department
      const deptMatch = line.match(/^(?:department|dept)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (deptMatch) {
        data.department = this.normalizeDepartment(deptMatch[1].replace(/[*_~]+$/, '').trim()) as Department;
        continue;
      }

      // Unit
      const unitMatch = line.match(/^(?:unit|departmental\s*unit|sub\s*unit)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (unitMatch) {
        data.unit = unitMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // DLI
      const dliMatch = line.match(/^(?:(?:have\s+you\s+attended\s+)?dli\??|attended\s+dli)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (dliMatch) {
        data.attendedDLI = dliMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // DCA
      const dcaMatch = line.match(/^(?:(?:have\s+you\s+attended\s+)?dca\??|attended\s+dca)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (dcaMatch) {
        data.attendedDCA = dcaMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Phone Number
      const phoneMatch = line.match(/^(?:phone(?:\s*number)?|mobile|tel|phone_number)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (phoneMatch) {
        data.phone = phoneMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Encounter Retreat (handles "Encounter retreat: Attended: yes" or "Encounter retreat: yes")
      const encounterMatch = line.match(
        /^(?:encounter(?:\s*retreat)?(?:\s*[:\-]\s*attended)?|attended\s+encounter(?:\s*retreat)?)\s*[*_~]*\s*[:=]\s*(?:attended\s*[:=]\s*)?(.+)$/i,
      );
      if (encounterMatch) {
        data.attendedEncounter = encounterMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Full Address
      const addressMatch = line.match(
        /^(?:full\s*address|residential\s*address|address|home\s*address)\s*[*_~]*\s*[:=]\s*(.+)$/i,
      );
      if (addressMatch) {
        data.address = addressMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Date of Birth
      const dobMatch = line.match(/^(?:date\s*of\s*birth|dob|birthday|birth\s*date)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (dobMatch) {
        data.birthday = dobMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }

      // Role
      const roleMatch = line.match(/^(?:role)\s*[*_~]*\s*[:=]\s*(.+)$/i);
      if (roleMatch) {
        data.role = roleMatch[1].replace(/[*_~]+$/, '').trim();
        continue;
      }
    }

    if (!data.phone && fallbackPhone) {
      data.phone = fallbackPhone;
    }

    if (!data.fullName && !data.phone) {
      return null;
    }

    return data;
  }

  /**
   * Analyze submitted form text and return received vs missing fields
   */
  async analyzeRegistrationForm(
    text: string,
    fallbackPhone?: string,
  ): Promise<{
    data: Partial<CreateWorkerDto>;
    received: { field: string; value: string }[];
    missing: { field: string; example: string; required: boolean }[];
    isValid: boolean;
    deptValidation: {
      isValidDept: boolean;
      isValidUnit: boolean;
      availableUnits: string[];
    };
  }> {
    const data = this.parseRegistrationForm(text, fallbackPhone) || {};
    const received: { field: string; value: string }[] = [];
    const missing: { field: string; example: string; required: boolean }[] = [];

    const fieldDefinitions: {
      key: keyof CreateWorkerDto;
      label: string;
      example: string;
      required: boolean;
    }[] = [
      { key: 'fullName', label: 'Full Name', example: 'John Doe', required: true },
      { key: 'phone', label: 'Phone Number', example: '08012345678', required: true },
      { key: 'maritalStatus', label: 'Marital Status', example: 'Single', required: false },
      { key: 'department', label: 'Department', example: 'Media', required: true },
      { key: 'unit', label: 'Unit', example: 'Sound', required: true },
      { key: 'attendedDLI', label: 'Have you attended DLI?', example: 'Yes', required: false },
      { key: 'attendedDCA', label: 'Have you attended DCA?', example: 'Yes', required: false },
      { key: 'attendedEncounter', label: 'Encounter retreat', example: 'Attended: yes', required: false },
      { key: 'address', label: 'Full Address', example: '123 Sample Street, City', required: false },
      { key: 'birthday', label: 'Date of Birth', example: '15 June', required: false },
    ];

    for (const def of fieldDefinitions) {
      const val = (data as any)[def.key];
      if (val !== undefined && val !== null && String(val).trim().length > 0) {
        received.push({ field: def.label, value: String(val).trim() });
      } else {
        missing.push({ field: def.label, example: def.example, required: def.required });
      }
    }

    const deptVal = await this.departmentsService.validateDepartmentAndUnit(
      data.department || '',
      data.unit || '',
    );

    if (deptVal.matchedDepartment) {
      data.department = deptVal.matchedDepartment as Department;
    }
    if (deptVal.matchedUnit) {
      data.unit = deptVal.matchedUnit;
    }

    const isValid = Boolean(
      data.fullName &&
      data.phone &&
      deptVal.isValidDept &&
      deptVal.isValidUnit,
    );

    return {
      data,
      received,
      missing,
      isValid,
      deptValidation: {
        isValidDept: deptVal.isValidDept,
        isValidUnit: deptVal.isValidUnit,
        availableUnits: deptVal.availableUnits,
      },
    };
  }

  /**
   * Create a pending member registration request awaiting HOD / Unit Head review
   */
  async createRegistrationRequest(
    formData: Partial<CreateWorkerDto>,
    lid?: string | null,
  ): Promise<RegistrationRequest> {
    if (!formData.fullName) throw new BadRequestException('Full Name is required');
    if (!formData.phone) throw new BadRequestException('Phone Number is required');

    const normalizedPhone = this.normalizePhoneNumber(formData.phone);
    const department = this.normalizeDepartment(formData.department || 'media');
    const unit = formData.unit?.trim() || 'General';

    // Delete any previous pending request for this phone
    await this.prisma.registrationRequest.deleteMany({
      where: { phone: normalizedPhone, status: 'PENDING' },
    });

    return this.prisma.registrationRequest.create({
      data: {
        fullName: formData.fullName.trim(),
        phone: normalizedPhone,
        department,
        unit,
        role: formData.role || 'Member',
        birthday: formData.birthday || null,
        maritalStatus: formData.maritalStatus || null,
        attendedDLI: formData.attendedDLI || null,
        attendedDCA: formData.attendedDCA || null,
        attendedEncounter: formData.attendedEncounter || null,
        address: formData.address || null,
        lid: lid?.trim() || null,
        status: 'PENDING',
      },
    });
  }

  /**
   * Find pending registration requests assigned to a Leader (HOD or Unit Head)
   */
  async findPendingRequestsForLeader(leader: Worker): Promise<RegistrationRequest[]> {
    if (leader.isHOD) {
      return this.prisma.registrationRequest.findMany({
        where: {
          department: this.normalizeDepartment(leader.department),
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (leader.isUnitHead && leader.unit) {
      return this.prisma.registrationRequest.findMany({
        where: {
          department: this.normalizeDepartment(leader.department),
          unit: leader.unit,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return [];
  }

  /**
   * Find all pending registration requests across all departments for System Admin
   */
  async findPendingRequestsForAdmin(): Promise<RegistrationRequest[]> {
    return this.prisma.registrationRequest.findMany({
      where: {
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find active workers for a leader (HOD sees department, Unit Head sees unit)
   */
  async findMembersForLeader(leader: Worker): Promise<Worker[]> {
    if (leader.isHOD) {
      return this.prisma.worker.findMany({
        where: {
          department: this.normalizeDepartment(leader.department),
          isActive: true,
        },
        orderBy: [{ isHOD: 'desc' }, { isUnitHead: 'desc' }, { fullName: 'asc' }],
      });
    }

    if (leader.isUnitHead && leader.unit) {
      return this.prisma.worker.findMany({
        where: {
          department: this.normalizeDepartment(leader.department),
          unit: leader.unit,
          isActive: true,
        },
        orderBy: [{ isUnitHead: 'desc' }, { fullName: 'asc' }],
      });
    }

    return [];
  }

  /**
   * Find active workers for Admin across all departments
   */
  async findMembersForAdmin(department?: string): Promise<Worker[]> {
    const where: any = { isActive: true };
    if (department) {
      where.department = this.normalizeDepartment(department);
    }

    return this.prisma.worker.findMany({
      where,
      orderBy: [{ department: 'asc' }, { isHOD: 'desc' }, { isUnitHead: 'desc' }, { fullName: 'asc' }],
    });
  }

  /**
   * Search members for Admin, HOD, or Unit Head with scope boundaries
   */
  async searchMembersForLeader(
    searchTerm: string,
    leader: Worker | null,
    isAdmin = false,
  ): Promise<Worker[]> {
    const cleanTerm = searchTerm.trim().toLowerCase();
    if (!cleanTerm) return [];

    const normalizedPhone = this.normalizePhoneNumber(cleanTerm);
    const phoneVariants = this.getPhoneVariants(cleanTerm);

    const baseWhere: any = { isActive: true };
    if (!isAdmin && leader) {
      baseWhere.department = this.normalizeDepartment(leader.department);
      if (leader.isUnitHead && !leader.isHOD && leader.unit) {
        baseWhere.unit = leader.unit;
      }
    }

    const allScopedWorkers = await this.prisma.worker.findMany({
      where: baseWhere,
      orderBy: [{ department: 'asc' }, { isHOD: 'desc' }, { isUnitHead: 'desc' }, { fullName: 'asc' }],
    });

    // Case-insensitive multi-field search
    const filtered = allScopedWorkers.filter((w) => {
      const nameMatch = w.fullName ? w.fullName.toLowerCase().includes(cleanTerm) : false;
      const roleMatch = w.role ? w.role.toLowerCase().includes(cleanTerm) : false;
      const unitMatch = w.unit ? w.unit.toLowerCase().includes(cleanTerm) : false;
      const deptMatch = w.department ? w.department.toLowerCase().includes(cleanTerm) : false;
      const addressMatch = w.address ? w.address.toLowerCase().includes(cleanTerm) : false;
      const emailMatch = w.email ? w.email.toLowerCase().includes(cleanTerm) : false;
      const birthdayMatch = w.birthday ? w.birthday.toLowerCase().includes(cleanTerm) : false;
      const phoneMatch =
        (w.phone && w.phone.toLowerCase().includes(cleanTerm)) ||
        (normalizedPhone && w.phone && w.phone.includes(normalizedPhone)) ||
        phoneVariants.some((pv) => w.phone && w.phone.includes(pv));

      return Boolean(
        nameMatch ||
        roleMatch ||
        unitMatch ||
        deptMatch ||
        addressMatch ||
        emailMatch ||
        birthdayMatch ||
        phoneMatch,
      );
    });

    return filtered.slice(0, 25);
  }

  /**
   * Find a registration request by ID (supports partial/short prefix search)
   */
  async findPendingRequestById(id: string): Promise<RegistrationRequest | null> {
    const cleanId = id.trim();
    return this.prisma.registrationRequest.findFirst({
      where: {
        OR: [
          { id: cleanId },
          { id: { startsWith: cleanId } },
        ],
      },
    });
  }

  /**
   * Find a pending registration request by phone number
   */
  async findPendingRequestByPhone(rawPhone: string): Promise<RegistrationRequest | null> {
    const variants = this.getPhoneVariants(rawPhone);
    if (variants.length === 0) return null;

    return this.prisma.registrationRequest.findFirst({
      where: {
        OR: variants.map((p) => ({ phone: p })),
        status: 'PENDING',
      },
    });
  }

  /**
   * Intelligently resolve a pending registration request by ID, index number, name, phone, or quoted text
   */
  async resolvePendingRequest(
    identifier: string | undefined,
    leader: Worker | null,
    isAdmin = false,
    quotedText?: string,
  ): Promise<RegistrationRequest | null> {
    const rawInput = (identifier || '').trim();

    // 1. If explicit UUID or shortId is provided
    if (rawInput && rawInput.length >= 6) {
      const match = await this.findPendingRequestById(rawInput);
      if (match && match.status === 'PENDING') return match;
    }

    // 2. If leader swiped/replied to a notification message (quoted message context)
    if (quotedText) {
      // Look for full or 8-character ID in quoted text
      const idMatch =
        quotedText.match(/ID:\s*([a-f0-9-]+)/i) ||
        quotedText.match(/(?:#accept|#reject|accept_|reject_)\s*([a-f0-9-]+)/i);
      if (idMatch && idMatch[1]) {
        const match = await this.findPendingRequestById(idMatch[1]);
        if (match && match.status === 'PENDING') return match;
      }

      // Look for phone in quoted text
      const phoneMatch = quotedText.match(/(?:Phone|📱):\s*(\+?[0-9\s-]{8,})/i);
      if (phoneMatch && phoneMatch[1]) {
        const norm = this.normalizePhoneNumber(phoneMatch[1]);
        const match = await this.prisma.registrationRequest.findFirst({
          where: {
            phone: { contains: norm.slice(-8) },
            status: 'PENDING',
          },
        });
        if (match) return match;
      }
    }

    // Retrieve active pending list for this leader's scope
    const list = isAdmin
      ? await this.findPendingRequestsForAdmin()
      : leader
        ? await this.findPendingRequestsForLeader(leader)
        : [];

    if (list.length === 0) return null;

    // 3. If identifier is an index number (e.g. "1", "2", "3")
    if (rawInput && /^\d+$/.test(rawInput)) {
      const idx = parseInt(rawInput, 10) - 1;
      if (idx >= 0 && idx < list.length) {
        return list[idx];
      }
    }

    // 4. If identifier matches an applicant name, phone, or unit
    if (rawInput && rawInput.length >= 3) {
      const lower = rawInput.toLowerCase();
      const match = list.find(
        (r) =>
          r.fullName.toLowerCase().includes(lower) ||
          r.phone.includes(lower) ||
          (r.unit && r.unit.toLowerCase().includes(lower)),
      );
      if (match) return match;
    }

    // 5. If no identifier or empty string was provided (e.g. user just clicked/typed "accept" / "approve")
    // and there is exactly 1 pending request in their scope, auto-pick that single request!
    if (!rawInput && list.length === 1) {
      return list[0];
    }

    return null;
  }


  /**
   * Approve a registration request: activate worker profile and update status
   */
  async approveRegistrationRequest(
    requestId: string,
    reviewer: Worker | { fullName: string; isHOD?: boolean; isUnitHead?: boolean; unit?: string | null; department?: string; isAdmin?: boolean },
  ): Promise<{ request: RegistrationRequest; worker: Worker }> {
    const request = await this.findPendingRequestById(requestId);
    if (!request) {
      throw new NotFoundException(`Registration request ${requestId} was not found.`);
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This registration request has already been ${request.status.toLowerCase()}.`);
    }

    const isAdmin = Boolean((reviewer as any).isAdmin);
    const isHodForDept = Boolean((reviewer as any).isHOD && (reviewer as any).department === request.department);
    const isUnitHeadForUnit = Boolean(
      (reviewer as any).isUnitHead &&
      (reviewer as any).department === request.department &&
      (!((reviewer as any).unit) || !request.unit || (reviewer as any).unit?.trim().toLowerCase() === request.unit?.trim().toLowerCase())
    );

    if (!isAdmin && !isHodForDept && !isUnitHeadForUnit) {
      throw new BadRequestException(
        `You are not authorized to approve workers for ${request.department.toUpperCase()}${request.unit ? ' (' + request.unit + ')' : ''}. Only Admins, HODs, and Unit Heads can approve registrations.`,
      );
    }

    const reviewerTag = isAdmin ? 'Admin' : (reviewer as any).isHOD ? 'HOD' : 'Unit Head';
    const updatedRequest = await this.prisma.registrationRequest.update({
      where: { id: request.id },
      data: {
        status: 'ACCEPTED',
        reviewedBy: reviewer.fullName,
        reviewNote: `Approved by ${reviewer.fullName} (${reviewerTag})`,
      },
    });

    const { worker } = await this.upsertWorkerFromForm(
      {
        fullName: request.fullName,
        phone: request.phone,
        department: request.department as Department,
        unit: request.unit,
        role: request.role,
        birthday: request.birthday || undefined,
        maritalStatus: request.maritalStatus || undefined,
        attendedDLI: request.attendedDLI || undefined,
        attendedDCA: request.attendedDCA || undefined,
        attendedEncounter: request.attendedEncounter || undefined,
        address: request.address || undefined,
      },
      request.lid,
    );

    return { request: updatedRequest, worker };
  }

  /**
   * Reject a registration request
   */
  async rejectRegistrationRequest(
    requestId: string,
    reviewer: Worker | { fullName: string; isHOD?: boolean; isUnitHead?: boolean; unit?: string | null; department?: string; isAdmin?: boolean },
    reason?: string,
  ): Promise<RegistrationRequest> {
    const request = await this.findPendingRequestById(requestId);
    if (!request) {
      throw new NotFoundException(`Registration request ${requestId} was not found.`);
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This registration request has already been ${request.status.toLowerCase()}.`);
    }

    const isAdmin = Boolean((reviewer as any).isAdmin);
    const isHodForDept = Boolean((reviewer as any).isHOD && (reviewer as any).department === request.department);
    const isUnitHeadForUnit = Boolean(
      (reviewer as any).isUnitHead &&
      (reviewer as any).department === request.department &&
      (!((reviewer as any).unit) || !request.unit || (reviewer as any).unit?.trim().toLowerCase() === request.unit?.trim().toLowerCase())
    );

    if (!isAdmin && !isHodForDept && !isUnitHeadForUnit) {
      throw new BadRequestException(
        `You are not authorized to decline registrations for ${request.department.toUpperCase()}${request.unit ? ' (' + request.unit + ')' : ''}. Only Admins, HODs, and Unit Heads can reject registrations.`,
      );
    }

    const reviewerTag = isAdmin ? 'Admin' : (reviewer as any).isHOD ? 'HOD' : 'Unit Head';
    return this.prisma.registrationRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewer.fullName,
        reviewNote: reason || `Registration declined by ${reviewer.fullName} (${reviewerTag}).`,
      },
    });
  }

  /**
   * Get available units for a department
   */
  async getUnitsForDepartment(department: string): Promise<string[]> {
    return this.departmentsService.getUnitsForDepartment(department);
  }

  /**
   * Appoint a department member as Head of Unit (HOD can appoint within their department, Admin church-wide)
   */
  async appointUnitHead(
    targetWorkerIdentifier: string,
    targetUnitName: string,
    actor: Worker | { fullName: string; isHOD?: boolean; department?: string; isAdmin?: boolean },
  ): Promise<{ worker: Worker; unit: string; appointedBy: string }> {
    const isAdmin = Boolean((actor as any).isAdmin);
    const isHOD = Boolean((actor as any).isHOD && (actor as any).department);

    if (!isAdmin && !isHOD) {
      throw new BadRequestException(
        'Access Denied: Only Department Heads (HOD) and System Administrators can appoint a Head of Unit.',
      );
    }

    const cleanIdentifier = (targetWorkerIdentifier || '').trim();
    if (!cleanIdentifier) {
      throw new BadRequestException('Please specify the worker (name, phone, or list number).');
    }

    const actorDept = (actor as any).department ? this.normalizeDepartment((actor as any).department) : null;

    // 1. Find candidate worker
    let candidate: Worker | null = null;

    // Check if numeric index from member list (e.g. "1", "2")
    if (/^\d+$/.test(cleanIdentifier)) {
      const idx = parseInt(cleanIdentifier, 10) - 1;
      const membersList = isAdmin
        ? await this.findMembersForAdmin()
        : await this.findMembersForLeader(actor as Worker);
      if (idx >= 0 && idx < membersList.length) {
        candidate = membersList[idx];
      }
    }

    // If not found by index, look by phone or name or ID
    if (!candidate) {
      const normalizedPhone = this.normalizePhoneNumber(cleanIdentifier);
      const whereScope: any = { isActive: true };
      if (!isAdmin && actorDept) {
        whereScope.department = actorDept;
      }

      candidate = await this.prisma.worker.findFirst({
        where: {
          ...whereScope,
          OR: [
            ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
            { phone: cleanIdentifier },
            { phone: { contains: cleanIdentifier.slice(-8) } },
            { fullName: { contains: cleanIdentifier } },
            { id: cleanIdentifier },
          ],
        },
      });
    }

    if (!candidate) {
      const scopeMsg = isHOD ? `in your ${actorDept?.toUpperCase()} department` : 'in the workforce';
      throw new NotFoundException(`Worker "${cleanIdentifier}" was not found ${scopeMsg}.`);
    }

    // Verify candidate is in the HOD's department
    if (!isAdmin && actorDept && candidate.department !== actorDept) {
      throw new BadRequestException(
        `Worker ${candidate.fullName} belongs to ${candidate.department.toUpperCase()} department. You can only appoint members in your own department (${actorDept.toUpperCase()}).`,
      );
    }

    // 2. Validate Target Unit
    const targetDept = candidate.department;
    let chosenUnit: string | null = null;

    if (targetUnitName && targetUnitName.trim()) {
      const deptVal = await this.departmentsService.validateDepartmentAndUnit(
        targetDept,
        targetUnitName,
      );

      chosenUnit = deptVal.matchedUnit;
      if (!chosenUnit) {
        const availableUnits = await this.departmentsService.getUnitsForDepartment(targetDept);
        const lowerTarget = targetUnitName.toLowerCase().trim();
        chosenUnit =
          availableUnits.find(
            (u) =>
              u.toLowerCase().includes(lowerTarget) ||
              lowerTarget.includes(u.toLowerCase()) ||
              u.toLowerCase().replace(/[^a-z0-9]/g, '') === lowerTarget.replace(/[^a-z0-9]/g, ''),
          ) || null;

        if (!chosenUnit) {
          throw new BadRequestException(
            `Unit "${targetUnitName}" is not a recognized unit for ${targetDept.toUpperCase()} department.\nOfficial Units: ${availableUnits.join(', ')}`,
          );
        }
      }
    } else if (candidate.unit) {
      chosenUnit = candidate.unit;
    } else {
      const availableUnits = await this.departmentsService.getUnitsForDepartment(targetDept);
      throw new BadRequestException(
        `Please specify the unit name. Available units for ${targetDept.toUpperCase()}: ${availableUnits.join(', ')}`,
      );
    }

    // 3. Update worker to Head of Unit
    const updated = await this.prisma.worker.update({
      where: { id: candidate.id },
      data: {
        isUnitHead: true,
        unit: chosenUnit,
        role: 'Head of Unit',
      },
    });

    const appointedBy = isAdmin
      ? `${actor.fullName} (System Admin)`
      : `${actor.fullName} (HOD ${actorDept?.toUpperCase()})`;

    return {
      worker: updated,
      unit: chosenUnit,
      appointedBy,
    };
  }


  /**
   * Upsert a worker from registration data
   */
  async upsertWorkerFromForm(
    formData: Partial<CreateWorkerDto>,
    lid?: string | null,
  ): Promise<{ worker: Worker; isNew: boolean }> {
    if (!formData.fullName) {
      throw new BadRequestException('Full Name is required');
    }
    if (!formData.phone) {
      throw new BadRequestException('Phone Number is required');
    }

    const normalizedPhone = this.normalizePhoneNumber(formData.phone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      throw new BadRequestException(`Invalid phone number: ${formData.phone}`);
    }

    const cleanLid = lid?.trim() || null;

    const existing = await this.prisma.worker.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          ...(cleanLid ? [{ lid: cleanLid }] : []),
        ],
      },
    });

    const department = this.normalizeDepartment(formData.department || existing?.department || 'media');

    if (existing) {
      const updated = await this.prisma.worker.update({
        where: { id: existing.id },
        data: {
          fullName: formData.fullName.trim(),
          phone: normalizedPhone,
          department,
          ...(formData.unit !== undefined && { unit: formData.unit?.trim() || null }),
          role: formData.role || existing.role,
          ...(formData.birthday && { birthday: formData.birthday }),
          ...(formData.maritalStatus && { maritalStatus: formData.maritalStatus }),
          ...(formData.attendedDLI && { attendedDLI: formData.attendedDLI }),
          ...(formData.attendedDCA && { attendedDCA: formData.attendedDCA }),
          ...(formData.attendedEncounter && { attendedEncounter: formData.attendedEncounter }),
          ...(formData.address && { address: formData.address }),
          ...(cleanLid && { lid: cleanLid }),
          isActive: true,
        },
      });
      return { worker: updated, isNew: false };
    }

    const created = await this.prisma.worker.create({
      data: {
        fullName: formData.fullName.trim(),
        phone: normalizedPhone,
        department,
        unit: formData.unit?.trim() || null,
        role: formData.role || 'Member',
        email: formData.email,
        birthday: formData.birthday,
        joinedDate: formData.joinedDate,
        maritalStatus: formData.maritalStatus,
        attendedDLI: formData.attendedDLI,
        attendedDCA: formData.attendedDCA,
        attendedEncounter: formData.attendedEncounter,
        address: formData.address,
        lid: cleanLid,
        isActive: true,
        isHOD: formData.isHOD || false,
      },
    });

    return { worker: created, isNew: true };
  }

  /**
   * Split text into distinct member registration blocks based on Full Name headers
   */
  splitIntoMemberBlocks(text: string): string[] {
    const cleanedText = this.cleanWhatsAppText(text);
    const nameMatches = [
      ...cleanedText.matchAll(
        /(?:^|\n)\s*(?:[#\(\[\{]?\d+[\.\)\-:\/\]\}]*|\d+\s*[-.]|[-*•>~])?\s*[*_~]*\s*(?:full\s*name|fullname|name|worker\s*name)\s*[*_~]*\s*[:=]/gi,
      ),
    ];

    if (nameMatches.length <= 1) {
      return [cleanedText.trim()];
    }

    const blocks: string[] = [];
    for (let i = 0; i < nameMatches.length; i++) {
      const start = nameMatches[i].index!;
      const end = i + 1 < nameMatches.length ? nameMatches[i + 1].index! : cleanedText.length;
      const block = cleanedText.substring(start, end).trim();
      if (block.length > 0) {
        blocks.push(block);
      }
    }
    return blocks;
  }

  /**
   * Bulk import workers from multiline raw text
   */
  async importFromText(text: string): Promise<BulkImportResult> {
    if (this.isRegistrationFormText(text)) {
      const blocks = this.splitIntoMemberBlocks(text);
      const rows: any[] = [];

      for (const block of blocks) {
        const parsed = this.parseRegistrationForm(block);
        if (parsed && (parsed.fullName || parsed.phone)) {
          rows.push({
            fullName: parsed.fullName,
            phone: parsed.phone,
            department: parsed.department,
            unit: parsed.unit,
            role: parsed.role,
            birthday: parsed.birthday,
            maritalStatus: parsed.maritalStatus,
            attendedDLI: parsed.attendedDLI,
            attendedDCA: parsed.attendedDCA,
            attendedEncounter: parsed.attendedEncounter,
            address: parsed.address,
          });
        }
      }

      if (rows.length > 0) {
        return this.processBatchRows(rows);
      }
    }

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const rows = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        fullName: parts[0] || '',
        phone: parts[1] || '',
        department: parts[2] || 'media',
        role: parts[3] || 'Member',
        unit: parts[4] || undefined,
        birthday: parts[5] || undefined,
        joinedDate: parts[6] || undefined,
        isHOD: parts[7] ? parts[7].toLowerCase() === 'true' || parts[7] === '1' : false,
      };
    });

    return this.processBatchRows(rows);
  }

  private async processBatchRows(rows: any[]): Promise<BulkImportResult> {
    const result: BulkImportResult = {
      total: rows.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      workers: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 1;

      const fullName = (row.fullName || row['Full Name'] || row.name || row.Name || '').toString().trim();
      const rawPhone = (row.phone || row['Phone'] || row['Phone Number'] || row.mobile || '').toString().trim();
      const rawDept = (row.department || row['Department'] || row.dept || 'media').toString().trim();
      const unit = (row.unit || row['Unit'] || '').toString().trim() || null;
      const role = (row.role || row['Role'] || 'Member').toString().trim();
      const email = (row.email || row['Email'] || '').toString().trim() || undefined;
      const birthday = (row.birthday || row['Birthday'] || row['Date of Birth'] || row.dob || '').toString().trim() || undefined;
      const joinedDate = (row.joinedDate || row['Joined Date'] || row['JoinedDate'] || '').toString().trim() || undefined;
      const maritalStatus = (row.maritalStatus || row['Marital Status'] || '').toString().trim() || undefined;
      const attendedDLI = (row.attendedDLI || row['Have you attended DLI?'] || row['DLI'] || '').toString().trim() || undefined;
      const attendedDCA = (row.attendedDCA || row['Have you attended DCA?'] || row['DCA'] || '').toString().trim() || undefined;
      const attendedEncounter = (row.attendedEncounter || row['Encounter retreat'] || row['Encounter'] || '').toString().trim() || undefined;
      const address = (row.address || row['Full Address'] || row['Address'] || '').toString().trim() || undefined;
      const isHOD = Boolean(
        row.isHOD === true ||
        row['isHOD'] === true ||
        row['Is HOD'] === true ||
        String(row.isHOD).toLowerCase() === 'true' ||
        String(row['Is HOD']).toLowerCase() === 'yes',
      );

      if (!fullName) {
        result.failed++;
        result.errors.push({ row: rowIndex, identifier: 'Unknown', error: 'Full name is missing' });
        continue;
      }

      const phone = this.normalizePhoneNumber(rawPhone);
      if (!phone || phone.length < 8) {
        result.failed++;
        result.errors.push({ row: rowIndex, identifier: fullName, error: `Invalid phone: "${rawPhone}"` });
        continue;
      }

      const department = this.normalizeDepartment(rawDept);

      try {
        const existing = await this.prisma.worker.findUnique({ where: { phone } });
        if (existing) {
          const updated = await this.prisma.worker.update({
            where: { phone },
            data: {
              fullName,
              department,
              ...(unit !== undefined && { unit }),
              role,
              ...(email && { email }),
              ...(birthday && { birthday }),
              ...(joinedDate && { joinedDate }),
              ...(maritalStatus && { maritalStatus }),
              ...(attendedDLI && { attendedDLI }),
              ...(attendedDCA && { attendedDCA }),
              ...(attendedEncounter && { attendedEncounter }),
              ...(address && { address }),
              isHOD,
              isActive: true,
            },
          });
          result.updated++;
          result.workers.push(updated);
        } else {
          const created = await this.prisma.worker.create({
            data: {
              fullName,
              phone,
              department,
              unit,
              role,
              email,
              birthday,
              joinedDate,
              maritalStatus,
              attendedDLI,
              attendedDCA,
              attendedEncounter,
              address,
              isHOD,
              isActive: true,
            },
          });
          result.created++;
          result.workers.push(created);
        }
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: rowIndex,
          identifier: `${fullName} (${phone})`,
          error: err.message || 'Database error',
        });
      }
    }

    return result;
  }

  /**
   * Parse day and month from strings like "07 July", "7 July", "21 Aug", "1995-07-07", "07/07"
   */
  parseBirthdayDayAndMonth(birthdayStr?: string | null): { day: number; month: number } | null {
    if (!birthdayStr) return null;
    const str = birthdayStr.trim().toLowerCase();

    const months: { [key: string]: number } = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12,
    };

    // Format: "07 July", "7th July", "21 Aug"
    const match1 = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i);
    if (match1) {
      const d = parseInt(match1[1], 10);
      const mStr = match1[2].toLowerCase();
      const mKey = Object.keys(months).find((k) => mStr.startsWith(k));
      if (mKey && d >= 1 && d <= 31) {
        return { day: d, month: months[mKey] };
      }
    }

    // Format: "July 07", "Aug 21"
    const match2 = str.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
    if (match2) {
      const mStr = match2[1].toLowerCase();
      const d = parseInt(match2[2], 10);
      const mKey = Object.keys(months).find((k) => mStr.startsWith(k));
      if (mKey && d >= 1 && d <= 31) {
        return { day: d, month: months[mKey] };
      }
    }

    // Numerical formats: "YYYY-MM-DD", "DD-MM-YYYY", "DD/MM"
    const numParts = str
      .split(/[-/.]/)
      .map((p) => parseInt(p, 10))
      .filter((p) => !isNaN(p));

    if (numParts.length === 3) {
      if (numParts[0] > 1900) {
        // YYYY-MM-DD
        return { month: numParts[1], day: numParts[2] };
      }
      // DD-MM-YYYY
      return { day: numParts[0], month: numParts[1] };
    } else if (numParts.length === 2) {
      if (numParts[0] > 12) {
        return { day: numParts[0], month: numParts[1] };
      } else if (numParts[1] > 12) {
        return { month: numParts[0], day: numParts[1] };
      }
      return { day: numParts[0], month: numParts[1] };
    }

    return null;
  }

  /**
   * Find workers celebrating birthday on target date (matching day and month)
   */
  async findCelebrantsForDate(targetDate: Date): Promise<Worker[]> {
    const targetDay = targetDate.getDate();
    const targetMonth = targetDate.getMonth() + 1; // 1-12

    const allWorkers = await this.prisma.worker.findMany({
      where: { isActive: true },
    });

    return allWorkers.filter((worker) => {
      const parsed = this.parseBirthdayDayAndMonth(worker.birthday);
      if (!parsed) return false;
      return parsed.day === targetDay && parsed.month === targetMonth;
    });
  }

  /**
   * Find workers celebrating birthday today
   */
  async findCelebrantsToday(): Promise<Worker[]> {
    return this.findCelebrantsForDate(new Date());
  }

  /**
   * Find workers celebrating birthday in N days
   */
  async findCelebrantsInDays(days: number): Promise<{ celebrants: Worker[]; targetDate: Date }> {
    const target = new Date();
    target.setDate(target.getDate() + days);
    const celebrants = await this.findCelebrantsForDate(target);
    return { celebrants, targetDate: target };
  }

  /**
   * Search for a worker or pending registration for self-onboarding / device linking
   */
  async findWorkerForOnboarding(
    rawIdentifier: string,
  ): Promise<{ worker: Worker | null; pendingRequest: RegistrationRequest | null }> {
    const clean = rawIdentifier.trim();
    if (!clean) return { worker: null, pendingRequest: null };

    // 1. Try phone normalization if it contains digits
    const phoneVariants = this.getPhoneVariants(clean);
    const isEmail = clean.includes('@') && clean.includes('.');
    const cleanEmail = clean.toLowerCase();

    // 2. Query Worker table
    const workerConditions: any[] = [];
    if (phoneVariants.length > 0) {
      phoneVariants.forEach((p) => workerConditions.push({ phone: p }));
    }
    if (isEmail) {
      workerConditions.push({ email: cleanEmail });
    }

    if (workerConditions.length > 0) {
      const worker = await this.prisma.worker.findFirst({
        where: {
          OR: workerConditions,
          isActive: true,
        },
      });

      if (worker) {
        return { worker, pendingRequest: null };
      }
    }

    // 3. Fallback: check pending RegistrationRequest
    if (phoneVariants.length > 0) {
      const pending = await this.prisma.registrationRequest.findFirst({
        where: {
          OR: phoneVariants.map((p) => ({ phone: p })),
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (pending) {
        return { worker: null, pendingRequest: pending };
      }
    }

    return { worker: null, pendingRequest: null };
  }

  /**
   * Complete worker onboarding: link LID / phone and update lastInteractedAt
   */
  async completeWorkerOnboarding(
    workerId: string,
    rawLid?: string | null,
    newPhone?: string | null,
  ): Promise<Worker> {
    const data: any = {
      lastInteractedAt: new Date(),
      isActive: true,
    };

    if (rawLid && rawLid.trim().endsWith('@lid')) {
      data.lid = rawLid.trim();
    }

    if (newPhone) {
      const normalized = this.normalizePhoneNumber(newPhone);
      if (normalized && normalized.length >= 8) {
        // Ensure no conflict before updating phone
        const existing = await this.prisma.worker.findUnique({
          where: { phone: normalized },
        });
        if (!existing || existing.id === workerId) {
          data.phone = normalized;
        }
      }
    }

    return this.prisma.worker.update({
      where: { id: workerId },
      data,
    });
  }
}
