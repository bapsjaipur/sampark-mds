# Field Configuration Checklist

## Issue
Study and Skill dropdowns not appearing when adding contacts under Bal Mandal.

## Root Cause
The mandal documents in Firestore need to have these fields enabled in their `fields` configuration map. The form code is correct - it reads the field visibility from each mandal's settings.

## Solution

### Part 1: Create Sishu Mandal (One-Time)
Sishu Mandal doesn't exist yet. Run this script to create it:
```bash
node scripts/create-sishu-mandal.js
```

This creates "Sishu Mandal" in Firestore with all fields enabled.

### Part 2: Enable Fields via Admin UI
1. Log in to your app with an admin account
2. Navigate to **Admin → Areas & Mandals** (usually at `/admin/areas-mandals`)
3. Scroll to the **Mandals** section
4. For each mandal, click the checkboxes to enable fields:

### Bal Mandal & Sishu Mandal
Enable these checkboxes:
- ☑ Study
- ☑ Skill
- ☑ Standard (LKG/UKG/1st-8th, for children)
- ☑ Hobby (multi-select dropdown with Other option)
- ☑ Sampark Karyakarta (name & number)

### Yuvak Mandal, Sanyukt Mandal, Haribhakt 1, Haribhakt 2
Enable these checkboxes:
- ☑ Study
- ☑ Profession
- ☑ Skill
- ☑ Hobby (multi-select dropdown with Other option)
- ☑ Sampark Karyakarta (name & number)

### Mahila Mandal, Yuvati Mandal, Balika Mandal
Enable these checkboxes (minimal fields):
- ☑ Study
- ☑ Skill

Or click "Ask everything" button to enable all fields at once.

## Quick Fix Button
Each mandal row has an "Ask everything" button that enables all fields instantly.

## Verification
After creating Sishu Mandal and enabling fields:
1. Go to Contacts page
2. Click "Add contact"
3. Select "Bal Mandal" from dropdown
4. You should now see: Standard dropdown, Hobby multi-select dropdown, Study input, Skill input
5. Select "3rd" from Standard → Verify mandal auto-changes to "Sishu Mandal"
6. Select "5th" from Standard → Verify mandal auto-changes to "Bal Mandal"
7. In Hobby dropdown, hold Ctrl/Cmd and select multiple hobbies
8. Select "Other" in Hobby → Verify text input appears for custom hobby

## Note
Field visibility is per-mandal, not global. This is by design - different mandals collect different information (e.g., Mahila Mandal might not need Profession field).
