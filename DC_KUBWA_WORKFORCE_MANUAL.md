# ⛪ Dominion City Kubwa — Workforce Management Bot Manual
**The Official Operations & Command Reference Manual**
*Covering WhatsApp Multi-Device Bot & Telegram Bot Integrations • Version 2.5.0*

---

## 📋 Table of Contents
1. [Executive Overview & System Architecture](#1-executive-overview--system-architecture)
2. [Role Hierarchy & Permissions Matrix](#2-role-hierarchy--permissions-matrix)
3. [Registration & Strict Duplicate Safeguards](#3-registration--strict-duplicate-safeguards)
4. [Case-Insensitive Member Search Tool](#4-case-insensitive-member-search-tool)
5. [Media Broadcast Engine (Images, PDFs, Audio, Video)](#5-media-broadcast-engine-images-pdfs-audio-video)
6. [Custom Broadcast Groups Management](#6-custom-broadcast-groups-management)
7. [WhatsApp Bot: Comprehensive Command Catalog](#7-whatsapp-bot-comprehensive-command-catalog)
8. [Gallery, Media Library & Coming Soon Features](#8-gallery-media-library--coming-soon-features)
9. [Telegram Bot: Commands, Inline Menus & Callbacks](#9-telegram-bot-commands-inline-menus--callbacks)
10. [Standard Operating Procedures (SOPs) by Role](#10-standard-operating-procedures-sops-by-role)
11. [Spreadsheet Import Specification (.csv / .xlsx)](#11-spreadsheet-import-specification-csv--xlsx)
12. [Frequently Asked Questions (FAQ)](#12-frequently-asked-questions-faq)

---

## 1. Executive Overview & System Architecture

The **DC Kubwa Workforce Management System** provides an automated communication, roster tracking, member verification, and broadcast infrastructure for church workers, unit heads, department heads (HODs), and church administrators.

### Core Architecture:
- **Backend**: NestJS framework with TypeScript.
- **ORM & Database**: Prisma ORM with SQLite/PostgreSQL/MySQL compatibility.
- **WhatsApp Engine**: Baileys multi-device socket integration.
- **Telegram Engine**: Telegraf bot framework with inline keyboards and callback routing.
- **Anti-Spam Rate Limiter**: 1.2-second token cooldown preventing spam floods.

---

## 2. Role Hierarchy & Permissions Matrix

| Capability / Command Scope | 🔴 Church Admin | 🟣 HOD | 🔵 Unit Head | 🟢 Worker | ⚪ Guest / Public |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Profile, Status & Duty Schedule** | ✅ Full Access | ✅ Full Access | ✅ Full Access | ✅ Own Dept | ❌ Prompt |
| **Case-Insensitive Member Search** | ✅ All Depts | ✅ Own Dept | ✅ Own Unit | ❌ Denied | ❌ Denied |
| **View Member Roster (`members`)** | ✅ All Depts | ✅ Own Dept | ✅ Own Unit | ❌ Denied | ❌ Denied |
| **Church Info, Organogram, Giving** | ✅ Full Access | ✅ Full Access | ✅ Full Access | ✅ Full Access | ✅ Public Access |
| **Worker Registration Form Submission** | ✅ Admin Mode | ✅ View/Share | ✅ View/Share | ✅ View/Share | ✅ Submit |
| **Review & Approve Registrations** | ✅ All Depts | ✅ Own Dept | ✅ Own Unit | ❌ Denied | ❌ Denied |
| **Broadcast to Unit (Text & Media)** | ✅ Any Unit | ✅ Dept Units | ✅ Own Unit | ❌ Denied | ❌ Denied |
| **Broadcast to Department (Text & Media)** | ✅ Any Dept | ✅ Own Dept | ❌ Denied | ❌ Denied | ❌ Denied |
| **Church-Wide Broadcast (`broadcast all`)** | ✅ Global | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **Custom Broadcast Groups Management** | ✅ Full Control | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **Appoint Unit Heads (`make unit head`)** | ✅ All Depts | ✅ Own Dept | ❌ Denied | ❌ Denied | ❌ Denied |
| **Excel/CSV Bulk Import & `#stats`** | ✅ Exclusive | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |

---

## 3. Registration & Strict Duplicate Safeguards

### Onboarding via WhatsApp Status:
> **Notice:** Self-service onboarding and device claiming via WhatsApp has been disabled. All new church workers must use the standardized `register` form to submit their application for approval.

### Strict Duplicate Rejection:
When a registration form is submitted:
1. **Existing Worker Check**: If the phone number is already registered to an active worker, the submission is immediately rejected:
   ```text
   ❌ REGISTRATION REJECTED: PHONE ALREADY REGISTERED
   ────────────────────────────
   A church worker record already exists with the phone number 08012345678:

   • Full Name: Brother David Eze
   • Department: MEDIA (Sound)
   • Role: Member
   • Status: Active ✅

   💡 Note: If you need to update your details or change departments, please contact your Head of Department (HOD) or Church Administrator.
   ```
2. **Pending Application Check**: If an application for that phone is already awaiting review, the applicant is reminded that their submission is currently pending with the department leadership.

---

## 4. Case-Insensitive Member Search Tool

Leaders can search for workforce members using the `search <query>` or `find <query>` command.

- **100% Case-Insensitive**: Searches work identically with `david`, `David`, or `DAVID`.
- **Multi-Field Matching**: Matches across **Full Name, Phone Number, Unit, Role, Department, and Address**.
- **Role-Based Scope Boundaries**:
  - **Church Administrators**: Search across all church departments.
  - **Heads of Departments (HODs)**: Search restricted to workers within their own department.
  - **Heads of Units (Unit Heads)**: Search restricted to workers within their unit/department.

### Search Examples:
- `search David` — Finds all workers named David.
- `search 08012345678` — Looks up worker by phone number.
- `search Sound` — Finds all workers in the Sound unit.
- `search Ushering` — Finds workers in Ushering.

---

## 5. Media Broadcast Engine (Images, PDFs, Audio, Video)

The broadcast engine supports rich media attachments across all broadcast scopes:

### How to Broadcast Media:
1. **Select Media**: Attach an image (flyer/photo), PDF document, audio file/voice note, or video in WhatsApp or Telegram.
2. **Add Caption**: Set the caption to the broadcast command:
   - `broadcast unit Team reminder for Sunday call time 6:30 AM`
   - `broadcast dept Departmental vigil this Friday at 10 PM`
   - `broadcast all Special leadership summit with Pastor this Saturday`
   - `broadcast group youth-leads Executive briefing agenda attached`
3. **Automatic Delivery**: The bot automatically downloads the media buffer, detects mimetype (image/doc/audio/video), extracts voice note (PTT) flags, and delivers both media and text to all targeted recipients.
4. **Safe Outbound Queue & Rate Pacing (<3% Ban Risk)**:
   - **FIFO Priority Queue**: High-priority direct user replies are processed ahead of mass broadcasts. Max 20 messages per minute.
   - **Humanized Typing Presence**: The bot simulates `composing` typing state (1.2–2.0s) before every message and `recording` before voice clips.
   - **Randomized Jitter Delays**: A randomized delay of **3 to 5 seconds** (`3000ms–5000ms`) is applied between every outgoing delivery.
   - **Dynamic Name Personalization**: Replies dynamically insert recipient first names and warm pastoral blessings to eliminate repetitive template flags.
   - **Link-on-Demand**: Links are only sent when explicitly requested by workers (`LINK`), preventing unsolicited bulk URL flagging.
   - **Session Credential Backup**: Baileys auth session files are bundled in the nightly backup to Media HOD (**+2348101889830**).
5. **Delivery Receipt**: The sender receives an immediate delivery summary:
   ```text
   ✅ UNIT BROADCAST COMPLETED
   ────────────────────────────
   • Target: Media - Sound
   • Delivered: 18 / 18 workers
   • Failed: 0
   ```

---



## 6. Custom Broadcast Groups Management

Church Administrators can create and manage targeted leadership lists:

- `groups` — List all custom broadcast groups and member counts.
- `add group <name> [description]` — Create a new group (e.g. `add group youth-executives Youth leadership team`).
- `group view <name>` — View all workers enrolled in the group.
- `group add <name> <phone/name>` — Add a worker to the group.
- `group remove <name> <phone/name>` — Remove a worker from the group.
- `delete group <name>` — Permanently delete a broadcast group.
- `broadcast group <name> <message>` — Dispatch broadcast notice to the group.

---

## 7. WhatsApp Bot: Comprehensive Command Catalog

### Navigation Menus & Shortcuts
- `menu`, `help` — Opens the Main Category Navigation Menu.
- `1` / `my duty` — **Category 1: Profile & Duty Schedule** (`info`, `status`, `schedule`, `register`).
- `2` / `church` — **Category 2: Church Info & Bulletins** (`departments`, `organogram`, `events`, `announcements`).
- `3` / `giving` — **Category 3: Tithes, Offerings & Projects** (`offering`, `tithe`, `donations`).
- `4` / `leadership` — **Category 4: Leadership, Search & Approvals** (`search`, `members`, `pending`, `accept`, `reject`, `broadcast`).
- `5` / `gallery` — **Category 5: Audio Sermons, PDFs & Media**.

### All WhatsApp Commands
| Command | Min Role | Syntax / Example | Description |
| :--- | :---: | :--- | :--- |
| `search <query>` | 🔵 Unit Head | `search David` / `find Sound` | Case-insensitive member search across all fields. |
| `info`, `status` | 🟢 Worker | `info` / `status` | Worker profile, leadership designations, DLI status, and address. |
| `schedule`, `duty` | 🟢 Worker | `schedule` / `my duty` | Upcoming duty dates, times, venues, and descriptions. |
| `departments` | ⚪ Public | `departments` / `dept media` | Lists all church departments, active units, and HOD contacts. |
| `organogram` | 🟢 Worker | `organogram` / `structure` | Church leadership structural hierarchy outline. |
| `events`, `services`| ⚪ Public | `events` | Weekly celebration times and upcoming special programs. |
| `announcements` | ⚪ Public | `announcements` / `news` | Active bulletins targeted to user's department or all church. |
| `offering`, `tithe` | ⚪ Public | `offering` / `tithe` | Official church bank accounts for tithes and general offerings. |
| `donations` | ⚪ Public | `donations` / `projects` | Active church building and development project payment channels. |
| `pending` | 🔵 Unit Head | `pending` / `approvals` | Lists pending worker registration requests with quick approval numbers. |
| `accept <#>` / `a<#>`| 🔵 Unit Head| `accept 1` / `a1` | Approves pending applicant #1 and activates worker profile. |
| `reject <#>` / `r<#>`| 🔵 Unit Head| `reject 1` / `r1` | Declines pending applicant #1 with optional reason note. |
| `members` | 🔵 Unit Head | `members` / `workers` | Workforce member directory within leadership scope. |
| `schedule template` | 🔵 Unit Head | `schedule template` / `create schedule` | Returns the standard copy-paste duty schedule template. |
| `manage schedules` | 🔵 Unit Head | `manage schedules` / `managed duty` | Lists active schedules created for/by your unit or department. |
| `#delschedule <id>` | 🔵 Unit Head | `#delschedule <uuid>` | Removes a duty schedule and terminates remaining reminders. |
| `#checkschedules` | 🟣 HOD | `#checkschedules` / `#reminders` | Manually triggers 2-day and 1-day reminder scanner and report. |
| `make unit head` | 🟣 HOD | `make unit head David Sound` | Appoints registered worker as Head of Unit. |
| `add announcement` | 🔵 Unit Head | `add announcement` | Fetches the announcement creation template. |
| `add event` | 🔵 Unit Head | `add event` | Fetches the event creation template. |
| `broadcast unit` | 🔵 Unit Head | `broadcast unit <msg>` | Dispatches text and attached media to unit workers. |
| `broadcast dept` | 🟣 HOD | `broadcast dept <msg>` | Dispatches text and attached media to department workers. |
| `broadcast all` | 🔴 Admin | `broadcast all <msg>` | Dispatches church-wide text and attached media. |
| `#stats` | 🔴 Admin | `#stats` | Real-time workforce metrics and department counts. |
| `#addworkers` | 🔴 Admin | `#addworkers <blocks>` | Multi-block text parser for bulk worker registration. |
| `#birthdays` | 🔴 Admin | `#birthdays` | Manual trigger for daily birthday greetings scanner. |
| `#backup` / `backup db` | 🔴 Admin / Backup Lead | `#backup` | Instant DB binary (.db), creds.json, & JSON record dump delivery. |
| *Spreadsheet Drop* | 🔴 Admin | Attach `.xlsx` / `.csv` | Automated bulk import from spreadsheet files. |

> 📋 **Duty Schedule Management & Automated Reminders:**
> - **Standard Creation Template:** Admins, HODs, and Unit Heads can create schedules using the standard key-value format:
>   ```text
>   Title: Sunday 1st Service Duty Roster
>   Date: 2026-10-12
>   Time: 07:00 AM
>   Venue: Main Sanctuary
>   Department: media
>   Unit: Livestream & Camera
>   Scope: unit
>   Workers: 08101889830, 08144527833
>   Description: Video switcher, camera operations, sound check, and stream monitoring.
>   ```
> - **Notification Pipeline:**
>   1. **Instant Broadcast:** Assigned workers receive an immediate alert when the roster is published.
>   2. **2-Day Reminder (48 Hours Before):** Scheduled workers receive a preparation reminder.
>   3. **1-Day Reminder (24 Hours Before):** A final urgent reminder is sent 1 day prior to duty.

> 🛡️ **Automated Daily Database Backup (Cron Task):**
> A background cron schedule automatically runs every day at **02:00 AM WAT**, generating a complete SQLite `.db` binary backup alongside `creds.json` and a structured JSON data dump, delivering them as WhatsApp documents directly to **+2348101889830**. Immediate backups can also be requested on-demand at any time using `#backup` or `backup db`.

---


## 8. Gallery, Media Library & Coming Soon Features

The Gallery portal provides access to digital resources:

| Sub-Module | Trigger Keywords | Status | Bot Response Description |
| :--- | :--- | :---: | :--- |
| **Sermon Messages** | `messages`, `sermons`, `sermon` | ⏳ Coming Soon | Audio sermons, podcasts, and digital PDF study outlines are currently being curated and will be available soon! |
| **Audio Messages** | `audio`, `podcasts`, `sermon audio` | ⏳ Coming Soon | Sunday sermon recordings, worship tracks, and podcast episodes are currently being prepared for direct streaming. |
| **PDF Study Guides**| `pdf`, `sermon notes`, `outlines` | ⏳ Coming Soon | Weekly sermon study outlines, DLI course materials, and monthly devotionals will be available for direct download. |
| **Media Gallery** | `media`, `media gallery` | ⏳ Coming Soon | High-definition service photo albums, program recap videos, and media archives are in development. |
| **Photo Albums** | `photos`, `photo`, `pictures` | ⏳ Coming Soon | Sunday service photos, special program galleries, and workforce memories are being organized. |
| **Video Highlights**| `videos`, `video`, `highlights` | ⏳ Coming Soon | Service ministrations, choir worship highlights, and recap videos are being processed. |

---

## 9. Telegram Bot: Commands, Inline Menus & Callbacks

- `/start`, `/menu` — Interactive workforce menu with inline buttons.
- `/search <query>` — Case-insensitive member search across all fields.
- `/info`, `/status` — Worker profile with username, phone, and leadership credentials.
- `/schedule`, `/duty` — Department duty schedules.
- `/departments` — Interactive department browser with sub-buttons.
- `/events` — Upcoming church events with inline `[ 🗑️ Delete ]` buttons for creators.
- `/announcements` — Church bulletins with inline delete controls.
- `/giving` — Official bank accounts for tithes and offerings.
- `/gallery` — Digital media library portal.
- `/pending` — Pending worker applications with inline `[ ✅ Approve ]` and `[ ❌ Reject ]` buttons.
- `/members` — Workforce member directory list.
- `/broadcast <unit|dept|all> <msg>` — Real-time broadcast dispatch.
- `/stats` — Live analytics overview.

---

## 10. Standard Operating Procedures (SOPs) by Role

### 10.1. SOP for Church Administrators
1. **Bulk Ingestion**: Drop Excel/CSV files directly into the bot chat to onboard entire departments at once.
2. **Search Directory**: Use `search <name/phone/unit>` for instant multi-field member lookups.
3. **Global Broadcasts**: Send urgent flyers and text notices using `broadcast all <Caption>`.
4. **Group Management**: Maintain leadership groups via `add group` and `group add`.

### 10.2. SOP for Heads of Departments (HODs)
1. **Process Applications**: Run `pending` weekly; check candidate DLI/DCA status before typing `accept <#>`.
2. **Member Audits**: Use `search <query>` to look up workers within your department.
3. **Appoint Unit Heads**: Elevate team leads using `make unit head <Name> <Unit>`.
4. **Department Briefings**: Broadcast meeting agendas using `broadcast dept <Message>`.

### 10.3. SOP for Heads of Units (Unit Heads)
1. **Duty Reminders**: On Saturdays, attach service rosters with caption `broadcast unit Call time 6:45 AM`.
2. **Search Unit Personnel**: Use `search <name>` to find worker contact information.
3. **Unit Approvals**: Approve unit applicants using `accept <#>`.

### 10.4. SOP for Church Workers
1. **Duty Check**: Send `schedule` every Friday to confirm upcoming service rosters.
2. **Sermon Outlines**: Send `gallery` to access downloadable study guides.
3. **Giving Accounts**: Send `offering` to retrieve verified church accounts.

---

## 11. Spreadsheet Import Specification (.csv / .xlsx)

| Header Field | Accepted Aliases | Example | Required? |
| :--- | :--- | :--- | :---: |
| **Full Name** | `Full Name`, `Name`, `Worker Name` | `Brother Samuel Adeyemi` | ✅ Mandatory |
| **Phone Number** | `Phone Number`, `Phone`, `Mobile`, `WhatsApp` | `08012345678` or `+2348012345678` | ✅ Mandatory (Unique) |
| **Department** | `Department`, `Dept` | `media`, `choir`, `ushering`, `protocol`, `prayer`, `children`, `welfare` | ✅ Mandatory |
| **Unit** | `Unit`, `Sub-unit`, `Team` | `IT/Livestream`, `Sound`, `Camera`, `Soprano` | Optional |
| **Role** | `Role`, `Position`, `Designation` | `Member`, `Sound Lead` | Default: `Member` |
| **Birthday** | `Birthday`, `DOB`, `Date of Birth` | `21 Aug` or `1992-08-21` | Optional |
| **Marital Status** | `Marital Status`, `Status` | `Single` or `Married` | Optional |
| **DLI / DCA** | `DLI`, `DCA`, `Encounter` | `Yes` or `No` | Optional |
| **Address** | `Address`, `Residence` | `Block 4, Flat 2, Phase 4, Kubwa, Abuja` | Optional |

---

## 12. Frequently Asked Questions (FAQ)

**Q: What happens if a user submits a phone number that already exists?**  
A: The bot immediately rejects the submission and outputs the name, department, and role of the existing worker profile.

**Q: How does case-insensitive member search work?**  
A: Typing `search david`, `search DAVID`, or `search David` all return the exact same matches across full name, phone number, unit, role, and address.

**Q: Can I broadcast an image flyer with text?**  
A: Yes! Attach the flyer in WhatsApp/Telegram with the caption `broadcast unit <Your message>` (or `dept` / `all`). The bot dispatches both the flyer graphic and text to all targeted recipients.

**Q: How do I cancel an active session?**  
A: Type `menu`, `cancel`, or `stop` at any time to return to the main menu.

---
*© 2026 Dominion City Kubwa • Systems Engineering & Media Directorate. All rights reserved.*
