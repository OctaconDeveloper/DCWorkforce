# ⛪ DC Kubwa Workforce

A production-ready NestJS backend + **Prisma ORM (SQLite / PostgreSQL / MySQL)** + Baileys WhatsApp Bot system for managing church workers, duty schedules, department directories, and announcements.

---

## 🚀 Key Features

### 1. 🛡️ Admin REST API (NestJS + Prisma + Swagger)
- **Database Support**: **SQLite** (Default, zero setup required) with instant switch capability to **PostgreSQL** or **MySQL**.
- **Authentication**: JWT token authentication with bcrypt password hashing.
- **Worker Management**: CRUD operations, search by name/role/phone, filter by department and active status.
- **Bulk Import**: Import workers directly from CSV or Excel (`.xlsx`) files or multi-line text.
- **Schedule Management**: Create and filter duty meetings, choir rehearsals, and ushering schedules.
- **Announcements**: Broadcast church-wide or department-specific announcements.
- **Swagger Documentation**: Interactive API testing available at `http://localhost:3000/api/docs`.

### 2. 🤖 Interactive WhatsApp Bot (@whiskeysockets/baileys)
- **Auto-starts on Boot**: Initializes WhatsApp socket and prints a pairing QR code directly in the terminal.
- **Persistent Sessions**: Multi-file auth stored in `./auth_info_baileys` (persisted on restart / Railway volume).
- **Phone Verification**: Automatically checks incoming sender numbers against registered church workers.
- **Interactive Menu & Quick Commands**:
  - `MY INFO` (or `1`): Shows worker name, department, role, HOD contact, birthday, joined date.
  - `MY SCHEDULE` (or `2`): Fetches upcoming duty schedules for the worker's department.
  - `CONTACT` (or `3`): Shows interactive department worker directories with phone numbers.
  - `ANNOUNCEMENTS` (or `4`): Retrieves latest announcements for the worker's department or church-wide.
  - Natural text commands: `hi`, `hello`, `menu`, `my info`, `schedule`, `contact choir`, `contact media`.
- **Admin WhatsApp Capabilities**:
  - **Bulk Add via Text Command**: Admins can paste batch workers in a single WhatsApp message with `#addworkers`:
    ```text
    #addworkers
    Brother John, 2348011112222, choir, Tenor, 1995-04-12, 2022-01-15, false
    Sister Mary, 2348022223333, ushering, HOD, 1990-08-20, 2020-05-10, true
    ```
  - **Bulk Add via WhatsApp Document**: Admin can attach and send a `.csv` or `.xlsx` spreadsheet directly in chat.
  - **Admin Stats**: Send `#stats` to view total workers, schedules, and announcements.
- **Anti-Spam Rate Limiting**: Protects the bot from message flooding.

---

## 🛠️ Tech Stack
- **Backend Framework:** [NestJS](https://nestjs.com/) (TypeScript)
- **Database & ORM:** [Prisma ORM](https://www.prisma.io/) (SQLite default, PostgreSQL/MySQL compatible)
- **WhatsApp Library:** [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- **API Documentation:** [Swagger / OpenAPI](https://swagger.io/)
- **Authentication:** Passport JWT + Bcrypt

---

## 📂 Project Structure

```
.
├── prisma/
│   ├── schema.prisma      # Prisma schema (Models: Admin, Worker, Schedule, Announcement)
│   └── dev.db             # Local SQLite database (auto-generated)
├── src/
│   ├── admin/             # Admin auth & admin management
│   ├── auth/              # JWT strategy & auth guards
│   ├── common/            # Enums (Department, AnnouncementTarget)
│   ├── prisma/            # Global Prisma Client service
│   ├── workers/           # Worker CRUD & bulk import logic
│   ├── schedules/         # Duty & meeting schedules
│   ├── announcements/     # Department & church announcements
│   ├── whatsapp/          # Baileys WhatsApp bot provider
│   │   ├── whatsapp.service.ts
│   │   └── whatsapp.module.ts
│   ├── app.module.ts
│   └── main.ts
├── auth_info_baileys/     # WhatsApp session credentials (gitignored)
├── sample_workers.csv     # Sample CSV template for imports
├── Dockerfile             # Multi-stage production container
├── docker-compose.yml     # Container setup
└── README.md
```

---

## ⚡ Quick Start Guide

### 1. Installation

```bash
# Navigate to project directory
cd DCMedia

# Install dependencies
npm install
```

### 2. Database Setup (Prisma + SQLite)

Initialize the database schema:

```bash
# Push schema to SQLite database (creates dev.db)
npx prisma db push

# Generate Prisma Client types
npx prisma generate
```

*(Optional: Run `npx prisma studio` to view and edit database records visually in your browser)*

### 3. Run the Application

```bash
# Development mode
npm run start:dev
```

When the app starts:
1. It connects to the SQLite database (or Postgres/MySQL if configured).
2. It seeds the default admin (`admin@church.com` / `admin123`).
3. It displays the **WhatsApp QR Code** in your terminal.
4. Scan the QR code using WhatsApp on your phone (**Linked Devices** -> **Link a Device**).

---

## 🔄 Switching Database Provider (PostgreSQL or MySQL)

If you want to switch from SQLite to PostgreSQL or MySQL in the future:

1. In `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql" // or "mysql"
     url      = env("DATABASE_URL")
   }
   ```
2. In `.env`:
   ```env
   # For PostgreSQL:
   DATABASE_URL="postgresql://user:password@localhost:5432/church_workers_db?schema=public"

   # For MySQL:
   DATABASE_URL="mysql://user:password@localhost:3306/church_workers_db"
   ```
3. Run:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

---

## 📖 API Documentation & Testing (Swagger)

Open your browser and navigate to:
```
http://localhost:3000/api/docs
```

---

## 💻 cURL Examples

### 1. Admin Login
```bash
curl -X POST http://localhost:3000/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@church.com",
    "password": "admin123"
  }'
```
*Copy the `accessToken` returned from this response to authorize subsequent requests.*

### 2. Add a Single Worker
```bash
curl -X POST http://localhost:3000/workers \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Sister Grace Adebayo",
    "phone": "2348011223344",
    "department": "choir",
    "role": "Choir Leader",
    "email": "grace@church.com",
    "birthday": "1992-05-14",
    "joinedDate": "2019-01-10",
    "isActive": true,
    "isHOD": true
  }'
```

### 3. Bulk Import Workers via CSV File
```bash
curl -X POST http://localhost:3000/workers/import \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -F "file=@sample_workers.csv"
```

### 4. Search Workers
```bash
curl -X GET "http://localhost:3000/workers/search?q=Grace" \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

### 5. Filter Workers by Department
```bash
curl -X GET "http://localhost:3000/workers?department=choir" \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

### 6. Create a Duty Schedule
```bash
curl -X POST http://localhost:3000/schedules \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "department": "choir",
    "title": "Sunday Thanksgiving Choir Rehearsal",
    "date": "2026-10-12",
    "time": "07:00 AM",
    "venue": "Main Auditorium",
    "description": "Full choir sound check and Thanksgiving special song."
  }'
```

### 7. Create an Announcement
```bash
curl -X POST http://localhost:3000/announcements \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "General Workers Fasting & Prayer",
    "message": "All workers are expected to join the prayer vigil this Friday by 10:00 PM.",
    "targetDepartment": "all"
  }'
```

---

## 📱 WhatsApp Bot Commands Reference

| User Type | Command / Input | Description |
| :--- | :--- | :--- |
| **Worker** | `hi`, `hello`, `menu` | Shows main interactive menu with buttons & numbered options |
| **Worker** | `1` or `my info` | Displays profile, department, role, HOD name, birthday |
| **Worker** | `2` or `schedule` | Displays upcoming duty schedules for the worker's department |
| **Worker** | `3` or `contact` | Shows department directory selection list |
| **Worker** | `contact choir` | Shows list of active members in the Choir department |
| **Worker** | `4` or `announcements` | Retrieves latest church-wide and departmental announcements |
| **Admin** | `#addworkers` (multi-line) | Bulk add workers via text format directly in WhatsApp |
| **Admin** | Attach `.csv` / `.xlsx` | Bulk import workers from spreadsheet file in WhatsApp chat |
| **Admin** | `#stats` | View real-time database counts (workers, schedules, announcements) |

---

## 🚢 Deployment to Railway.app

1. Connect your repository to **Railway**.
2. Set environment variables:
   - `DATABASE_URL`: `file:./dev.db` (or attach a Railway Postgres/MySQL database plugin and set the URL).
   - `JWT_SECRET`: `<random_secure_secret>`
   - `ADMIN_EMAIL`: `admin@church.com`
   - `ADMIN_PASSWORD`: `<strong_password>`
   - `ADMIN_PHONE_NUMBERS`: `<admin_whatsapp_number>`
   - `AUTH_FOLDER_PATH`: `/app/auth_info_baileys`
3. Attach a persistent volume to mount at `/app/auth_info_baileys` so WhatsApp session keys persist across deploys.
4. Deploy and check Railway logs to scan the WhatsApp pairing QR code!
