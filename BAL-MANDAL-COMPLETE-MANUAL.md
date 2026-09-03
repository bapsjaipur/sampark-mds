# Bal Mandal & Sishu Mandal User Manual
**BAPS Jaipur MDS - Children's Wing Management System**

Version 1.0  
Prepared for: Manish Kumawat  
Date: September 2, 2026

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Getting Started](#4-getting-started)
5. [Managing Contacts](#5-managing-contacts)
6. [Bal Mandal Dashboard](#6-bal-mandal-dashboard)
7. [Events & Attendance](#7-events--attendance)
8. [Batch Management](#8-batch-management)
9. [Standard Promotion Workflow](#9-standard-promotion-workflow)
10. [Reports & Exports](#10-reports--exports)
11. [Admin Configuration](#11-admin-configuration)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Introduction

### What is Bal Mandal & Sishu Mandal?

The Bal Mandal & Sishu Mandal module is a comprehensive children's wing management system designed for BAPS Jaipur to track and manage:

- **Sishu Mandal**: Younger children (LKG, UKG, 1st-4th standard)
- **Bal Mandal**: Older children (5th-8th standard)

### Key Features

✓ **Automatic Grade Assignment** - System auto-assigns children to correct mandal based on their standard  
✓ **Sampark Karyakarta (SK) Management** - Round-robin assignment for balanced workload  
✓ **Event Attendance Tracking** - Regular and observer attendance  
✓ **Hobby & Skills Tracking** - Monitor children's interests and talents  
✓ **Yearly Promotion** - Bulk promote all students to next standard  
✓ **8th Standard Transfer** - Automatic transfer to Yuvak Mandal after 8th  
✓ **Notes & History** - Collaborative notes with timestamps  
✓ **Dashboard Analytics** - 10 key metrics at a glance  
✓ **VCF Export** - Export contacts for phone with custom formatting  

---

## 2. System Overview

### Program Structure

```
Bal Mandal Program
├── Sishu Mandal (LKG, UKG, 1st-4th)
│   ├── Sampark Karyakarta (SK)
│   ├── Nirikshak (Observer)
│   └── Children
│
└── Bal Mandal (5th-8th)
    ├── Sanchalak (Coordinator)
    ├── Sampark Karyakarta (SK)
    ├── Nirikshak (Observer)
    ├── Sant (Observer)
    └── Children
```

### Hierarchy Flow

1. **Nirdeshak** (Director) - Overall program oversight
2. **Sanchalak** (Coordinator) - Day-to-day management
3. **Nirikshak** (Inspector) - Quality monitoring
4. **Sampark Karyakarta (SK)** - Direct contact with children/families
5. **Sant** (Saint) - Observer role at events

---

## 3. User Roles & Permissions

### Admin
**Full system access**

**Can do:**
- ✓ View and edit all data across all areas and mandals
- ✓ Create/edit/delete volunteers, roles, areas, mandals
- ✓ Generate and assign batches
- ✓ Run standard promotion workflow
- ✓ Access all reports and exports
- ✓ Configure system settings
- ✓ View Bal Mandal dashboard
- ✓ Create and manage events

**Cannot do:**
- ✗ None (full access)

**Dashboard Access:** All metrics, all areas

---

### Nirdeshak (Director)
**Program director with full Bal Mandal access**

**Can do:**
- ✓ View all Bal Mandal and Sishu Mandal contacts in assigned areas
- ✓ View Bal Mandal dashboard with metrics
- ✓ Generate batches for SK assignment
- ✓ Export VCF contacts
- ✓ Run yearly standard promotion workflow (8th → Yuvak transfer)
- ✓ Create and manage Bal Mandal events
- ✓ Mark attendance (regular and observer)
- ✓ Add/edit notes on contacts
- ✓ View all attendance history

**Cannot do:**
- ✗ Edit system configuration (areas, mandals, roles)
- ✗ Manage volunteers (except viewing)
- ✗ Access admin tools

**Dashboard Access:** Full dashboard with all 10 metrics

---

### Sanchalak (Coordinator)
**Day-to-day program management**

**Can do:**
- ✓ View all Bal Mandal and Sishu Mandal contacts in assigned areas
- ✓ View Bal Mandal dashboard
- ✓ Add/edit/delete contacts
- ✓ Create and manage events
- ✓ Mark attendance
- ✓ Add notes on contacts
- ✓ Export VCF contacts
- ✓ View batch assignments

**Cannot do:**
- ✗ Generate new batches
- ✗ Run standard promotion
- ✗ Manage volunteers or system settings

**Dashboard Access:** Full dashboard, filtered to assigned areas

---

### Nirikshak (Inspector/Observer)
**Quality monitoring and observation**

**Can do:**
- ✓ View all Bal Mandal and Sishu Mandal contacts in assigned areas
- ✓ View Bal Mandal dashboard
- ✓ Mark own attendance as observer at events
- ✓ Add notes on contacts
- ✓ View attendance history

**Cannot do:**
- ✗ Add/edit/delete contacts
- ✗ Create events
- ✗ Mark regular attendance for children
- ✗ Generate batches
- ✗ Export data

**Dashboard Access:** Read-only dashboard

---

### Sampark Karyakarta (SK)
**Direct contact management with assigned children**

**Can do:**
- ✓ View assigned contacts only (children assigned to them)
- ✓ View Bal Mandal dashboard (limited to own assignments)
- ✓ Add notes on assigned contacts
- ✓ Mark attendance for assigned children at events
- ✓ View attendance history for assigned children
- ✓ Update contact details (mobile, address, etc.)

**Cannot do:**
- ✗ View contacts not assigned to them
- ✗ Create/delete contacts
- ✗ Create events
- ✗ Generate batches
- ✗ Export data beyond own assignments

**Dashboard Access:** Limited to own assigned contacts

---

### Sant (Saint/Observer)
**Observer role at events**

**Can do:**
- ✓ View Bal Mandal event schedule
- ✓ Mark own attendance as observer at events
- ✓ View event details

**Cannot do:**
- ✗ View contact details
- ✗ Mark regular attendance
- ✗ Access dashboard
- ✗ Add notes
- ✗ Manage any data

**Dashboard Access:** None (schedule view only)

---

## 4. Getting Started

### First-Time Setup (Admin Only)

#### Step 1: Create Sishu Mandal Document

Before using the system, you need to create the Sishu Mandal in Firestore.

**Option A: Using Script (Recommended)**
```bash
node scripts/create-sishu-mandal.js
```

**Option B: Manual Creation**
1. Open Firebase Console → Firestore Database
2. Go to `mandals` collection
3. Add document with these fields:
   - `name`: "Sishu Mandal"
   - `code`: "SHM"
   - `gender`: "Male"
   - `fields`: (map with all fields set to `true`)

#### Step 2: Enable Fields for Mandals

1. Log in as **Admin**
2. Navigate to **Admin → Areas & Mandals**
3. Scroll to **Mandals** section
4. For **Bal Mandal**, enable these checkboxes:
   - ☑ Study
   - ☑ Skill
   - ☑ Standard (LKG/UKG/1st-8th)
   - ☑ Hobby
   - ☑ Sampark Karyakarta

5. Repeat for **Sishu Mandal**

**Quick Method:** Click **"Ask everything"** button for each mandal to enable all fields at once.

#### Step 3: Create Volunteer Roles

1. Go to **Admin → Roles**
2. Create these roles if they don't exist:
   - **Nirdeshak** (Program: Bal Mandal)
   - **Sanchalak** (Program: Bal Mandal)
   - **Nirikshak** (Program: Bal Mandal)
   - **Sampark Karyakarta** (Program: Bal Mandal)
   - **Sant** (Program: Bal Mandal)

3. For each role, assign appropriate permissions:

**Nirdeshak Permissions:**
- ✓ manage_events
- ✓ view_all_contacts
- ✓ edit_contacts
- ✓ generate_batches
- ✓ assign_batches

**Sanchalak Permissions:**
- ✓ manage_events
- ✓ view_all_contacts
- ✓ edit_contacts

**Nirikshak Permissions:**
- ✓ view_all_contacts
- ✓ manage_events (for observer attendance)

**Sampark Karyakarta Permissions:**
- ✓ view_assigned_contacts
- ✓ edit_contacts

**Sant Permissions:**
- ✓ view_padhramani (for schedule access)

#### Step 4: Create Volunteers

1. Go to **Admin → Volunteers**
2. Click **"Add Volunteer"** button
3. Fill in volunteer details:
   - Name (required)
   - Mobile number (required, 10 digits)
   - Role (select from dropdown)
   - **Program**: Select "Bal Mandal"
   - Assigned Areas (select one or more areas)
   - Email (optional)
   - Status: Active

4. Click **Save**

**Important:** The "Program" field distinguishes Bal Mandal volunteers from Yuvak volunteers. Make sure to select "Bal Mandal" for all children's wing staff.

#### Step 5: Create Areas (if not already created)

1. Go to **Admin → Areas & Mandals**
2. In **Areas** section, click **"Add Area"**
3. Enter:
   - Area Name (e.g., "Mansarovar", "Vaishali Nagar")
   - Area Code (e.g., "MS", "VN")
4. Click **Save**

#### Step 6: Create Sub-Areas (Optional)

Sub-areas help divide large areas into smaller zones.

1. In **Areas** section, find the parent area
2. Click **"Add Sub-Area"**
3. Enter sub-area name
4. Click **Save**

---

## 5. Managing Contacts

### Adding a New Child

1. Navigate to **Contacts** page
2. Click **"Add Contact"** button
3. Fill in the form:

**Required Fields:**
- **Mandal**: Select "Bal Mandal" or "Sishu Mandal" (will auto-change based on standard)
- **Full Name**: Child's name (e.g., "Ravi Patel")
- **Mobile Number**: 10-digit number (parent/guardian number)

**Optional Fields (if enabled for mandal):**
- **Address**: Full address
- **Date of Birth**: Child's birth date
- **Area**: Select area (e.g., Mansarovar)
- **Sub-Area**: Select sub-area if applicable
- **Study**: Current school/education details
- **Skill**: Special skills (e.g., "Singing, tabla")

**Bal Mandal Specific Fields:**
- **Standard**: Select from dropdown (LKG, UKG, 1st-8th)
  - *Auto-assignment*: LKG/UKG/1st-4th → Sishu Mandal
  - *Auto-assignment*: 5th-8th → Bal Mandal
- **Hobby**: Multi-select dropdown (hold Ctrl/Cmd to select multiple)
  - Sports, Music, Dance, Drawing, Reading, Cricket, Football, Singing, Cooking, Technology, Photography, Yoga, Storytelling, Arts & Crafts, Gaming
  - Select "Other" and type custom hobby in text field
- **Sampark Karyakarta**: 
  - Type name to search volunteers
  - Select from autocomplete list (mobile auto-fills)
  - Or type name manually

**Photo Upload:**
- Click "Upload Photo" button
- Select image file
- Or check "Add photo later" to mark as pending

**Follow-up Calling:**
- ☑ On the follow-up calling list (default: checked)
- Uncheck to exclude from weekly batch generation

4. Click **"Add Member"** button

**Result:** Contact is saved and appears in contacts list. Mandal is automatically set based on selected standard.

---

### Editing an Existing Child

1. Go to **Contacts** page or **Individual Detail Page**
2. Click **Edit** button (pencil icon)
3. Modify fields as needed
4. Click **"Save Changes"**

**Note:** If you change the standard, the mandal will auto-update:
- Change from 4th to 5th → Moves from Sishu to Bal Mandal
- Change from 5th to 4th → Moves from Bal to Sishu Mandal

---

### Adding Notes to a Contact

Notes help track observations, incidents, or important information about a child.

1. Open **Individual Detail Page** (click on contact name)
2. Scroll to **Notes** panel (below Attendance History)
3. Type your note in the text box
4. Click **"Add Note"**

**Result:** Note is prepended with timestamp and your volunteer name:
```
[02/09/2026, 10:30 AM - Rajesh Kumar]
Child showed excellent participation in today's sabha.

[01/09/2026, 06:15 PM - Priya Sharma]
Spoke with parents about upcoming event.
```

**Who Can Add Notes:**
- Nirdeshak, Sanchalak, Nirikshak, SK (on assigned contacts), Admin

---

### Searching & Filtering Contacts

**Search Bar:**
1. Type child's name or mobile number in search box at top
2. Results appear instantly

**Filter by Mandal:**
1. Click **Mandal** dropdown
2. Select "Bal Mandal" or "Sishu Mandal"
3. List filters to show only selected mandal

**Filter by Standard:**
1. Click **Standard** dropdown
2. Select standard (LKG, UKG, 1st-8th)
3. List filters to show only that standard

**Filter by Area:**
1. Click **Area** dropdown
2. Select area
3. List filters to assigned area contacts

**Combined Filters:**
You can combine multiple filters (e.g., Area: Mansarovar + Standard: 5th)

---

## 6. Bal Mandal Dashboard

### Accessing the Dashboard

1. Click **"Bal Mandal"** in sidebar navigation
2. Dashboard loads with 10 key metrics

**Who Can Access:**
- Admin (all areas)
- Nirdeshak (assigned areas)
- Sanchalak (assigned areas)
- Nirikshak (assigned areas, read-only)
- SK (own assigned contacts only)

---

### Dashboard Metrics Explained

#### 1. Total Contacts
**What it shows:** Total number of children in Bal + Sishu Mandal  
**Split:** Shows breakdown (e.g., "156 total (92 Bal / 64 Sishu)")  
**Use case:** Monitor program growth month-over-month

#### 2. Standard Breakdown
**What it shows:** Grid showing count per standard (LKG-8th)  
**Example:**
```
LKG: 12    UKG: 15
1st: 18    2nd: 20    3rd: 14    4th: 16
5th: 22    6th: 20    7th: 18    8th: 12
```
**Use case:** Identify which standards need more attention or resources

#### 3. Unassigned Standard
**What it shows:** Number of contacts without a standard selected  
**Alert:** Shows in orange if count > 0  
**Action:** Edit contacts to assign proper standard

#### 4. SK Coverage
**What it shows:** Percentage of children assigned to a Sampark Karyakarta  
**Example:** "85% (133/156 assigned)"  
**Target:** Aim for 100% coverage  
**Action:** Use batch generator to auto-assign remaining contacts

#### 5. Promotion Ready
**What it shows:** Number of 8th standard students ready for Yuvak transfer  
**Use case:** Plan yearly promotion event  
**Action:** Go to Standard Promotion page to execute bulk transfer

#### 6. Average Attendance
**What it shows:** Average attendance rate across recent events  
**Calculation:** (Total present / Total events) × 100  
**Example:** "78% average"  
**Use case:** Track engagement trends

#### 7. Mobile Coverage
**What it shows:** Percentage of contacts with mobile number on file  
**Example:** "95% have mobile"  
**Use case:** Ensure you can reach all families

#### 8. Notes Activity
**What it shows:** Number of contacts with notes added in last 30 days  
**Example:** "42 contacts with recent notes"  
**Use case:** Monitor SK engagement with families

#### 9. Upcoming Events
**What it shows:** Next 3 scheduled Bal Mandal events  
**Details:** Date, time, location  
**Action:** Click event to view details or mark attendance

#### 10. Recent Attendance
**What it shows:** Last 5 events with attendance counts  
**Example:** "Sabha - 02/09/2026 - 45/60 present (75%)"  
**Use case:** Spot attendance drop trends

---

### Area Filter

**Location:** Top-right dropdown on dashboard  
**Options:** "All Areas" or specific area (e.g., "Mansarovar")  
**Effect:** All 10 metrics update to show only selected area data

---

### Export Functions

#### VCF Export (Phone Contacts)

1. Click **"Export VCF"** button on dashboard
2. Modal opens with options:
   - **Prefix**: Add before name (None/Area/Sub-Area/Mandal)
   - **Suffix**: Add after name (None/Area/Sub-Area/Mandal)
3. Click **"Generate VCF"**
4. File downloads: `bal-mandal-contacts.vcf`
5. Import to phone contacts app

**Example Output:**
```
Prefix: Area, Suffix: Mandal
Result: "Mansarovar Ravi Patel Bal Mandal"
```

**Use case:** SK volunteers can import assigned contacts to phone for easy calling

---

#### Batch Generator

Generate sampark batches with automatic SK assignment.

1. Click **"Generate Batches"** button on dashboard
2. Select **Area**
3. Click **"Preview"**
4. System shows:
   - Number of batches to be created
   - Unassigned contacts count
   - SK assignment distribution (round-robin)5. Click **"Generate"**
6. System creates batches and assigns contacts to SKs using round-robin

**Round-Robin Logic:**
- System counts current assigned contacts per SK
- Assigns new batch to SK with lowest contact count
- Ensures balanced workload distribution

**Result:** Batches created, contacts assigned, SKs can see their assignments in "My Contacts"

---

## 7. Events & Attendance

### Creating a Bal Mandal Event

1. Navigate to **Events** page
2. Click **"Create Event"** button
3. Fill in event details:

**Required Fields:**
- **Event Name**: (e.g., "Sunday Sabha", "Bal Din Celebration")
- **Event Type**: Select "Sabha", "Festival", "Training", "Meeting", or "Other"
- **Mandal**: Select "Bal Mandal" or "Sishu Mandal"
- **Date**: Event date
- **Time**: Start time
- **Area**: Select area (filters which children can attend)

**Optional Fields:**
- **Location**: Venue address
- **Description**: Event details
- **Speaker**: Type name (autocomplete from past speakers) - for Yuvak Sabha only
- **Duration**: Free number input in minutes (for Yuvak Sabha only)

4. Click **"Create Event"**

**Result:** Event appears in Events list and on Bal Mandal dashboard

---

### Marking Attendance

#### Regular Attendance (Children)

1. Open event detail page
2. **Attendance Panel** shows list of children from selected area/mandal
3. Two methods to mark attendance:

**Method A: Click Individual Names**
- Click on child's name or card
- Checkmark appears when marked present
- Click again to unmark

**Method B: Search & Mark**
- Use search box at top of attendance panel
- Type child's name
- Click to mark present

4. Attendance saves automatically

**Who Can Mark:** Nirdeshak, Sanchalak, SK (for assigned contacts)

---

#### Observer Attendance

Observer attendance tracks Nirikshak and Sant volunteers who attend events.

1. Scroll to **Observer Attendance Panel** (below regular attendance)
2. Panel shows:
   - All Nirikshak volunteers (Program: Bal Mandal)
   - All Sant volunteers (Program: Bal Mandal)
3. Click volunteer name to mark present
4. Green checkmark appears when marked

**Storage:** Observer attendance stored in subcollection `events/{eventId}/observerAttendance/{volunteerId}`

**Who Can Mark:** Nirdeshak, Sanchalak, Admin

**Use Case:** Track which observers monitored the event for quality assurance

---

### Viewing Attendance History

**For a Specific Child:**
1. Open **Individual Detail Page**
2. Scroll to **Attendance History** panel
3. View list of events attended with dates
4. See attendance percentage

**For an Event:**
1. Open **Event Detail Page**
2. View attendance count (e.g., "45/60 present - 75%")
3. See list of present/absent children

---

## 8. Batch Management

### Understanding Batches

**What is a Batch?**
A batch is a group of contacts assigned to a Sampark Karyakarta (SK) for follow-up calling.

**Batch Components:**
- Area (e.g., Mansarovar)
- Mandal (Bal Mandal or Sishu Mandal)
- Assigned SK name and mobile
- List of contact IDs
- Creation timestamp

---

### Generating Batches

**Automatic SK Assignment:**

1. Go to **Bal Mandal Dashboard**
2. Click **"Generate Batches"** button
3. Select **Area** from dropdown
4. Click **"Preview"**

**Preview Shows:**
- Total contacts in selected area
- Number of batches to create
- SK assignment distribution
- Unassigned contacts count

5. Review preview
6. Click **"Generate Batches"**

**System Process:**
1. Loads all active SK volunteers in selected area (Program: Bal Mandal, roleKey: 'sk')
2. Counts existing assigned contacts per SK
3. Creates batches and assigns to SK with lowest contact count (round-robin)
4. Updates `samparkKaryakartaName` and `samparkKaryakartaNumber` on contacts
5. Creates batch documents in Firestore

**Batch Size:** System automatically determines optimal batch size (typically 15-20 contacts per batch)

**Result:** SKs can now see their assigned contacts in "My Contacts" page

---

### Viewing Assigned Batches

**For SK:**
1. Click **"My Contacts"** in sidebar
2. View list of assigned children
3. Click contact to see details, add notes, view history

**For Admin/Nirdeshak/Sanchalak:**
1. Go to **Admin → Batches** (if permission enabled)
2. View all batches with filters:
   - Area
   - Mandal
   - Assigned SK
   - Date range

---

### Editing Batch Assignments

**Reassign a Contact to Different SK:**

1. Open **Individual Detail Page**
2. Click **Edit** button
3. Change **Sampark Karyakarta** field:
   - Search for new SK name
   - Select from dropdown
4. Click **"Save Changes"**

**Result:** Contact moves from old SK to new SK's "My Contacts" list

---

## 9. Standard Promotion Workflow

### Overview

Once per year (typically at academic year end), all children are promoted to the next standard. 8th standard students are transferred to Yuvak Mandal.

**Access:** Nirdeshak and Admin only

**Path:** Bal Mandal → Standard Promotion

---

### Running Standard Promotion

**IMPORTANT: This is a bulk operation. BACKUP your Firestore database before proceeding.**

1. Navigate to **Bal Mandal → Standard Promotion**
2. Page shows preview of all promotions grouped by current standard:

**Preview Table:**
```
Current Standard | Count | Next Standard | Action
─────────────────────────────────────────────────
LKG              | 12    | UKG          | Promote
UKG              | 15    | 1st          | Promote
1st              | 18    | 2nd          | Promote
2nd              | 20    | 3rd          | Promote
3rd              | 14    | 4th          | Promote
4th              | 16    | 5th          | Promote (→ Bal Mandal)
5th              | 22    | 6th          | Promote
6th              | 20    | 7th          | Promote
7th              | 18    | 8th          | Promote
8th              | 12    | 9th          | Transfer to Yuvak Mandal
```

3. Click **"Preview Transfer Report"** to download CSV with:
   - Student name
   - Current standard
   - Next standard
   - Mandal change (if any)
   - Transfer status (for 8th std)

4. Review CSV file carefully

5. Click **"Execute Standard Promotion"** button

**Confirmation Dialog:**
```
⚠️ This will promote ALL students to next standard and 
transfer 8th standard students to Yuvak Mandal.

This action creates a new commit in the database.
You should have a backup before proceeding.

Are you sure you want to continue?
```

6. Click **"Yes, Execute Promotion"**

**System Process:**
- Uses `writeBatch` for atomic updates
- Respects `WRITE_BATCH_LIMIT = 450` (commits in chunks if needed)
- For LKG-7th: Updates `standard` field to next value
- For 8th standard students:
  - Updates `standard` to "9th"
  - Changes `mandal` from "Bal Mandal" to "Yuvak Mandal"
  - Adds `transferredFromBalMandal: true`
  - Adds `transferredAt: serverTimestamp()`
  - Copies `notes` to `balMandalHistory` field for preservation
- Commits all changes in batches

7. Success message appears
8. Page refreshes to show updated counts

**Result:** All children promoted. 8th standard students now appear in Yuvak Mandal contacts.

---

### Post-Promotion Tasks

1. **Verify Transfer:**
   - Go to Contacts page
   - Filter by "Yuvak Mandal"
   - Confirm 8th standard students appear with new standard "9th"

2. **Re-assign SKs if needed:**
   - New 5th standard students (promoted from Sishu) now in Bal Mandal
   - May need to generate new batches for balanced assignment

3. **Update Event Targeting:**
   - Future events should target correct standards
   - 9th standard (ex-8th) no longer appear in Bal Mandal event attendance

---

## 10. Reports & Exports

### VCF Export (Detailed)

**Purpose:** Export contacts as vCard format for importing to phone contacts app.

**Access:** Bal Mandal Dashboard → "Export VCF" button

**Options:**

1. **Prefix Dropdown:**
   - None (default)
   - Area name (e.g., "Mansarovar Ravi Patel")
   - Sub-Area name (e.g., "Zone A Ravi Patel")
   - Mandal name (e.g., "Bal Mandal Ravi Patel")

2. **Suffix Dropdown:**
   - None (default)
   - Area name (e.g., "Ravi Patel Mansarovar")
   - Sub-Area name (e.g., "Ravi Patel Zone A")
   - Mandal name (e.g., "Ravi Patel Bal Mandal")

**Example Combinations:**
```
Prefix: Area, Suffix: Mandal
Result: "Mansarovar Ravi Patel Bal Mandal"

Prefix: None, Suffix: Area
Result: "Ravi Patel Mansarovar"

Prefix: Mandal, Suffix: None
Result: "Bal Mandal Ravi Patel"
```

**Generated vCard Format:**
```
BEGIN:VCARD
VERSION:3.0
FN:Mansarovar Ravi Patel Bal Mandal
N:Ravi Patel;;;;
TEL;TYPE=CELL:9876543210
ADR:;;123 BAPS Street, Mansarovar;;;;
ORG:Bal Mandal
END:VCARD
```

**File Output:** `bal-mandal-contacts.vcf`

**Import to Phone:**
- iPhone: Open file → Import to Contacts
- Android: Contacts app → Import → Select VCF file

---

### CSV Exports

**Standard Breakdown Report:**
1. Go to Bal Mandal Dashboard
2. View Standard Breakdown grid
3. Click **"Export CSV"** (if available)
4. Downloads spreadsheet with:
   - Standard
   - Count
   - Percentage
   - Assigned SK count
   - Unassigned count

**Attendance Report:**
1. Go to Events page
2. Select event
3. Click **"Export Attendance"**
4. Downloads CSV with:
   - Child name
   - Mobile
   - Area
   - Standard
   - Attendance status (Present/Absent)
   - SK assigned

---

### Dashboard Snapshot

**Print/Save Dashboard:**
1. Open Bal Mandal Dashboard
2. Select area filter (or "All Areas")
3. Use browser Print function (Ctrl+P / Cmd+P)
4. Select "Save as PDF"
5. PDF includes all 10 metrics with current values

**Use Case:** Monthly reports for Nirdeshak review

---

## 11. Admin Configuration

### Creating a New Role

1. Go to **Admin → Roles**
2. Click **"Add Role"** button
3. Fill in role details:**Required Fields:**
- **Role Name**: (e.g., "Bal Mandal Coordinator")
- **Role Key**: Unique identifier (e.g., "bal_coordinator")
- **Program**: Select "Bal Mandal"

**Permissions (check boxes):**

Core Permissions:
- ☑ view_all_contacts - See all contacts in assigned areas
- ☑ view_assigned_contacts - See only assigned contacts
- ☑ edit_contacts - Add/edit/delete contacts
- ☑ view_households - View household groupings
- ☑ manage_events - Create/edit events
- ☑ generate_batches - Create new sampark batches
- ☑ assign_batches - Assign batches to volunteers
- ☑ manage_users - Create/edit volunteers
- ☑ manage_roles - Create/edit roles
- ☑ view_padhramani - View padhramani schedule (for Sant role)

**Example Role Configurations:**

**Bal Mandal Nirdeshak:**
```
Name: Bal Mandal Director
Role Key: bal_nirdeshak
Program: Bal Mandal
Permissions:
  ✓ view_all_contacts
  ✓ edit_contacts
  ✓ manage_events
  ✓ generate_batches
  ✓ assign_batches
```

**Bal Mandal SK:**
```
Name: Bal Mandal Sampark Karyakarta
Role Key: bal_sk
Program: Bal Mandal
Permissions:
  ✓ view_assigned_contacts
  ✓ edit_contacts
  ✓ manage_events (for attendance marking)
```

4. Click **"Save Role"**

**Result:** Role appears in dropdown when creating volunteers

---

### Creating a New Area

1. Go to **Admin → Areas & Mandals**
2. In **Areas** section, click **"Add Area"**
3. Enter area details:

**Required Fields:**
- **Area Name**: Full name (e.g., "Mansarovar")
- **Area Code**: 2-3 letter code (e.g., "MS")

**Optional Fields:**
- **Description**: Additional details

4. Click **"Save"**

**Result:** Area appears in dropdowns throughout the system

---

### Creating Sub-Areas

Sub-areas help divide large geographic areas into smaller zones.

1. In **Areas** section, find parent area row
2. Click **"Add Sub-Area"** button in that row
3. Enter sub-area name (e.g., "Sector 1", "Zone A")
4. Click **"Save"**

**Example Structure:**
```
Mansarovar (Area)
├── Sector 1 (Sub-Area)
├── Sector 2 (Sub-Area)
└── Sector 3 (Sub-Area)

Vaishali Nagar (Area)
├── East Zone (Sub-Area)
└── West Zone (Sub-Area)
```

**Result:** Sub-areas appear in contact form when parent area is selected

---

### Configuring Mandal Fields

Control which fields appear in the contact form for each mandal.

1. Go to **Admin → Areas & Mandals**
2. Scroll to **Mandals** section
3. Find mandal row (e.g., "Bal Mandal")
4. **Field Checkboxes** show available fields:

**Available Fields:**
- ☑ Photo - Photo upload
- ☑ DOB - Date of birth
- ☑ Anniversary - Marriage anniversary
- ☑ Relation - Relationship to household head
- ☑ Is Primary - Primary contact in household
- ☑ Area - Area/sub-area selection
- ☑ Study - Education details
- ☑ Profession - Occupation (for adults)
- ☑ Skill - Special skills
- ☑ Sampark Karyakarta - SK assignment
- ☑ Standard - LKG-8th (for children)
- ☑ Hobby - Interests/hobbies

5. Check/uncheck boxes to enable/disable fields
6. Changes save automatically

**Quick Enable All:**
- Click **"Ask everything"** button to enable all fields at once

**Result:** When adding a contact under this mandal, only enabled fields appear in the form

---

### Managing Volunteers

#### Creating a Volunteer

1. Go to **Admin → Volunteers**
2. Click **"Add Volunteer"** button
3. Fill in volunteer form:

**Required Fields:**
- **Full Name**: (e.g., "Rajesh Kumar")
- **Mobile Number**: 10-digit number (e.g., 9876543210)
- **Role**: Select from dropdown (e.g., "Sampark Karyakarta")
- **Program**: Select "Bal Mandal" or "Yuvak"
- **Assigned Areas**: Select one or more areas (hold Ctrl/Cmd for multiple)

**Optional Fields:**
- **Email**: Email address
- **Address**: Full address
- **Photo**: Upload volunteer photo
- **Notes**: Internal notes about volunteer

**Status:**
- ☑ Active (check to mark volunteer as active)
- Inactive volunteers don't appear in assignment dropdowns

4. Click **"Save Volunteer"**

**Result:** Volunteer can now log in and access system based on role permissions

---

#### Editing a Volunteer

1. Go to **Admin → Volunteers**
2. Find volunteer in list (use search box)
3. Click **Edit** button (pencil icon)
4. Modify fields as needed
5. Click **"Save Changes"**

**Common Edits:**
- Change assigned areas (when volunteer moves to different zone)
- Update mobile number
- Change role (promote SK to Sanchalak)
- Mark as inactive (when volunteer leaves)

---

#### Deactivating a Volunteer

**When to Deactivate:**
- Volunteer is no longer serving
- Volunteer moved to different program
- Temporary leave of absence

**How to Deactivate:**
1. Edit volunteer
2. Uncheck **"Active"** checkbox
3. Save

**Effect:**
- Volunteer cannot log in
- Doesn't appear in SK assignment dropdowns
- Existing assignments remain intact
- Can be reactivated later without losing data

---

### Creating City Sabha Event (Special Event Type)

City Sabha is a large-scale event involving multiple areas and mandals.

1. Go to **Events** page
2. Click **"Create Event"** button
3. Fill in event form:

**Required Fields:**
- **Event Name**: "City Sabha" or custom name
- **Event Type**: Select "Sabha"
- **Mandal**: Select "Bal Mandal" or "Sishu Mandal"
- **Date**: Event date
- **Time**: Start time

**For City Sabha:**
- **Area**: Select "All Areas" or multiple areas
- **Location**: Central venue address
- **Description**: Event details, special instructions

**Optional Fields:**
- **Speaker**: Name of speaker (autocomplete)
- **Duration**: Duration in minutes
- **Max Attendance**: Expected headcount

4. Click **"Create Event"**

**Attendance Tracking:**
- When area is "All Areas", attendance panel shows children from all areas
- Use search to quickly find and mark attendance
- Export attendance report after event

---

## 12. Troubleshooting

### Issue: Study and Skill Fields Not Showing

**Symptom:** When adding a contact under Bal Mandal, Study and Skill dropdowns are missing.

**Cause:** Mandal fields are not enabled in configuration.

**Solution:**
1. Log in as Admin
2. Go to Admin → Areas & Mandals
3. Scroll to Mandals section
4. Find "Bal Mandal" row
5. Check boxes for: Study, Skill, Standard, Hobby
6. Or click "Ask everything" button
7. Repeat for "Sishu Mandal"

**Verification:**
- Go to Contacts → Add contact
- Select "Bal Mandal"
- Verify all fields now appear

---

### Issue: Sishu Mandal Not in Dropdown

**Symptom:** When creating a contact, only "Bal Mandal" appears in Mandal dropdown, not "Sishu Mandal".

**Cause:** Sishu Mandal document doesn't exist in Firestore.

**Solution:**
1. Run script: `node scripts/create-sishu-mandal.js`
2. Script creates Sishu Mandal with all fields enabled
3. Refresh browser
4. Verify "Sishu Mandal" now appears in dropdown

**Alternative Manual Creation:**
1. Firebase Console → Firestore Database
2. Go to `mandals` collection
3. Add document:
   - `name`: "Sishu Mandal"
   - `code`: "SHM"
   - `gender`: "Male"
   - `fields`: (map with all fields set to `true`)

---

### Issue: Standard Not Auto-Assigning Mandal

**Symptom:** When selecting "3rd" standard, mandal doesn't change to "Sishu Mandal".

**Cause:** Auto-assignment logic only triggers when standard changes, not on initial selection.

**Expected Behavior:**
- **Create new contact:** Select standard first, then mandal auto-sets when you tab out
- **Edit existing contact:** Change standard from 5th to 3rd → mandal auto-changes to Sishu

**Workaround:**
- Select standard dropdown
- Choose standard (e.g., "3rd")
- Click outside dropdown or press Tab
- Mandal field updates automatically

---

### Issue: SK Cannot See Assigned Contacts

**Symptom:** SK logs in but "My Contacts" page is empty, even though batches were generated.

**Cause:** One of these:
1. SK volunteer doesn't have `view_assigned_contacts` permission
2. SK's areas don't match contact areas
3. Contact's `samparkKaryakartaName` doesn't match SK's name exactly

**Solution:**

**Check Permissions:**
1. Admin → Roles
2. Find SK role
3. Verify ☑ `view_assigned_contacts` is checked
4. Save if modified

**Check Areas:**
1. Admin → Volunteers
2. Find SK volunteer
3. Verify assigned areas match contact areas
4. Add missing areas if needed

**Check Name Matching:**
1. Admin → Volunteers → Edit SK
2. Note exact name spelling (e.g., "Rajesh Kumar")
3. Contacts → Find assigned contact
4. Edit contact → Sampark Karyakarta field
5. Verify exact name match (case-sensitive)

---

### Issue: Bal Mandal Dashboard Not Visible

**Symptom:** "Bal Mandal" link doesn't appear in sidebar navigation.

**Cause:** Volunteer doesn't have `manage_events` permission.

**Solution:**
1. Admin → Roles
2. Find volunteer's role
3. Check box for ☑ `manage_events`
4. Save role
5. Have volunteer log out and log back in
6. "Bal Mandal" link now appears in sidebar

---

### Issue: Observer Attendance Panel Missing

**Symptom:** When viewing event, only regular attendance panel shows, no observer panel.

**Cause:** One of these:
1. Event mandal is not "Bal Mandal" or "Sishu Mandal"
2. No volunteers with program "Bal Mandal" and role "Nirikshak" or "Sant" exist

**Solution:**

**Check Event Mandal:**
1. Edit event
2. Verify Mandal is "Bal Mandal" or "Sishu Mandal"
3. Save

**Create Observer Volunteers:**
1. Admin → Volunteers
2. Create volunteer with:
   - Role: "Nirikshak" or "Sant"
   - Program: "Bal Mandal"
   - Status: Active
3. Refresh event page
4. Observer panel now appears

---

### Issue: Hobby "Other" Text Field Not Appearing

**Symptom:** Selected "Other" from Hobby dropdown but text field doesn't show.

**Cause:** Browser didn't detect the change event.

**Solution:**
- Click outside the dropdown after selecting "Other"
- Or press Tab key
- Text field should appear below dropdown
- If still not working, refresh page and try again

---

### Issue: Standard Promotion Not Working

**Symptom:** Clicked "Execute Standard Promotion" but nothing happened or error occurred.

**Possible Causes:**
1. Insufficient Firestore permissions
2. Too many contacts (exceeds batch limit)
3. Network timeout

**Solution:**

**Check Permissions:**
- User must be Admin or have Nirdeshak role
- Check Firebase Console → Firestore → Rules
- Verify update rules allow bulk writes

**Check Contact Count:**
- Standard Promotion page shows preview count
- If > 5000 contacts, promotion may timeout
- Contact system administrator for manual migration

**Try Again:**
1. Refresh page
2. Click "Execute Standard Promotion" again
3. Wait for success message (may take 30-60 seconds for large datasets)

**Manual Promotion (if automated fails):**
1. Export contacts to CSV
2. Use spreadsheet to update standard column (LKG→UKG, 1st→2nd, etc.)
3. Use import feature to re-import updated CSV

---

### Issue: VCF Export File Not Opening

**Symptom:** Downloaded .vcf file but phone won't import it.

**Cause:** VCF format incompatibility with some phone models.

**Solution:**

**iPhone:**
- Email the .vcf file to yourself
- Open email on iPhone
- Tap attachment
- Choose "Add All Contacts"

**Android:**
- Copy .vcf file to phone storage
- Open Contacts app
- Menu → Import → From storage
- Select .vcf file

**Alternative:**
- Open .vcf file in text editor
- Copy contact details manually
- Or use Google Contacts web interface to import

---

### Issue: Dashboard Metrics Not Updating

**Symptom:** Added new contacts but dashboard still shows old count.

**Cause:** Browser cache or query hasn't refreshed.

**Solution:**
1. Click area filter dropdown at top-right
2. Select different area, then select back to original
3. Metrics refresh with new data
4. Or hard refresh browser (Ctrl+Shift+R / Cmd+Shift+R)

---

### Issue: Cannot Delete Contact

**Symptom:** Clicked delete but contact still appears.

**Cause:** Contact is linked to a household or has attendance records.

**Solution:**

**Remove from Household First:**
1. Go to Households page
2. Find household containing contact
3. Remove contact from household
4. Return to Contacts page
5. Delete contact

**Attendance Records:**
- Contacts with attendance history cannot be deleted (data integrity)
- Mark contact as inactive instead
- Or edit contact and add note explaining why inactive

---

## Appendix A: Quick Reference Tables

### Standard to Mandal Mapping

| Standard | Auto-Assigned Mandal |
|----------|---------------------|
| LKG      | Sishu Mandal        |
| UKG      | Sishu Mandal        |
| 1st      | Sishu Mandal        |
| 2nd      | Sishu Mandal        |
| 3rd      | Sishu Mandal        |
| 4th      | Sishu Mandal        |
| 5th      | Bal Mandal          |
| 6th      | Bal Mandal          |
| 7th      | Bal Mandal          |
| 8th      | Bal Mandal          |

**Note:** 8th standard students transfer to Yuvak Mandal during yearly promotion.

---

### Hobby Options

Available options in Hobby multi-select dropdown:

- Sports
- Music
- Dance
- Drawing
- Reading
- Cricket
- Football
- Singing
- Cooking
- Technology
- Photography
- Yoga
- Storytelling
- Arts & Crafts
- Gaming
- **Other** (opens free text field)

---

### Permission Matrix

| Permission              | Admin | Nirdeshak | Sanchalak | Nirikshak | SK | Sant |
|------------------------|-------|-----------|-----------|-----------|----|----- |
| view_all_contacts      | ✓     | ✓         | ✓         | ✓         | ✗  | ✗    |
| view_assigned_contacts | ✓     | ✓         | ✓         | ✗         | ✓  | ✗    |
| edit_contacts          | ✓     | ✓         | ✓         | ✗         | ✓  | ✗    |
| manage_events          | ✓     | ✓         | ✓         | ✓         | ✓  | ✗    |
| generate_batches       | ✓     | ✓         | ✗         | ✗         | ✗  | ✗    |
| assign_batches         | ✓     | ✓         | ✗         | ✗         | ✗  | ✗    |
| manage_users           | ✓     | ✗         | ✗         | ✗         | ✗  | ✗    |
| manage_roles           | ✓     | ✗         | ✗         | ✗         | ✗  | ✗    |
| view_padhramani        | ✓     | ✗         | ✗         | ✗         | ✗  | ✓    |

---

### Event Types

| Event Type | Description | Common Use |
|-----------|-------------|------------|
| Sabha | Regular congregation | Weekly Sunday sabha |
| Festival | Special celebration | Bal Din, Diwali |
| Training | Skill development | Leadership workshop |
| Meeting | Planning session | SK coordination meeting |
| Other | Custom event | Sports day, picnic |

---

## Appendix B: Workflow Diagrams

### Contact Creation Workflow

```
Start
  ↓
[Admin/Sanchalak clicks "Add Contact"]
  ↓
[Fill Name, Mobile, Area]
  ↓
[Select Standard from dropdown]
  ↓
[System auto-assigns Mandal]
  ├─ LKG-4th → Sishu Mandal
  └─ 5th-8th → Bal Mandal
  ↓
[Fill Hobby (multi-select)]
  ├─ Select multiple from dropdown
  └─ If "Other" → Enter custom text
  ↓
[Fill Study, Skill, SK]
  ↓
[Click "Add Member"]
  ↓
[Contact saved to Firestore]
  ↓
End
```

---

### Batch Generation Workflow

```
Start
  ↓
[Nirdeshak opens Bal Mandal Dashboard]
  ↓
[Click "Generate Batches"]
  ↓
[Select Area]
  ↓
[Click "Preview"]
  ↓
[System queries:]
  ├─ All contacts in area without SK
  └─ All active SK volunteers in area
  ↓
[Count existing assignments per SK]
  ↓
[Sort SKs by contact count (ascending)]
  ↓
[For each unassigned contact:]
  ├─ Assign to SK with lowest count
  └─ Increment that SK's count
  ↓
[Show preview with distribution]
  ↓
[User reviews → Click "Generate"]
  ↓
[System creates batches using writeBatch]
  ↓
[Updates contact documents with SK info]
  ↓
[Commits batches to Firestore]
  ↓
[Success message shown]
  ↓
End
```

---

### Standard Promotion Workflow

```
Start (Once per year)
  ↓
[Nirdeshak opens Standard Promotion page]
  ↓
[System loads all Bal/Sishu contacts]
  ↓
[Groups by current standard]
  ↓
[Shows preview table with counts]
  ↓
[User downloads CSV report]
  ↓
[User reviews report]
  ↓
[User clicks "Execute Promotion"]
  ↓
[Confirmation dialog → User confirms]
  ↓
[System creates writeBatch]
  ↓
[For each contact:]
  ├─ LKG → UKG
  ├─ UKG → 1st
  ├─ 1st → 2nd
  ├─ 2nd → 3rd
  ├─ 3rd → 4th
  ├─ 4th → 5th (Sishu → Bal Mandal)
  ├─ 5th → 6th
  ├─ 6th → 7th
  ├─ 7th → 8th
  └─ 8th → 9th + Transfer to Yuvak Mandal
       ├─ mandal = "Yuvak Mandal"
       ├─ transferredFromBalMandal = true
       ├─ transferredAt = timestamp
       └─ balMandalHistory = notes field
  ↓
[Commit batches (respects 450 limit)]
  ↓
[Success message]
  ↓
[Dashboard updates with new counts]
  ↓
End
```

---

## Appendix C: Firestore Data Structure

### individuals Collection

```javascript
{
  id: "abc123",
  name: "Ravi Patel",
  mobile: "9876543210",
  mandal: "Bal Mandal",
  area: "Mansarovar",
  subArea: "Sector 1",
  standard: "5th",
  hobby: ["Sports", "Music", "Other"],
  hobbyOther: "Chess",
  study: "Shanti Asiatic School",
  skill: "Drawing, tabla",
  samparkKaryakartaName: "Rajesh Kumar",
  samparkKaryakartaNumber: "9123456789",
  notes: "[02/09/2026, 10:30 AM - Rajesh Kumar]\nExcellent participation.\n\n[01/09/2026 - Priya]\nParent meeting scheduled.",
  dob: Timestamp,
  address: "123 BAPS Street",
  photo: "https://storage.../photo.jpg",
  isActive: true,
  onFollowUpList: true,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  // Transfer fields (after 8th promotion)
  transferredFromBalMandal: true,
  transferredAt: Timestamp,
  balMandalHistory: "Full notes history from Bal Mandal",
}
```

---

### batches Collection

```javascript
{
  id: "batch123",
  area: "Mansarovar",
  mandal: "Bal Mandal",
  assignedTo: "Rajesh Kumar",
  assignedToMobile: "9123456789",
  contactIds: ["abc123", "def456", "ghi789"],
  createdAt: Timestamp,
  program: "Bal Mandal",
}
```

---

### events Collection

```javascript
{
  id: "event123",
  name: "Sunday Sabha",
  type: "Sabha",
  mandal: "Bal Mandal",
  area: "Mansarovar",
  date: Timestamp,
  time: "10:00 AM",
  location: "BAPS Mandir, Mansarovar",
  description: "Regular weekly sabha",
  createdBy: "volunteer_id",
  createdAt: Timestamp,
}
```

---

### events/{eventId}/observerAttendance Subcollection

```javascript
{
  id: "volunteer_id",
  volunteerId: "volunteer_id",
  markedAt: Timestamp,
  markedBy: "admin_volunteer_id",
}
```

---

### volunteers Collection

```javascript
{
  id: "vol123",
  name: "Rajesh Kumar",
  mobile: "9123456789",
  email: "rajesh@example.com",
  roleKey: "sk",
  program: "Bal Mandal",
  assignedAreas: ["Mansarovar", "Vaishali Nagar"],
  isActive: true,
  photo: "https://storage.../volunteer.jpg",
  notes: "Very dedicated SK, 5 years experience",
  createdAt: Timestamp,
}
```

---

## Appendix D: System Limits & Best Practices

### Firebase Free Tier Limits

**Daily Limits:**
- Reads: 50,000 per day
- Writes: 20,000 per day
- Deletes: 20,000 per day

**Best Practices to Stay Within Limits:**

1. **Use Dashboard Filters:**
   - Don't load all areas at once
   - Filter to specific area when possible

2. **Batch Operations:**
   - Generate batches for one area at a time
   - Don't run multiple batch generations simultaneously

3. **Standard Promotion:**
   - Run once per year only
   - Backup database first
   - Run during off-peak hours

4. **Event Attendance:**
   - Mark attendance during event, not after
   - Use search to find contacts instead of scrolling full list

5. **Dashboard Refresh:**
   - Dashboard auto-loads on page visit
   - Don't refresh repeatedly
   - Use area filter to reduce query size

---

### Recommended Data Entry Workflow

**Weekly Routine:**

**Monday:**
- Review dashboard metrics
- Identify contacts without SK assignment
- Generate batches for unassigned contacts

**Tuesday-Saturday:**
- SKs add notes on family contacts throughout week
- Update mobile numbers if changed
- Mark any contacts as inactive if moved away

**Sunday:**
- Create week's Sabha event
- Mark attendance during Sabha
- Observer attendance marked by end of event

**Monthly:**
- Review Standard Breakdown metrics
- Check SK coverage percentage (target: 100%)
- Export VCF for new SKs joining

**Yearly (June/July):**
- Backup Firestore database
- Run Standard Promotion workflow
- Transfer 8th students to Yuvak
- Generate new batches for promoted 5th standard students

---

### Security Best Practices

1. **Volunteer Accounts:**
   - Use strong passwords (min 8 characters, mixed case, numbers)
   - Don't share login credentials
   - Log out after each session on shared computers

2. **Mobile Numbers:**
   - Verify mobile numbers before saving
   - Don't use fake numbers for testing (use 9999999999)
   - Update immediately if parent changes number

3. **Photos:**
   - Get parent permission before uploading child photos
   - Don't share photos outside organization
   - Use "Add photo later" if permission pending

4. **Notes:**
   - Keep notes professional and factual
   - Don't include sensitive medical/family information
   - Use notes for sampark tracking only

5. **Exports:**
   - VCF exports contain phone numbers - handle securely
   - Don't share exported files via public channels
   - Delete old exports from device after importing

---

## Support & Contact

**For Technical Issues:**
- Email: Manish Kumawat (manishkumawat@example.com)
- Document Issues: Check Troubleshooting section (Section 12)

**For System Training:**
- Request training session for new volunteers
- Group training available for area coordinators

**For Feature Requests:**
- Submit via Admin panel feedback form
- Or email technical team with detailed description

---

**Document Version:** 1.0  
**Last Updated:** September 2, 2026  
**Prepared By:** System Development Team  
**Approved By:** Manish Kumawat

---

## End of Manual

**Next Steps:**
1. Complete one-time setup (Section 4)
2. Create first volunteer accounts
3. Train Sanchalak and SKs on contact entry
4. Run first batch generation
5. Create first Sabha event and mark attendance
6. Review dashboard metrics weekly

**Happy Managing! 🙏**