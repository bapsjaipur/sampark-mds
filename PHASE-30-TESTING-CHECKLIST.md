# Phase 30 - Bal Mandal Testing Checklist

## Updates Applied

✓ Sishu Mandal added to DEFAULT_MANDALS in areaMandalCodes.js
✓ Standard auto-assignment: LKG/UKG/1st-4th → Sishu Mandal, 5th-8th → Bal Mandal
✓ Hint text updated to include LKG and UKG
✓ Hobby field changed from checkboxes to multi-select dropdown with "Other" option
✓ hobbyOther field added for free text when "Other" is selected

## Configuration Required (One-Time Setup)

### Step 1: Create Sishu Mandal Document
Run the script to create Sishu Mandal in Firestore:
```bash
node scripts/create-sishu-mandal.js
```

This creates a new mandal document with all fields enabled.

### Step 2: Enable Fields for Existing Mandals
Log in with admin account → **Admin → Areas & Mandals**

**For Bal Mandal:**
- ☑ Study
- ☑ Skill  
- ☑ Standard (LKG/UKG/1st-8th)
- ☑ Hobby
- ☑ Sampark Karyakarta

**For Yuvak Mandal:**
- ☑ Study
- ☑ Profession
- ☑ Skill
- ☑ Hobby
- ☑ Sampark Karyakarta

**Quick Method:** Click "Ask everything" button for each mandal.

### Step 3: Verify Volunteer Program Field
Go to **Admin → Volunteers** and create/edit a volunteer. Ensure the "Program" dropdown appears with options: Yuvak / Bal Mandal.

## Testing Scenarios

### 1. Contact Creation - Bal Mandal with Auto-Assignment
- Go to Contacts → Add contact
- Select "Bal Mandal" from Mandal dropdown
- **Verify these fields appear:**
  - Standard (dropdown: LKG, UKG, 1st-8th)
  - Hobby (multi-select dropdown with "Other" option)
  - Study (text input with autocomplete)
  - Skill (text input with autocomplete)
  - Sampark Karyakarta name/number
- Select "5th" standard → Verify mandal stays "Bal Mandal"
- Select "3rd" standard → Verify mandal auto-changes to "Sishu Mandal"
- Select "LKG" standard → Verify mandal auto-changes to "Sishu Mandal"
- Select "UKG" standard → Verify mandal auto-changes to "Sishu Mandal"

### 2. Hobby Field - Multi-Select with Other
- In contact form, open Hobby dropdown
- Hold Ctrl (Windows) or Cmd (Mac) and select multiple hobbies (e.g., Sports, Music, Dance)
- Verify selections are highlighted
- Select "Other" in the list
- Verify a text input appears below dropdown labeled "Specify other hobby"
- Type custom hobby (e.g., "Gardening")
- Save contact
- Reopen contact → Verify selected hobbies and custom hobby text are preserved

### 2. Bal Mandal Dashboard
- Navigate to **Bal Mandal** from sidebar (only visible to Nirdeshak, Sanchalak, Nirikshak, SK, Admin)
- **Verify 10 metrics display:**
  - Total Contacts (Bal + Sishu split)
  - Unassigned Standard count
  - SK Coverage percentage
  - Promotion Ready (8th standard count)
  - Avg Attendance
  - Mobile Coverage
  - Notes Activity
  - Upcoming Events
  - Standard Breakdown (UKG-8th grid)
- Test area filter dropdown
- Test VCF Export button (prefix/suffix options)
- Test Batch Generator (preview → generate)

### 3. Standard Promotion Workflow
- Navigate to **Bal Mandal → Standard Promotion** (only Nirdeshak + Admin)
- **Verify preview shows:**
  - Students grouped by current standard
  - Next standard shown (1st→2nd, 2nd→3rd, etc.)
  - 8th standard marked for "Transfer to Yuvak Mandal"
- Click "Preview Transfer Report" → Downloads CSV
- **DO NOT execute promotion in production without backup**
- In test environment: Execute → Verify students promoted, 8th transferred to Yuvak

### 4. Notes Panel
- Open any Bal Mandal contact detail page
- **Verify Notes panel appears below attendance**
- Add a note → Verify timestamp prepended with volunteer name
- Refresh page → Verify note persists
- Add another note → Verify history preserved (newest first)

### 5. Observer Attendance
- Go to Events → Select a Bal Mandal event
- **Verify Observer panel appears** (below regular attendance)
- Shows Nirikshak and Sant volunteers
- Click observer → Mark present
- Verify checkmark appears and count updates

### 6. SK Auto-Assignment
- Go to Bal Mandal Dashboard → Generate Batches
- Select area with multiple SK volunteers
- Generate batches
- **Verify:** Batches distributed evenly among SKs (round-robin by contact count)

### 7. Search & Filter
- Go to Contacts → Search bar
- Type a student name → Verify appears
- Filter by "Bal Mandal" → Verify only Bal/Sishu shown
- Filter by Standard "3rd" → Verify only 3rd standard shown

### 8. Individual Detail Page
- Open any Bal Mandal contact
- **Verify fields display:**
  - Standard badge near name
  - Hobby list in details section
  - Study field
  - Skill field
  - SK name & number
  - Attendance history panel
  - Notes panel (editable)

## Known Behaviors (Not Bugs)

1. **Mobile is optional** for Bal Mandal contacts (children may not have phones)
2. **Duplicates allowed** across Bal Mandal (siblings with same name)
3. **Notes are plain text** with manual timestamps (not a subcollection)
4. **Observer attendance** stored in subcollection: `events/{id}/observerAttendance/{volunteerId}`
5. **Program field** on volunteers distinguishes Bal Mandal vs Yuvak roles
6. **Promotion workflow** is destructive (creates new commit, not reversible via UI)

## Performance Notes

Phase 30 queries are optimized to stay within free tier:
- Dashboard loads 2 collections (individuals + events) with area filter
- Batch generator chunks writes at 450 ops/batch
- SK assignment caches volunteer list, counts contacts per SK
- Observer attendance uses subcollection (doesn't pollute main attendance)

## Build Status

✅ All Phase 27, 28, 29, 30 code builds successfully
✅ No TypeScript errors
✅ Tailwind purge verified (all color classes literal)
✅ dist/ restored after build
