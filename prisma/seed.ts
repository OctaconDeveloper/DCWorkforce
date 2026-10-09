import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Church Database Seed...');

  // 1. Create or Verify Default Admin
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@dominioncity.org';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.admin.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedPassword,
      name: 'Dominion City Administrator',
      phone: '2348000000000',
    },
  });
  console.log(`👤 Admin verified/created: ${admin.email}`);

  // 2. Seed Departments and Units from departments_and_units.json
  const jsonPath = path.resolve(__dirname, '../departments_and_units.json');
  let unitsCount = 0;
  let deptsCount = 0;

  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const departmentsSummary = data.departments_summary || {};

    for (const [deptName, units] of Object.entries(departmentsSummary)) {
      const normalizedDept = deptName.toLowerCase().trim();
      deptsCount++;

      for (const unit of units as string[]) {
        await prisma.departmentUnit.upsert({
          where: {
            department_name: {
              department: normalizedDept,
              name: unit.trim(),
            },
          },
          update: {
            isActive: true,
          },
          create: {
            department: normalizedDept,
            name: unit.trim(),
            isActive: true,
          },
        });
        unitsCount++;
      }
    }
    console.log(`🏛️ Seeded ${deptsCount} departments with ${unitsCount} official units.`);
  } else {
    console.warn(`⚠️ departments_and_units.json not found at ${jsonPath}`);
  }

  // 3. Seed/Verify Media Head of Department (HOD)
  const mediaHodPhone = '2348101889830';
  const mediaHod = await prisma.worker.upsert({
    where: { phone: mediaHodPhone },
    update: {
      department: 'media',
      role: 'Head of Department',
      isHOD: true,
      isActive: true,
    },
    create: {
      fullName: 'Media Head of Department',
      phone: mediaHodPhone,
      department: 'media',
      unit: 'IT/Livestream',
      role: 'Head of Department',
      isHOD: true,
      isUnitHead: false,
      isActive: true,
      address: 'Dominion City Kubwa, Abuja',
    },
  });
  console.log(`🎬 Media Head of Department verified/seeded: ${mediaHod.fullName} (${mediaHod.phone})`);

  console.log('🎉 Seeding completed successfully!');
}


main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
