import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Department } from '../common/enums/department.enum';
import * as fs from 'fs';
import * as path from 'path';

export const ORGANOGRAM_DEPARTMENT_UNITS: Record<string, string[]> = {
  administration: [
    'General Church Administration',
  ],
  'cell management': [
    'Cell Groups & Discipleship Support',
  ],
  children: [
    'Teachers',
    'Toddler Care',
    'Teen Ministry',
    'Worship & Activities',
  ],
  choir: [
    'Choir',
    'Drama Unit',
    'Musicians',
  ],
  consolidation: [
    'Call Center',
    'Database',
    'M.V.P.',
  ],
  'dca / dli': [
    'Dominion City Academy (DCA)',
    'Dominion Leadership Institute (DLI)',
  ],
  defence: [
    'Parking',
    'Protocol',
    'Security',
  ],
  'discipleship resource': [
    'Discipleship Resource & Materials',
  ],
  'encounter retreat': [
    'Encounter Retreat Operations',
  ],
  'evangelism & mobilization': [
    'Golden Heart (Welfare)',
    'Healing Stripes',
    'Prison',
    'Shelter',
  ],
  'external mobilization': [
    'Southwest Region Coordination',
  ],
  facility: [
    'Facility Management & Maintenance',
  ],
  finance: [
    'Church Finance & Accounting',
  ],
  intercessory: [
    'Intercessory Prayer',
  ],
  'legal & compliance': [
    'Legal & Regulatory Compliance',
  ],
  media: [
    'Design, Branding & Content Creation',
    'IT / Livestream & Broadcast',
    'Light & Sound',
    'Multimedia & Digital Evangelism',
    'Photography & Videography',
  ],
  'membership care': [
    'Celebration & Ceremony',
    'Experience Centre',
    'Konnect Hub',
  ],
  outreach: [
    'Follow Up',
    'Service Mobilization',
    'Soul Winning',
  ],
  prayer: [
    'Intercessory Prayer',
  ],
  protocol: [
    'Parking',
    'Protocol',
    'Security',
  ],
  'quality assurance': [
    'Health & Safety',
  ],
  'school of ministry': [
    'School of Ministry Operations',
  ],
  service: [
    'Greeters',
    'Sanctuary',
    'Ushering',
  ],
  'special ministries': [
    'Authentic Men',
    'Awaiting Mothers',
    'Corpers Fellowship',
    'Counseling',
    'Couple’s Classic',
    'DC Citizens',
    'DC Generals',
    'DC Prime',
    'Enterprise Hub',
    'Hospitality',
    'King’s Kids',
    'Medical',
    'New Eve',
    'Sports',
  ],
  ushering: [
    'Greeters',
    'Sanctuary',
    'Ushering',
  ],
  welfare: [
    'Golden Heart (Welfare)',
    'Healing Stripes',
    'Prison',
    'Shelter',
  ],
  'workforce operations': [
    'Attendance',
    'Care',
    'Celebration',
    'Database',
    'Learning & Performance',
    'Recruitment',
  ],
  worship: [
    'Choir',
    'Drama Unit',
    'Musicians',
  ],
};

@Injectable()
export class DepartmentsService implements OnModuleInit {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultUnits();
  }

  /**
   * Load departments and units definition, prioritizing departments_and_units.json
   */
  getDepartmentUnitsMapping(): Record<string, string[]> {
    try {
      const jsonPath = path.resolve(process.cwd(), 'departments_and_units.json');
      if (fs.existsSync(jsonPath)) {
        const fileData = fs.readFileSync(jsonPath, 'utf8');
        const parsed = JSON.parse(fileData);
        if (parsed.departments_summary) {
          const mapping: Record<string, string[]> = { ...ORGANOGRAM_DEPARTMENT_UNITS };
          for (const [dept, units] of Object.entries(parsed.departments_summary)) {
            mapping[dept.toLowerCase().trim()] = units as string[];
          }
          return mapping;
        }
      }
    } catch (e: any) {
      this.logger.warn(`Could not read departments_and_units.json: ${e.message}, using built-in mapping`);
    }
    return ORGANOGRAM_DEPARTMENT_UNITS;
  }

  /**
   * Load complete organogram JSON structure
   */
  getFullOrganogramData(): any {
    try {
      const jsonPath = path.resolve(process.cwd(), 'departments_and_units.json');
      if (fs.existsSync(jsonPath)) {
        const fileData = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(fileData);
      }
    } catch (e: any) {
      this.logger.warn(`Could not read organogram json: ${e.message}`);
    }
    return null;
  }

  /**
   * Seed all official departments and units into database on startup / first run
   */
  async seedDefaultUnits() {
    try {
      const mapping = this.getDepartmentUnitsMapping();
      let totalSeeded = 0;

      for (const [dept, units] of Object.entries(mapping)) {
        const normalizedDept = dept.toLowerCase().trim();
        for (const unitName of units) {
          await this.prisma.departmentUnit.upsert({
            where: {
              department_name: {
                department: normalizedDept,
                name: unitName.trim(),
              },
            },
            create: {
              department: normalizedDept,
              name: unitName.trim(),
              isActive: true,
            },
            update: {
              isActive: true,
            },
          });
          totalSeeded++;
        }
      }
      this.logger.log(`✅ Church organogram departments and units verified/seeded (${totalSeeded} total units registered).`);
    } catch (err: any) {
      this.logger.warn(`Failed to seed department units: ${err.message}`);
    }
  }

  /**
   * Get list of all registered departments
   */
  getDepartments(): string[] {
    const enumDepts = Object.values(Department).map((d) => d.toLowerCase());
    const mappingDepts = Object.keys(this.getDepartmentUnitsMapping());
    return Array.from(new Set([...enumDepts, ...mappingDepts])).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get active units for a given department
   */
  async getUnitsForDepartment(department: string): Promise<string[]> {
    const normalizedDept = department.toLowerCase().trim();
    const dbUnits = await this.prisma.departmentUnit.findMany({
      where: {
        department: normalizedDept,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    if (dbUnits.length > 0) {
      return dbUnits.map((u) => u.name);
    }

    const mapping = this.getDepartmentUnitsMapping();
    return mapping[normalizedDept] || [];
  }

  /**
   * Validate if department and unit are official / registered
   */
  async validateDepartmentAndUnit(
    department: string,
    unit?: string | null,
  ): Promise<{
    isValidDept: boolean;
    isValidUnit: boolean;
    matchedDepartment: string | null;
    matchedUnit: string | null;
    availableUnits: string[];
  }> {
    if (!department) {
      return {
        isValidDept: false,
        isValidUnit: false,
        matchedDepartment: null,
        matchedUnit: null,
        availableUnits: [],
      };
    }

    const rawDept = department.toLowerCase().trim();
    const validDepts = this.getDepartments();

    // Exact match or fuzzy match
    let matchedDept = validDepts.find((d) => d === rawDept);

    if (!matchedDept) {
      matchedDept = validDepts.find(
        (d) => d.includes(rawDept) || rawDept.includes(d) || d.replace(/[\s\/-]/g, '') === rawDept.replace(/[\s\/-]/g, ''),
      );
    }

    if (!matchedDept) {
      return {
        isValidDept: false,
        isValidUnit: false,
        matchedDepartment: null,
        matchedUnit: null,
        availableUnits: [],
      };
    }

    const availableUnits = await this.getUnitsForDepartment(matchedDept);

    if (!unit || unit.trim().length === 0) {
      return {
        isValidDept: true,
        isValidUnit: false,
        matchedDepartment: matchedDept,
        matchedUnit: null,
        availableUnits,
      };
    }

    const cleanedUnit = unit.trim().toLowerCase();
    const strippedUnit = cleanedUnit.replace(/[\/\s-&]/g, '');

    // Match exact or fuzzy unit name
    const matchedUnit = availableUnits.find((u) => {
      const uLower = u.toLowerCase();
      const uStripped = uLower.replace(/[\/\s-&]/g, '');
      return (
        uLower === cleanedUnit ||
        uStripped === strippedUnit ||
        cleanedUnit.includes(uLower) ||
        uLower.includes(cleanedUnit) ||
        strippedUnit.includes(uStripped) ||
        uStripped.includes(strippedUnit)
      );
    });

    return {
      isValidDept: true,
      isValidUnit: Boolean(matchedUnit),
      matchedDepartment: matchedDept,
      matchedUnit: matchedUnit || null,
      availableUnits,
    };
  }

  /**
   * Format church organogram as structured markdown
   */
  formatOrganogramText(): string {
    return (
      `📊 *DOMINION CITY KUBWA — CHURCH ORGANOGRAM*\n` +
      `_...raising leaders that transform society_\n` +
      `────────────────────────────\n\n` +
      `👑 *RESIDENT PASTORS*\n` +
      `• Pastor Elenwor Ihua & Pastor Funmi Ihua\n\n` +
      `🏢 *SUPPORT TEAMS*\n` +
      `• *Administration:* Pastor Faith Aiyegbe\n` +
      `• *Finance:* Pastor Emmanuel Essien\n` +
      `• *Legal & Compliance:* Pastor Reuben Imarha\n\n` +
      `🏛️ *DIRECTORATES & LEADERSHIP*\n\n` +
      `1️⃣ *PROGRAMS DIRECTORATE*\n` +
      `• *Director:* Pastor Ogar Obaji\n` +
      `• *Departments:* Defence, Facility, Media, Quality Assurance, Service, Worship\n\n` +
      `2️⃣ *DISCIPLESHIP DIRECTORATE*\n` +
      `• *Director:* Dr Arinze Okoli\n` +
      `• *Departments:* DCA / DLI, Discipleship Resource, Encounter Retreat, School of Ministry\n\n` +
      `3️⃣ *MINISTRY DIRECTORATE*\n` +
      `• *Director:* Pastor Chris Bassey (Asst: Pastor Helen Udochukwu)\n` +
      `• *Departments:* Intercessory, Special Ministries (14 Specialized Units)\n\n` +
      `4️⃣ *MISSIONS DIRECTORATE*\n` +
      `• *Director:* Pastor Jackson Ufon-Abasi\n` +
      `• *Departments:* Evangelism & Mobilization, External Mobilization, Outreach\n\n` +
      `5️⃣ *MEMBERSHIP DIRECTORATE*\n` +
      `• *Director:* Pastor Kenechukwu Ezike\n` +
      `• *Departments:* Cell Management, Consolidation, Membership Care\n\n` +
      `6️⃣ *WORKFORCE DIRECTORATE*\n` +
      `• *Director:* Pastor Mary Emelike / David Ajudua\n` +
      `• *Departments:* Workforce Operations\n\n` +
      `────────────────────────────\n` +
      `💡 _Type *departments* to see the full list of departments, HODs, and unit heads!_`
    );
  }

  /**
   * Format departments with HODs, units, and unit heads
   */
  formatDepartmentsAndUnitsText(filterDept?: string): string {
    const organogram = this.getFullOrganogramData();
    if (!organogram || !organogram.directorates) {
      return `🏛️ *CHURCH DEPARTMENTS*\n────────────────────────────\n` +
        Object.entries(this.getDepartmentUnitsMapping())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([d, units]) => `• *${d.toUpperCase()}* (${units.length} units: ${units.join(', ')})`)
          .join('\n\n');
    }

    if (filterDept) {
      const raw = filterDept.toLowerCase().trim();
      for (const dir of organogram.directorates) {
        for (const dept of dir.departments || []) {
          if (
            dept.name.toLowerCase() === raw ||
            dept.name.toLowerCase().includes(raw) ||
            raw.includes(dept.name.toLowerCase())
          ) {
            let res = `🏛️ *${dept.name.toUpperCase()} DEPARTMENT*\n` +
              `────────────────────────────\n` +
              `• *Directorate:* ${dir.directorate} (Director: ${dir.director})\n` +
              `• *HOD:* ${dept.hod || 'Unassigned'}\n\n` +
              `📋 *Units & Unit Heads (HOU):*\n`;

            const sortedUnits = [...(dept.units || [])].sort((a, b) => a.name.localeCompare(b.name));
            sortedUnits.forEach((u: any, idx: number) => {
              const houText = u.hou && u.hou.length > 0 ? ` (HOU: ${u.hou.join(', ')})` : '';
              res += `${idx + 1}. *${u.name}*${houText}\n`;
            });
            return res;
          }
        }
      }
    }

    let output = `🏛️ *DOMINION CITY KUBWA — DEPARTMENTS & UNITS*\n────────────────────────────\n`;

    organogram.directorates.forEach((dir: any) => {
      output += `\n📁 *${dir.directorate.toUpperCase()}*\n`;
      output += `👤 *Director:* ${dir.director}\n`;

      const sortedDepts = [...(dir.departments || [])].sort((a, b) => a.name.localeCompare(b.name));
      sortedDepts.forEach((dept: any) => {
        output += `\n📌 *${dept.name.toUpperCase()} DEPARTMENT*\n`;
        output += `• *HOD:* ${dept.hod || 'Unassigned'}\n`;
        output += `• *Units:*\n`;

        const sortedUnits = [...(dept.units || [])].sort((a, b) => a.name.localeCompare(b.name));
        sortedUnits.forEach((u: any) => {
          const houText = u.hou && u.hou.length > 0 ? ` _(HOU: ${u.hou.join(' / ')})_` : '';
          output += `  - ${u.name}${houText}\n`;
        });
      });
      output += `\n────────────────────────────\n`;
    });

    output += `\n💡 _Tip: You can type *departments <name>* (e.g. *departments media*) to view a specific department._`;
    return output;
  }

  /**
   * Add a new unit to a department
   */
  async addUnit(department: string, name: string) {
    const dept = department.toLowerCase().trim();
    return this.prisma.departmentUnit.upsert({
      where: {
        department_name: {
          department: dept,
          name: name.trim(),
        },
      },
      create: {
        department: dept,
        name: name.trim(),
        isActive: true,
      },
      update: {
        isActive: true,
      },
    });
  }
}
