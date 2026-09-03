# Screenshot Guide for Bal Mandal Manual

This document lists all the screenshots needed to complete the PDF manual with illustrations.

---

## Section 3: User Roles & Permissions

**Screenshot 3.1: Role Badge Examples**
- Capture: Admin panel showing different role badges
- Location: Admin → Volunteers list
- Show: Admin, Nirdeshak, Sanchalak, Nirikshak, SK, Sant badges with different colors

---

## Section 4: Getting Started

**Screenshot 4.1: Enable Fields Interface**
- Capture: Admin → Areas & Mandals page, Mandals section
- Location: `/admin/areas-mandals`
- Highlight: Checkboxes for Study, Skill, Standard, Hobby fields
- Highlight: "Ask everything" button

**Screenshot 4.2: Create Volunteer Form**
- Capture: Admin → Volunteers → Add Volunteer modal
- Location: `/admin/volunteers`
- Highlight: Program dropdown showing "Bal Mandal" option
- Highlight: Role dropdown
- Highlight: Assigned Areas multi-select

**Screenshot 4.3: Create Area Interface**
- Capture: Admin → Areas & Mandals → Areas section
- Location: `/admin/areas-mandals`
- Highlight: "Add Area" button
- Show: Area name and code fields

---

## Section 5: Managing Contacts

**Screenshot 5.1: Add Contact Form - Full View**
- Capture: Contacts → Add Contact modal
- Location: `/contacts`
- Highlight: Mandal dropdown showing "Bal Mandal" and "Sishu Mandal"
- Highlight: Standard dropdown with LKG-8th options
- Highlight: Hint text "LKG/UKG/1st-4th auto-assigns Sishu Mandal, 5th-8th auto-assigns Bal Mandal"

**Screenshot 5.2: Hobby Multi-Select Dropdown**
- Capture: Contact form with Hobby dropdown expanded
- Highlight: Multiple selections (Sports, Music, Dance highlighted)
- Highlight: "Other" option at bottom
- Show: Ctrl/Cmd instruction text

**Screenshot 5.3: Hobby Other Text Field**
- Capture: Contact form after selecting "Other" in Hobby
- Highlight: Text input field labeled "Specify other hobby"
- Show: Example text entered (e.g., "Chess")

**Screenshot 5.4: Standard Auto-Assignment Demo**
- Capture: Two side-by-side screenshots
- Left: Standard "3rd" selected → Mandal shows "Sishu Mandal"
- Right: Standard "5th" selected → Mandal shows "Bal Mandal"

**Screenshot 5.5: Sampark Karyakarta Autocomplete**
- Capture: Contact form with SK name field
- Highlight: Autocomplete dropdown showing volunteer names
- Highlight: Mobile number auto-filling when volunteer selected

**Screenshot 5.6: Notes Panel**
- Capture: Individual Detail Page → Notes section
- Location: Click any Bal Mandal contact
- Highlight: Notes textarea
- Highlight: "Add Note" button
- Show: Existing notes with timestamps and volunteer names

**Screenshot 5.7: Search and Filter**
- Capture: Contacts page header
- Highlight: Search box
- Highlight: Mandal filter dropdown
- Highlight: Standard filter dropdown
- Highlight: Area filter dropdown

---

## Section 6: Bal Mandal Dashboard

**Screenshot 6.1: Dashboard Overview (Full Page)**
- Capture: Complete Bal Mandal Dashboard
- Location: `/bal-mandal`
- Show: All 10 metric cards in grid layout
- Highlight: Area filter dropdown at top-right

**Screenshot 6.2: Total Contacts Metric**
- Capture: Close-up of Total Contacts card
- Show: "156 total (92 Bal / 64 Sishu)" example

**Screenshot 6.3: Standard Breakdown Grid**
- Capture: Standard Breakdown metric card
- Show: Grid with counts per standard (LKG-8th)
- Highlight: Different colors for different standards

**Screenshot 6.4: SK Coverage Metric**
- Capture: SK Coverage card
- Show: Percentage with progress ring/bar
- Show: "85% (133/156 assigned)" example

**Screenshot 6.5: Promotion Ready Metric**
- Capture: Promotion Ready card
- Show: Count of 8th standard students
- Highlight: Orange/warning color if count > 0

**Screenshot 6.6: Upcoming Events Section**
- Capture: Upcoming Events metric card
- Show: List of 3 upcoming events with dates

**Screenshot 6.7: Export Buttons**
- Capture: Dashboard top section
- Highlight: "Export VCF" button
- Highlight: "Generate Batches" button

---

## Section 7: Events & Attendance

**Screenshot 7.1: Create Event Form**
- Capture: Events → Create Event modal
- Location: `/events`
- Highlight: Event Type dropdown
- Highlight: Mandal dropdown showing "Bal Mandal"
- Highlight: Area dropdown
- Highlight: Date and Time fields

**Screenshot 7.2: Event Detail Page**
- Capture: Full event detail view
- Show: Event info at top
- Show: Regular attendance panel
- Show: Observer attendance panel below

**Screenshot 7.3: Regular Attendance Panel**
- Capture: Attendance panel with children list
- Highlight: Search box
- Highlight: Individual contact cards
- Highlight: Checkmarks on marked contacts
- Show: Attendance count (e.g., "45/60 present")

**Screenshot 7.4: Observer Attendance Panel**
- Capture: Observer Attendance section
- Highlight: Nirikshak volunteers list
- Highlight: Sant volunteers list
- Highlight: Checkmarks on marked observers
- Show: Observer count

**Screenshot 7.5: Attendance History**
- Capture: Individual Detail Page → Attendance History panel
- Show: List of events attended
- Show: Attendance percentage
- Highlight: Event names and dates

---

## Section 8: Batch Management

**Screenshot 8.1: Generate Batches Modal - Step 1**
- Capture: Bal Mandal Dashboard → Generate Batches modal
- Highlight: Area dropdown
- Highlight: "Preview" button

**Screenshot 8.2: Batch Preview**
- Capture: Generate Batches modal after clicking Preview
- Show: Preview statistics:
  - Total contacts
  - Number of batches
  - SK distribution table
  - Unassigned count
- Highlight: "Generate Batches" button

**Screenshot 8.3: Batch Generation Success**
- Capture: Success message/toast after batch generation
- Show: "Batches generated successfully" message
- Show: Updated dashboard metrics

**Screenshot 8.4: My Contacts Page (SK View)**
- Capture: SK volunteer's "My Contacts" page
- Location: `/my-contacts`
- Show: List of assigned contacts
- Highlight: SK name at top
- Show: Contact count

**Screenshot 8.5: Admin Batches Page**
- Capture: Admin → Batches page
- Location: `/admin/batches`
- Show: List of all batches with filters
- Highlight: Area filter
- Highlight: Assigned SK column
- Highlight: Contact count per batch

---

## Section 9: Standard Promotion Workflow

**Screenshot 9.1: Standard Promotion Page - Preview**
- Capture: Standard Promotion page full view
- Location: `/bal-mandal/promotion`
- Show: Preview table with all standards
- Highlight: Current Standard column
- Highlight: Next Standard column
- Highlight: "Transfer to Yuvak Mandal" for 8th std

**Screenshot 9.2: Preview Transfer Report Button**
- Capture: Standard Promotion page header
- Highlight: "Preview Transfer Report" button
- Highlight: "Execute Standard Promotion" button

**Screenshot 9.3: Confirmation Dialog**
- Capture: Confirmation modal when clicking Execute
- Show: Warning message about backup
- Highlight: "Yes, Execute Promotion" button
- Highlight: "Cancel" button

**Screenshot 9.4: Promotion Success**
- Capture: Success message after promotion
- Show: "Standard promotion completed successfully" toast
- Show: Updated counts in preview table

---

## Section 10: Reports & Exports

**Screenshot 10.1: VCF Export Modal**
- Capture: Bal Mandal Dashboard → Export VCF modal
- Highlight: Prefix dropdown (None/Area/Sub-Area/Mandal)
- Highlight: Suffix dropdown (None/Area/Sub-Area/Mandal)
- Highlight: "Generate VCF" button

**Screenshot 10.2: VCF Export Examples**
- Capture: Preview of VCF export with different options
- Show: 3 examples:
  - Prefix: None, Suffix: Area
  - Prefix: Area, Suffix: Mandal
  - Prefix: Mandal, Suffix: None
- Show: Resulting name format for each

**Screenshot 10.3: Downloaded VCF File**
- Capture: File explorer showing downloaded .vcf file
- Show: Filename: `bal-mandal-contacts.vcf`
- Show: File size and date

**Screenshot 10.4: Phone Import (iPhone)**
- Capture: iPhone Contacts app importing VCF
- Show: "Import X contacts" dialog

**Screenshot 10.5: Phone Import (Android)**
- Capture: Android Contacts app import screen
- Show: VCF file selection
- Show: Import confirmation

---

## Section 11: Admin Configuration

**Screenshot 11.1: Roles Manager**
- Capture: Admin → Roles page
- Location: `/admin/roles`
- Show: List of existing roles
- Highlight: "Add Role" button
- Show: Role cards with permission counts

**Screenshot 11.2: Create Role Form**
- Capture: Add Role modal
- Highlight: Role Name field
- Highlight: Role Key field
- Highlight: Program dropdown
- Highlight: Permissions checkboxes (scrolled to show multiple)

**Screenshot 11.3: Role Permissions Detail**
- Capture: Create Role modal scrolled to permissions section
- Show: All permission checkboxes
- Highlight: Key permissions checked:
  - view_all_contacts
  - edit_contacts
  - manage_events
  - generate_batches

**Screenshot 11.4: Areas & Mandals Manager - Areas Section**
- Capture: Admin → Areas & Mandals → Areas section
- Show: List of areas with codes
- Highlight: "Add Area" button
- Highlight: "Add Sub-Area" button on area row

**Screenshot 11.5: Create Sub-Area**
- Capture: Area row expanded showing sub-areas
- Show: Existing sub-areas listed
- Highlight: "Add Sub-Area" input field
- Show: Hierarchy indication (parent → child)

**Screenshot 11.6: Mandals Section - Field Configuration**
- Capture: Admin → Areas & Mandals → Mandals section
- Show: Mandal rows with field checkboxes
- Highlight: Bal Mandal row with checkboxes visible:
  - Study ☑
  - Skill ☑
  - Standard ☑
  - Hobby ☑
- Highlight: "Ask everything" button

**Screenshot 11.7: Volunteers List**
- Capture: Admin → Volunteers page
- Show: List of volunteers with roles
- Highlight: Search box
- Highlight: "Add Volunteer" button
- Show: Active/Inactive status indicators

**Screenshot 11.8: Edit Volunteer Form**
- Capture: Edit Volunteer modal
- Show: All fields filled with example data
- Highlight: Program: "Bal Mandal"
- Highlight: Assigned Areas: Multiple selected
- Highlight: Active checkbox

---

## Section 12: Troubleshooting

**Screenshot 12.1: Missing Fields Issue**
- Capture: Contact form showing missing Study/Skill fields
- Show: Only basic fields visible
- Highlight: Mandal selected but fields missing

**Screenshot 12.2: Fields Enabled Correctly**
- Capture: Contact form with ALL fields visible
- Show: Study, Skill, Standard, Hobby all present
- Compare: Side-by-side with Screenshot 12.1

**Screenshot 12.3: Sishu Mandal in Dropdown**
- Capture: Contact form → Mandal dropdown expanded
- Show: Both "Bal Mandal" and "Sishu Mandal" options
- Highlight: "Sishu Mandal" option

**Screenshot 12.4: SK Empty My Contacts**
- Capture: SK's My Contacts page showing empty state
- Show: "No contacts assigned" message
- Show: Empty list

**Screenshot 12.5: Bal Mandal Link in Sidebar**
- Capture: Sidebar navigation
- Highlight: "Bal Mandal" link with GraduationCap icon
- Show: Position in menu (after Events, before Padhramani)

**Screenshot 12.6: Observer Panel Missing**
- Capture: Event detail page without observer panel
- Show: Only regular attendance panel visible
- Highlight: Missing section where observer panel should be

**Screenshot 12.7: Observer Panel Present**
- Capture: Event detail page with observer panel
- Show: Regular attendance + Observer attendance panels
- Compare: With Screenshot 12.6

---

## Navigation & UI Screenshots

**Screenshot NAV.1: Desktop Sidebar Navigation**
- Capture: Full sidebar with all menu items
- Show: Logo at top
- Show: Main navigation items
- Show: "Admin" section separator
- Show: Admin menu items
- Highlight: "Bal Mandal" link

**Screenshot NAV.2: Mobile Bottom Bar**
- Capture: Mobile view showing bottom navigation
- Show: 4 main tabs + Menu button
- Highlight: Bottom bar layout

**Screenshot NAV.3: User Profile Menu**
- Capture: Top-right user menu dropdown
- Show: User name and role badge
- Show: Profile, Settings, Logout options

**Screenshot NAV.4: Breadcrumb Navigation**
- Capture: Page with breadcrumb trail
- Example: Home / Admin / Volunteers / Edit
- Show: Clickable breadcrumb links

---

## Data Display Screenshots

**Screenshot DATA.1: Contact Card in List**
- Capture: Single contact card from contacts list
- Show: Photo thumbnail
- Show: Name and mobile
- Show: Area and mandal badges
- Show: Standard badge
- Highlight: SK name if assigned

**Screenshot DATA.2: Individual Detail Page - Header**
- Capture: Top section of individual detail page
- Show: Large photo
- Show: Name, mobile, area
- Show: All badges (mandal, standard, area)
- Show: Edit/Delete buttons

**Screenshot DATA.3: Individual Detail Page - Details Section**
- Capture: Middle section showing all fields
- Show: Study, Skill, Hobby values
- Show: SK name and number
- Show: Address
- Show: DOB

**Screenshot DATA.4: Loading States**
- Capture: Dashboard with loading skeletons
- Show: Loading spinners or skeleton cards
- Show: "Loading..." text

**Screenshot DATA.5: Empty States**
- Capture: Page with no data
- Show: Empty state illustration/icon
- Show: "No contacts found" message
- Show: Helpful action button (e.g., "Add Contact")

---

## How to Capture Screenshots

### Preparation
1. Create demo data:
   - 5-10 contacts in Bal Mandal (standards 5th-8th)
   - 5-10 contacts in Sishu Mandal (LKG-4th)
   - 3-4 volunteers (Nirdeshak, Sanchalak, SK, Nirikshak)
   - 2-3 areas with sub-areas
   - 3-4 upcoming events

2. Log in with different roles to capture role-specific views

### Tools
- **Windows:** Snipping Tool (Win + Shift + S)
- **Mac:** Screenshot (Cmd + Shift + 4)
- **Full Page:** Browser extension like "Full Page Screen Capture"

### Settings
- **Browser Zoom:** 100% (not zoomed in/out)
- **Window Size:** 1920x1080 for desktop, 375x812 for mobile
- **Theme:** Use light theme for consistency
- **Annotations:** Use red arrows/boxes to highlight key elements

### File Naming Convention
```
screenshot_[section]_[number]_[description].png

Examples:
screenshot_05_01_add_contact_form.png
screenshot_06_01_dashboard_overview.png
screenshot_09_03_confirmation_dialog.png
```

### Placement in PDF
- Insert screenshot immediately after the instruction it illustrates
- Add caption below each screenshot
- Use consistent sizing (max width: 800px for full-width, 400px for side-by-side)

---

## PDF Conversion Instructions

### Using Markdown to PDF Converter

**Option 1: Pandoc (Recommended)**
```bash
pandoc BAL-MANDAL-COMPLETE-MANUAL.md -o BAL-MANDAL-MANUAL.pdf --toc --toc-depth=2
```

**Option 2: VS Code with Markdown PDF Extension**
1. Install "Markdown PDF" extension
2. Open BAL-MANDAL-COMPLETE-MANUAL.md
3. Right-click → "Markdown PDF: Export (pdf)"

**Option 3: Online Converter**
- Upload .md file to https://www.markdowntopdf.com/
- Download generated PDF

### After Inserting Screenshots

1. Use PDF editor (Adobe Acrobat, PDF Expert, or online tool)
2. Insert screenshots at appropriate locations
3. Add captions and page numbers
4. Create clickable table of contents
5. Add header/footer with document title and page numbers
6. Final review for formatting consistency

---

## Total Screenshots Required: ~70

**Breakdown:**
- Section 3: 1 screenshot
- Section 4: 3 screenshots
- Section 5: 7 screenshots
- Section 6: 7 screenshots
- Section 7: 5 screenshots
- Section 8: 5 screenshots
- Section 9: 4 screenshots
- Section 10: 5 screenshots
- Section 11: 8 screenshots
- Section 12: 7 screenshots
- Navigation: 4 screenshots
- Data Display: 5 screenshots

**Estimated Time:** 3-4 hours to capture and annotate all screenshots

---

**Next Steps:**
1. Set up demo environment with sample data
2. Capture all screenshots following this guide
3. Annotate screenshots with arrows/highlights
4. Convert markdown to PDF
5. Insert screenshots into PDF
6. Final review and distribution

**Good luck! 📸**