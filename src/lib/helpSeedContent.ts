import type { HelpDocBlock } from "@/lib/helpTypes";

/**
 * Initial AI-generated staff documentation & SOP drafts created from direct
 * inspection of the Genesis Pricing Application.
 *
 * IMPORTANT:
 * - Every article here is seeded in DRAFT status (`status: "DRAFT"`) with
 *   `needsReview: true` so nothing is published to staff until an authorized
 *   administrator reviews the wording, optionally adds screenshots, and clicks Publish.
 * - Written strictly for ordinary staff users in clear, practical language
 *   without developer jargon, database explanations, or internal formulas.
 */

export type SeedCategory = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
};

export type SeedArticle = {
  categorySlug: string;
  slug: string;
  title: string;
  summary: string;
  sortOrder: number;
  relatedSlugs: string[];
  contextKeys: string[];
  needsReview: boolean;
  blocks: HelpDocBlock[];
};

let seq = 1;
const bid = () => `seed_${seq++}`;
const h2 = (text: string): HelpDocBlock => ({ id: bid(), type: "heading", level: 2, text });
const p = (text: string): HelpDocBlock => ({ id: bid(), type: "paragraph", text });
const steps = (items: string[]): HelpDocBlock => ({ id: bid(), type: "steps", items });
const bullets = (items: string[]): HelpDocBlock => ({ id: bid(), type: "bullets", items });
const note = (title: string, text: string): HelpDocBlock => ({
  id: bid(),
  type: "callout",
  variant: "note",
  title,
  text,
});
const tip = (title: string, text: string): HelpDocBlock => ({
  id: bid(),
  type: "callout",
  variant: "tip",
  title,
  text,
});
const warn = (title: string, text: string): HelpDocBlock => ({
  id: bid(),
  type: "callout",
  variant: "warning",
  title,
  text,
});
const tbl = (headers: string[], rows: string[][]): HelpDocBlock => ({
  id: bid(),
  type: "table",
  headers,
  rows,
});

export const INITIAL_HELP_CATEGORIES: readonly SeedCategory[] = [
  {
    slug: "getting-started",
    name: "Getting Started",
    description: "Signing in, navigating the workspace, understanding the dashboard, and personalizing your settings.",
    icon: "compass",
    sortOrder: 1,
  },
  {
    slug: "price-update-management",
    name: "Price Update Management",
    description: "Creating, reviewing, managing, and exporting standard and Full Vendor price update worksheets.",
    icon: "clipboard",
    sortOrder: 2,
  },
  {
    slug: "spreadsheet-editor",
    name: "Spreadsheet Editor",
    description: "Editing cells, filtering, sorting, customizing columns, bulk edits, and saving in the Excel-like workspace.",
    icon: "grid",
    sortOrder: 3,
  },
  {
    slug: "legacy-editor",
    name: "Legacy Editor",
    description: "Working with the classic paginated table editor and switching between editors.",
    icon: "table",
    sortOrder: 4,
  },
  {
    slug: "inventory-management",
    name: "Inventory Management",
    description: "Searching All Inventory, importing POS files, tracking Old SKUs, and keeping catalog data accurate.",
    icon: "box",
    sortOrder: 5,
  },
  {
    slug: "calendar-and-reminders",
    name: "Calendar & Reminders",
    description: "Scheduling future price updates, setting automated email reminders, and managing schedules.",
    icon: "calendar",
    sortOrder: 6,
  },
  {
    slug: "pricing-and-store-tools",
    name: "Pricing & Store Tools",
    description: "Pricing Calculator, Vendor Discounts, POS Excel Cleaner, 99 Price Manager, and Ad Hoc Count Sheets.",
    icon: "wrench",
    sortOrder: 7,
  },
  {
    slug: "settings-and-administration",
    name: "Settings & Administration",
    description: "Appearance, notification defaults, diagnostics, and managing this Help Centre.",
    icon: "settings",
    sortOrder: 8,
  },
];

export const INITIAL_HELP_ARTICLES: readonly SeedArticle[] = [
  // =========================================================================
  // A. GETTING STARTED
  // =========================================================================
  {
    categorySlug: "getting-started",
    slug: "welcome-to-genesis-pricing",
    title: "Welcome to the Genesis Pricing Application",
    summary: "An overview of what the Genesis Pricing Application helps your team accomplish each day.",
    sortOrder: 1,
    relatedSlugs: ["signing-in-and-navigation", "understanding-the-dashboard", "creating-a-new-price-update"],
    contextKeys: ["dashboard"],
    needsReview: true,
    blocks: [
      h2("What This Application Does"),
      p("The Genesis Pricing Application is your team's central workspace for reviewing vendor price changes, calculating updated retail prices, preparing POS import files, generating store count sheets, and keeping your product catalog organized."),
      h2("Main Areas of the Application"),
      tbl(
        ["Section", "What You Use It For"],
        [
          ["Dashboard", "See inventory totals, quick workflow shortcuts, and recent price updates at a glance."],
          ["Price Updates", "Open, review, search, or manage all saved vendor price update worksheets."],
          ["Calendar", "View scheduled effective dates, drag to reschedule, and track email reminders."],
          ["New Price Update / Full Vendor Update", "Start a new price sheet from a vendor price list or for an entire vendor catalog."],
          ["All Inventory", "Search, filter, import, and maintain your master product catalog and Active/Inactive status."],
          ["Pricing Calculator & Vendor Discounts", "Test individual or batch retail prices and manage saved vendor/brand discount rules."],
          ["POS Excel Cleaner, 99 Price Manager & Ad Hoc Count Sheets", "Clean POS files, manage .99 pricing lists, and create quick multi-vendor count sheets."],
          ["Data Exports", "Quickly download POS CSVs or Store Count Excel files for existing worksheets."],
        ],
      ),
      tip("Need Quick Help While Working?", "Look for the small Help (?) links in the header of pages like New Price Update, Price Worksheets, All Inventory, Calendar, and Settings to open the relevant guide without losing your place."),
      note("Administrator Review Note", "Consider adding a welcome screenshot of the main Dashboard or updating any store-specific terminology before publishing this article."),
    ],
  },
  {
    categorySlug: "getting-started",
    slug: "signing-in-and-navigation",
    title: "Signing In & Navigating the Application",
    summary: "How to sign in, use the sidebar menu, switch between New UI and Classic UI, and sign out safely.",
    sortOrder: 2,
    relatedSlugs: ["welcome-to-genesis-pricing", "appearance-themes-and-density", "understanding-the-dashboard"],
    contextKeys: [],
    needsReview: true,
    blocks: [
      h2("Signing In"),
      steps([
        "Open the Genesis Pricing Application in your web browser.",
        "Enter your assigned email address and password on the Sign In screen.",
        "Click **Sign In**. You will be taken directly to the main Dashboard.",
      ]),
      h2("Navigating the Sidebar"),
      p("In the default **New UI**, the left sidebar organizes pages into clear groups: **Operations**, **Tools & Pricing**, **Reports & Data**, **Help & Training**, and **Preferences**."),
      bullets([
        "Click the collapse arrow at the top of the sidebar to shrink it to icons and give your tables extra horizontal space.",
        "On smaller screens or tablets, tap the menu button (three lines) in the top-left corner to open the navigation drawer.",
        "Use the top-right header bar to quickly toggle Light/Dark Mode, open the Help Centre, or jump to Settings.",
      ]),
      h2("Switching Between New UI and Classic UI"),
      p("You can switch between the modern **New UI** and the original **Classic UI** at any time using the **Interface Mode** switcher in the sidebar or top bar."),
      note("No Data Is Changed When Switching", "Switching between New UI and Classic UI only changes the visual layout. Your worksheets, inventory, and saved settings remain completely untouched. If you have unsaved edits on a worksheet, the app will warn you before switching."),
      h2("Signing Out"),
      p("Click **Sign out** next to your email address at the bottom of the sidebar whenever you finish working on a shared computer."),
    ],
  },
  {
    categorySlug: "getting-started",
    slug: "understanding-the-dashboard",
    title: "Understanding the Main Dashboard",
    summary: "How to read operational totals, launch common tasks, and customize which widgets appear on your Dashboard.",
    sortOrder: 3,
    relatedSlugs: ["appearance-themes-and-density", "creating-a-new-price-update", "understanding-all-inventory"],
    contextKeys: ["dashboard"],
    needsReview: true,
    blocks: [
      h2("Dashboard Sections"),
      p("When you open the Dashboard in New UI, you see up to four customizable sections:"),
      bullets([
        "**Operational Overview (Key Metrics):** Displays Total Products, Active Products (with active catalog percentage), Inactive Products, configured Vendor Discounts, and total Price Updates.",
        "**Workflow Launchpad:** One-click cards to start a **New Price Update**, create a **Full Vendor Update**, manage **All Inventory**, or open the **Pricing Calculator**.",
        "**Recent Price Updates:** Shows your latest worksheets with vendor, name, current status, last updated time, and a direct **Open** link.",
        "**Inventory Health & Sync Status:** Shows the ratio of active vs. inactive products along with the last time full inventory was imported.",
      ]),
      h2("Customizing Your Dashboard"),
      steps([
        "Click **Customize metrics →** on the Dashboard, or open **Settings → Dashboard & Layout**.",
        "Check or uncheck sections to show or hide them, and use the up/down arrows (**▲** / **▼**) to reorder them.",
        "Choose which individual metric cards you want displayed.",
      ]),
      note("Administrator Review Note", "Add a screenshot of the Dashboard showing the Operational Overview cards and Workflow Launchpad before publishing."),
    ],
  },
  {
    categorySlug: "getting-started",
    slug: "appearance-themes-and-density",
    title: "Appearance, Themes & Display Density",
    summary: "How to switch between Light Mode, Dark Mode, accent colors, table density, and hidden navigation items.",
    sortOrder: 4,
    relatedSlugs: ["choosing-your-default-editor", "settings-and-notifications-overview"],
    contextKeys: ["settings"],
    needsReview: true,
    blocks: [
      h2("Light Mode, Dark Mode & System Theme"),
      p("In New UI, you can choose **Light**, **Dark**, or **System** (follows your computer's operating system setting)."),
      steps([
        "For a quick switch, click the sun/moon icon in the top-right header bar.",
        "For full theme controls, open **Settings → Appearance & Themes** and select **Light**, **Dark**, or **System**.",
      ]),
      h2("Accent Color"),
      p("Under **Settings → Appearance & Themes**, choose from five accent palettes (**Indigo**, **Corporate Blue**, **Emerald**, **Violet**, or **Slate Neutral**) to highlight active navigation items and primary buttons."),
      h2("Understanding Table & Interface Density"),
      p("Table density controls how much breathing room appears around rows and cells across worksheets and inventory tables:"),
      tbl(
        ["Density Setting", "Best Used For"],
        [
          ["Compact", "Seeing the maximum number of product rows on screen during heavy data entry."],
          ["Comfortable (Recommended)", "Balanced spacing for everyday reviewing and editing."],
          ["Spacious", "Larger touch targets and relaxed spacing for easier reading."],
        ],
      ),
      h2("Hiding Optional Navigation Links"),
      p("Under **Settings → Dashboard & Layout → Navigation Items**, you can hide optional sidebar shortcuts (such as POS Excel Cleaner or 99 Price Manager) if you do not use them daily. You can turn them back on at any time, or click **Restore Default Appearance & Layout** to reset."),
    ],
  },
  {
    categorySlug: "getting-started",
    slug: "choosing-your-default-editor",
    title: "Choosing Your Default Price Update Editor",
    summary: "How to choose whether price worksheets open in the Spreadsheet Editor or the Legacy Editor by default.",
    sortOrder: 5,
    relatedSlugs: ["spreadsheet-editor-getting-started", "using-the-legacy-editor", "appearance-themes-and-density"],
    contextKeys: ["settings"],
    needsReview: true,
    blocks: [
      h2("Spreadsheet Editor vs. Legacy Editor"),
      p("Every price update worksheet can be opened in either of two editors — both work on the exact same saved worksheet data:"),
      bullets([
        "**Spreadsheet Editor (Recommended):** An Excel-like continuous scrolling grid built for large worksheets, featuring copy/paste, drag-to-fill, multi-column sorting, per-column filters, customizable columns, frozen panes, full-screen mode, and live auto-saving.",
        "**Legacy Editor:** The original paginated table view (200 products per page) with simple cell editing and fill-down.",
      ]),
      h2("Setting Your Personal Default"),
      steps([
        "Open **Settings** from the sidebar and stay on the **Appearance & Themes** tab.",
        "Scroll to **Default Price Update Editor**.",
        "Click either **Spreadsheet Editor** or **Legacy Editor**.",
      ]),
      tip("Temporary Switching Anytime", "Your choice is saved to your user account across devices. While working inside any worksheet, you can still click **Legacy** or **Spreadsheet** in the top-right header to switch temporarily without changing your saved default."),
    ],
  },

  // =========================================================================
  // B. PRICE UPDATE MANAGEMENT
  // =========================================================================
  {
    categorySlug: "price-update-management",
    slug: "understanding-price-update-worksheets",
    title: "Understanding Price Update Worksheets & Statuses",
    summary: "How the Price Updates list works and what each worksheet status means from Draft through Exported.",
    sortOrder: 1,
    relatedSlugs: ["creating-a-new-price-update", "creating-a-full-vendor-update", "reviewing-and-editing-worksheets"],
    contextKeys: ["sessions"],
    needsReview: true,
    blocks: [
      h2("Viewing Price Update History"),
      p("Open **Price Updates** in the sidebar to see every saved price update worksheet. You can search by vendor, worksheet name, or date, and filter by status tabs (**All Statuses**, **Draft**, **Ready**, **Being Reviewed**, **Reviewed**, **Scheduled**, **Exported**, or **Full Vendor Only**)."),
      h2("What Each Worksheet Status Means"),
      tbl(
        ["Status", "Meaning"],
        [
          ["Draft", "Worksheet has been created but does not yet have imported products ready for review."],
          ["Ready", "Vendor prices have been imported and matched; ready for a team member to review."],
          ["Being Reviewed", "Someone is actively checking costs, discounts, unmatched SKUs, and retail prices."],
          ["Reviewed", "Pricing review is complete and approved for scheduling or POS export."],
          ["Scheduled", "Assigned a future effective date on the Price Update Calendar (with an optional email reminder)."],
          ["Exported", "A POS export has been generated for this worksheet."],
        ],
      ),
      h2("Changing a Worksheet's Status"),
      p("Inside an open worksheet, use the **Status** dropdown in the top header to update between **Ready**, **Being Reviewed**, and **Reviewed**. Exporting for POS automatically marks the worksheet as **Exported**, and scheduling it via the **Schedule** button sets it to **Scheduled**."),
      warn("Deleting a Worksheet", "Administrators can delete an entire price update from the Price Update History list. Deleting a worksheet removes only that worksheet and its rows — your master All Inventory catalog and Vendor Discounts are never affected."),
    ],
  },
  {
    categorySlug: "price-update-management",
    slug: "creating-a-new-price-update",
    title: "Creating a New Price Update",
    summary: "Step-by-step instructions to create a standard price update worksheet by uploading a vendor spreadsheet or pasting SKU and price data.",
    sortOrder: 2,
    relatedSlugs: ["creating-a-full-vendor-update", "reviewing-and-editing-worksheets", "understanding-price-update-worksheets"],
    contextKeys: ["new-price-update"],
    needsReview: true,
    blocks: [
      h2("When to Use New Price Update"),
      p("Use **New Price Update** when a vendor sends you a list of specific products whose prices are changing (either as an Excel/CSV file or as copied rows of SKUs and new list prices)."),
      tip("Updating an Entire Vendor Catalog?", "If you need to include every product you carry for a vendor — even items whose prices are not changing — use **Full Vendor Update** instead."),
      h2("Step-by-Step Instructions"),
      steps([
        "Click **New Price Update** in the left sidebar (or from the Dashboard Launchpad).",
        "In **1. Select Vendor**, type or pick the vendor name from the dropdown list. The worksheet name is generated automatically from the vendor and today's date.",
        "In **2. Vendor Price Data**, choose either **Upload Spreadsheet** or **Paste Text**:",
        "**Upload Spreadsheet:** Click to choose a vendor `.xlsx`, `.xls`, or `.csv` file containing SKU/UPC and new list price columns.",
        "**Paste Text:** Switch to **Paste Text** and paste lines with one SKU and price per line (tab-separated from Excel or comma-separated, e.g., `0 58854 04522 7   19.99`).",
        "Click **Process Price Update & Open Worksheet →**.",
      ]),
      h2("What Happens Next"),
      p("The application cleans and matches each vendor SKU against your **All Inventory** catalog, applies any saved **Vendor Discount** or **Brand Discount**, calculates your new list price, retail price, and Nearest 9 price, and opens the worksheet automatically."),
      note("Administrator Review Note", "Add a screenshot of the New Price Update page showing Vendor selection and the Upload Spreadsheet / Paste Text toggle."),
    ],
  },
  {
    categorySlug: "price-update-management",
    slug: "creating-a-full-vendor-update",
    title: "Creating a Full Vendor Price Update",
    summary: "How to build a complete catalog worksheet for one vendor so both changed and unchanged products can be reviewed and counted.",
    sortOrder: 3,
    relatedSlugs: ["creating-a-new-price-update", "exporting-for-pos", "exporting-store-count-sheets"],
    contextKeys: ["full-vendor-update"],
    needsReview: true,
    blocks: [
      h2("When to Use Full Vendor Price Update"),
      p("Use **Full Vendor Update** when you want a worksheet pre-loaded with your existing inventory products for a vendor, and then apply new vendor prices on top. This is especially useful when stores need to count all items for that vendor (including unchanged items) using the Digital Store Count Excel export."),
      h2("3-Step Workflow"),
      steps([
        "**Step 1 — Select Vendor:** Open **Full Vendor Update** from the sidebar, choose the vendor, and click **Preview Vendor Products →**.",
        "**Step 2 — Preview & Select Products:** Review the vendor's active and inactive products. All products are selected by default. You can search, filter by **All / Active / Inactive**, and uncheck any items you do not want to include. Click **Proceed to Paste Prices →**.",
        "**Step 3 — Paste Vendor Prices:** Paste the vendor's SKU and new list price list, then create the worksheet. Matched items receive their new prices while unchanged products stay in the worksheet for review and store counting.",
      ]),
      note("Full Vendor Badges & Export Options", "Worksheets created through this flow display a **Full Vendor** badge and unlock additional options when clicking **Export for POS** and **Digital Store Count Excel**."),
    ],
  },
  {
    categorySlug: "price-update-management",
    slug: "reviewing-and-editing-worksheets",
    title: "Reviewing & Editing Price Update Worksheets",
    summary: "How to add missing products, set lower prices to Old Retail, attach notes, delete rows, and use Undo/Redo.",
    sortOrder: 4,
    relatedSlugs: ["spreadsheet-editor-getting-started", "exporting-raw-worksheets", "exporting-for-pos"],
    contextKeys: ["worksheet"],
    needsReview: true,
    blocks: [
      h2("Adding Products to an Existing Worksheet"),
      bullets([
        "**+ Add Row:** Adds a single product by entering its Raw Vendor SKU or Cleaned SKU along with optional price, discount, divisor, or notes.",
        "**Bulk Add Rows:** Paste multiple SKUs and prices at once. On Full Vendor worksheets, Bulk Add updates existing matching rows and adds any new rows automatically.",
      ]),
      h2("Set Lower Prices to Old Retail"),
      p("If a vendor's cost dropped or rounding produced a new Nearest 9 price lower than your current **Old Retail Price**, you can hold the price at the old retail value:"),
      steps([
        "Check the boxes next to the rows you want to evaluate.",
        "Click **Set Lower Prices** (the button shows how many checked rows qualify).",
        "Review the confirmation dialog and click **Apply**.",
      ]),
      p("Only qualifying rows (where the automatic Nearest 9 is lower than Old Retail Price and no custom price is already set) are updated. Each updated row is tagged with the **Custom** flag and can be reversed with **Undo**."),
      h2("Product Notes & Price Sheet Notes"),
      bullets([
        "**Row Notes:** Click any cell in the **Notes** column to attach product-specific remarks (supports bold, lists, links, and tables).",
        "**Price Sheet Notes:** Scroll to the bottom of the worksheet and expand **Price Sheet Notes** to record general remarks or vendor comparisons for the entire price update.",
      ]),
      h2("Undo, Redo & Deleting Rows"),
      p("Use the **Undo** (`Ctrl/Cmd + Z`) and **Redo** (`Ctrl/Cmd + Shift + Z` or `Ctrl + Y`) buttons to reverse cell edits, fills, row additions, or deletions. To remove rows permanently, check their boxes and click **Delete Selection**, then confirm."),
    ],
  },
  {
    categorySlug: "price-update-management",
    slug: "exporting-raw-worksheets",
    title: "Exporting Raw Worksheets (Editable Excel)",
    summary: "How to download a complete, editable Excel (.xlsx) copy of your active price update worksheet without changing worksheet data.",
    sortOrder: 5,
    relatedSlugs: ["exporting-for-pos", "exporting-store-count-sheets", "reviewing-and-editing-worksheets"],
    contextKeys: ["worksheet", "raw-export"],
    needsReview: true,
    blocks: [
      h2("What Export Raw Worksheet Does"),
      p("**Export Raw Worksheet** downloads a standalone, fully editable Microsoft Excel (`.xlsx`) file containing your worksheet as it appears while you are working on it."),
      bullets([
        "Includes all columns currently displayed in your active worksheet in the exact order and with the exact column headings shown.",
        "Includes **all rows** in the worksheet (even if you currently have a search term or filter active on screen).",
        "Reflects your latest saved and edited values.",
        "Preserves leading zeros on SKUs/UPCs, applies clean number formatting for prices, auto-fits column widths, and freezes the top header row with Excel filters enabled.",
        "Every cell is unlocked so you can freely sort, filter, add notes, or share the file in Microsoft Excel.",
      ]),
      h2("How to Export a Raw Worksheet"),
      steps([
        "Open the Price Update worksheet you want to download.",
        "Wait for any active edits to finish saving (if you are in the Spreadsheet Editor and have pending edits, clicking Export Raw Worksheet automatically saves them first).",
        "In the top-right export bar, click **Export Raw Worksheet**.",
        "Your browser downloads a file named `[Worksheet Name] - Raw Worksheet - YYYY-MM-DD.xlsx`.",
      ]),
      note("Read-Only Operation", "Exporting a raw worksheet is strictly read-only. Unlike **Export for POS**, it does **not** change the worksheet's status to Exported, does **not** modify any product prices, and does **not** prompt to update inventory."),
      warn("Not for POS Register Uploads", "Use **Export for POS** when uploading prices into your POS system, and **Store Count Excel / PDF** for store counting. **Export Raw Worksheet** is intended for offline review, sharing, or working directly in Excel."),
    ],
  },
  {
    categorySlug: "price-update-management",
    slug: "exporting-for-pos",
    title: "Exporting for POS & Updating Inventory Prices",
    summary: "How to download the POS CSV file, choose Full Vendor export options, and optionally sync updated prices back to All Inventory.",
    sortOrder: 6,
    relatedSlugs: ["exporting-raw-worksheets", "exporting-store-count-sheets", "understanding-all-inventory"],
    contextKeys: ["worksheet", "exports"],
    needsReview: true,
    blocks: [
      h2("Standard POS CSV Export"),
      p("Click **Export for POS** in the top-right export bar of any worksheet to download a CSV file formatted for POS import (containing **Cleaned SKU**, **Our New List Price**, and **Nearest 9**)."),
      h2("Full Vendor POS Export Options"),
      p("On a **Full Vendor** worksheet, clicking **Export for POS** opens a dialog letting you choose which products to include:"),
      bullets([
        "**Export All Products:** Exports every product in the worksheet, preserving empty prices where unchanged.",
        "**Export All Products — Populate All Prices:** Exports every product and fills in the effective retail price for every row.",
        "**Export Products with Price Changes Only:** Includes only items whose price actually changed.",
        "**Export Selected Products:** Includes only the rows you checked with checkboxes.",
      ]),
      h2("Updating App Inventory Prices After Export"),
      steps([
        "Immediately after downloading the POS CSV, a prompt asks: **Update App Inventory Prices?**",
        "Click **Update Inventory Prices** if you want the app's **All Inventory** prices and list costs updated to match your exported sheet (click **Not Now** to leave inventory unchanged).",
        "Review the summary report showing how many products were updated and whether any rows were skipped (for example, unmatched SKUs or blank prices).",
      ]),
      note("Status Automatically Updates", "Generating a POS export automatically sets the worksheet's status to **Exported** and marks any linked calendar schedule as completed."),
    ],
  },
  {
    categorySlug: "price-update-management",
    slug: "exporting-store-count-sheets",
    title: "Exporting Store Count Sheets & Using Data Exports",
    summary: "How to generate Store Count Excel workbooks, Digital Store Count Excel sheets, and printable Store Count PDFs.",
    sortOrder: 7,
    relatedSlugs: ["exporting-for-pos", "exporting-raw-worksheets", "using-adhoc-count-sheets"],
    contextKeys: ["worksheet", "exports"],
    needsReview: true,
    blocks: [
      h2("Available Store Count Formats"),
      tbl(
        ["Export Button", "Where Available", "What It Produces"],
        [
          ["Store Count Excel", "Standard worksheets & Data Exports page", "Excel workbook for store counting (inactive products excluded automatically)."],
          ["Digital Store Count Excel", "Full Vendor worksheets", "Protected Excel counting sheet with frozen headers and editable count columns (QOH, Layaway, Prepaid, Expiry, Notes). Lets you choose Changed Prices Only vs. All Prices, and All / Active / Inactive products."],
          ["Generate Store Count PDF", "All worksheets", "Printable PDF store count list matching your current table sort order (inactive products excluded automatically)."],
        ],
      ),
      h2("Using the Data Exports Page"),
      p("You can also open **Data Exports** from the left sidebar to search across all saved price updates and download their **POS CSV** or **Store Count Excel** files from one central list."),
      tip("Sort Order Is Preserved", "Before clicking **Store Count Excel**, **Digital Store Count Excel**, or **Generate Store Count PDF**, sort the worksheet the way your store team prefers to walk the shelves (for example, by Brand or Product Name). The export keeps your chosen order."),
    ],
  },

  // =========================================================================
  // C. SPREADSHEET EDITOR
  // =========================================================================
  {
    categorySlug: "spreadsheet-editor",
    slug: "spreadsheet-editor-getting-started",
    title: "Getting Started with the Spreadsheet Editor",
    summary: "Understand the Spreadsheet Editor layout, editable vs. calculated columns, auto-save status, and full-screen workspace.",
    sortOrder: 1,
    relatedSlugs: ["spreadsheet-editing-and-fill", "spreadsheet-search-filter-sort", "spreadsheet-columns-freeze-bulk"],
    contextKeys: ["spreadsheet-editor", "worksheet"],
    needsReview: true,
    blocks: [
      h2("Overview of the Spreadsheet Editor"),
      p("The Spreadsheet Editor provides an Excel-like workspace designed to scroll smoothly through thousands of rows without page breaks."),
      h2("Editable Columns vs. Calculated & Lookup Columns"),
      p("Editable columns are lightly shaded in green with a small pencil icon in the header. Calculated and inventory lookup columns update automatically whenever you edit an input cell."),
      tbl(
        ["Column", "Editable?", "What It Shows"],
        [
          ["Raw Vendor SKU/Code", "Yes", "The original SKU or UPC received from the vendor."],
          ["Cleaned SKU", "Yes", "Normalized SKU matched to inventory (editing manually adds the Manual SKU flag)."],
          ["Product Number, Product Name, Brand, Vendor", "No (Lookup)", "Pulled automatically from your All Inventory catalog when matched."],
          ["Discount (%)", "Yes", "Vendor or brand discount percentage. Clearing it restores the saved default discount."],
          ["Current List Price", "No (Lookup)", "Current list cost stored in All Inventory."],
          ["Vendor List Price (New)", "Yes", "Incoming new list price from the vendor."],
          ["Our New List Price", "No (Calculated)", "Automatically calculated after applying the discount."],
          ["Margin/Divisor", "Yes", "Margin divisor applied to calculate retail pricing."],
          ["Our New Retail Price", "No (Calculated)", "Automatically calculated target retail price."],
          ["Old Retail Price", "No (Lookup)", "Current retail price from All Inventory."],
          ["Nearest 9", "Yes (Override)", "Final rounded retail price. Typing a custom value sets a Custom override; clearing it restores the automatic value."],
          ["Notes", "Yes", "Click to open the formatted notes editor for that product."],
          ["Flags", "No (Auto)", "Status badges such as Changed, Custom, Not Found, Inactive, or Manual SKU."],
        ],
      ),
      h2("Live Saving & Full-Screen Mode"),
      bullets([
        "**Save Status Pill (Top Right):** Shows **Saved** (green), **Saving / N unsaved** (amber — click to save immediately), or **Failed · Retry** (red — click to retry if your internet briefly dropped).",
        "**Full Screen:** Click **Full Screen** in the spreadsheet toolbar to hide the app sidebar and header for maximum table area. Press **Esc** or click **Exit Full Screen** to return.",
      ]),
      note("Administrator Review Note", "Add an annotated screenshot of the Spreadsheet Editor highlighting the editable green columns, toolbar, and Save status indicator."),
    ],
  },
  {
    categorySlug: "spreadsheet-editor",
    slug: "spreadsheet-editing-and-fill",
    title: "Editing Cells, Copy/Paste & Fill Handle",
    summary: "How to edit single cells, copy and paste ranges from Excel, drag the fill handle, and use keyboard navigation.",
    sortOrder: 2,
    relatedSlugs: ["spreadsheet-editor-getting-started", "spreadsheet-columns-freeze-bulk", "spreadsheet-flags-and-errors"],
    contextKeys: ["spreadsheet-editor"],
    needsReview: true,
    blocks: [
      h2("Editing a Cell"),
      steps([
        "Click any editable cell to select it, then double-click, press **Enter** or **F2**, or simply start typing.",
        "Press **Enter** to save and move down, **Tab** to save and move right, or **Esc** to cancel your edit.",
        "Use arrow keys to move cell-to-cell across the sheet.",
      ]),
      h2("Selecting Ranges & Copying/Pasting"),
      bullets([
        "Click and drag across cells (or hold **Shift** and click another cell) to select a rectangular range.",
        "When multiple numeric cells are selected, the status bar automatically shows **Cells**, **Sum**, and **Avg**.",
        "Press **Ctrl/Cmd + C** to copy selected cells and **Ctrl/Cmd + V** to paste from within the sheet or directly from Microsoft Excel / Google Sheets. Read-only columns are safely skipped during paste.",
      ]),
      h2("Using the Fill Handle"),
      p("Just like in Excel, select one or more editable cells, grab the small square handle at the bottom-right corner of the selection border, and drag down (or across) to copy the value into adjacent rows."),
      h2("Right-Click Context Menu"),
      p("Right-click any cell to access quick actions such as editing Notes, restoring a product's default vendor/brand discount, or clearing a custom Nearest 9 override."),
    ],
  },
  {
    categorySlug: "spreadsheet-editor",
    slug: "spreadsheet-search-filter-sort",
    title: "Searching, Filtering & Multi-Column Sorting",
    summary: "How to find products quickly, combine Quick Data Filters and per-column filters, and apply multi-level sorting.",
    sortOrder: 3,
    relatedSlugs: ["spreadsheet-editor-getting-started", "spreadsheet-columns-freeze-bulk", "exporting-raw-worksheets"],
    contextKeys: ["spreadsheet-editor"],
    needsReview: true,
    blocks: [
      h2("Global Search & Status Filter"),
      p("Type a SKU, product name, brand, vendor, or note keyword into **Global search** on the left of the spreadsheet toolbar to narrow visible rows instantly. Next to it, use the status dropdown to view **All rows**, **Unmatched**, **Not Found**, **Price Changed**, **Inactive**, **Vendor price missing**, or **Custom**."),
      h2("Quick Data Filters"),
      p("Click **Filters** in the toolbar to combine yes/no filters for:"),
      bullets([
        "Vendor List Price (Present / Missing)",
        "Discount % (Present >0% / Missing 0%)",
        "New Retail Price (Present / Missing)",
        "Custom Nearest 9 (With Custom / Without Custom)",
        "Price Changed (Changed / Unchanged)",
      ]),
      h2("Per-Column Filters & Multi-Column Sorting"),
      steps([
        "Click the dropdown arrow (**▾**) on any column header to filter that column by text (contains, equals, blank, etc.), numbers (greater than, less than, between, etc.), or Flags.",
        "Click **Sort** in the toolbar to build multi-level sorting (for example, sort by **Brand A → Z**, then by **Product Name A → Z**), or hold **Shift** and click column headers directly.",
        "Active sort levels and filters appear as colored pills right below the toolbar. Click **×** on any pill or **Clear filters** to reset.",
      ]),
      tip("Exports Still Include All Rows", "Filtering only changes what is shown on screen so you can focus your review — your worksheet rows are never deleted, and **Export Raw Worksheet** still includes all rows in the worksheet."),
    ],
  },
  {
    categorySlug: "spreadsheet-editor",
    slug: "spreadsheet-columns-freeze-bulk",
    title: "Customizing Columns, Freezing Panes & Bulk Editing",
    summary: "How to reorder, hide, resize, and freeze columns/rows, and apply bulk changes to multiple products at once.",
    sortOrder: 4,
    relatedSlugs: ["spreadsheet-editor-getting-started", "spreadsheet-editing-and-fill", "reviewing-and-editing-worksheets"],
    contextKeys: ["spreadsheet-editor"],
    needsReview: true,
    blocks: [
      h2("Showing, Hiding, Reordering & Resizing Columns"),
      bullets([
        "**Show / Hide Columns:** Click **Columns** in the toolbar and check or uncheck any column. Click **Show all** to restore hidden columns.",
        "**Reorder Columns:** Drag a column header left or right to place columns in your preferred working order.",
        "**Resize & Auto-Fit:** Drag the right edge of any column header to resize it, or click **Columns → Auto-fit widths**. Click **Reset** to restore the default layout.",
        "Your column layout is remembered automatically for your user account.",
      ]),
      h2("Freezing Panes (Rows & Columns)"),
      p("Click **Freeze** in the toolbar to freeze the **Top 1, 2, or 5 rows** or **Freeze checked rows at top** while scrolling vertically. To freeze specific columns on the left, open that column's header menu (**▾**) and choose Freeze. Click **Freeze → Unfreeze all** to clear."),
      h2("Bulk Editing Multiple Rows"),
      steps([
        "Check the rows you want to update (or highlight a range of cells across those rows).",
        "Click **Bulk Edit** in the spreadsheet toolbar.",
        "Choose an action: **Set Discount (%)**, **Set Margin / Divisor**, **Set Vendor List Price (New)**, **Set Custom Nearest 9 Override**, **Clear Custom Nearest 9 Overrides (Restore Auto)**, or **Restore Vendor/Brand Default Discount**.",
        "Enter the value (if required) and apply. All changes are validated, saved in batches, and can be reversed with **Undo**.",
      ]),
    ],
  },
  {
    categorySlug: "spreadsheet-editor",
    slug: "spreadsheet-flags-and-errors",
    title: "Understanding Flags, Common Errors & Switching Editors",
    summary: "What each row flag means, how to fix validation or save errors, and how to switch safely between Spreadsheet and Legacy editors.",
    sortOrder: 5,
    relatedSlugs: ["spreadsheet-editor-getting-started", "using-the-legacy-editor", "choosing-your-default-editor"],
    contextKeys: ["spreadsheet-editor", "worksheet"],
    needsReview: true,
    blocks: [
      h2("What Each Row Flag Means"),
      tbl(
        ["Flag", "Meaning & Recommended Action"],
        [
          ["Not Found", "The Cleaned SKU did not match any product in All Inventory. Verify the SKU, edit Cleaned SKU manually, or import the missing product into All Inventory."],
          ["Inactive", "The matched product is marked Inactive in All Inventory. Inactive items are automatically excluded from standard Store Count exports."],
          ["Manual SKU", "The Cleaned SKU was manually edited instead of auto-cleaned from the Raw Vendor SKU."],
          ["Custom", "A manual Nearest 9 retail price override has been entered for this row."],
          ["Changed", "The final Nearest 9 retail price differs from the product's Old Retail Price."],
          ["No change", "The final Nearest 9 retail price matches the product's Old Retail Price."],
        ],
      ),
      h2("Common Entry & Save Errors"),
      bullets([
        "**Discount must be between 0 and 100:** Enter a plain percentage number such as `10` or `12.5`.",
        "**Margin/Divisor must be greater than 0:** Enter a positive decimal number (leaving it blank restores the default).",
        "**Save Failed · Retry:** If your connection drops temporarily, the save pill turns red. Click **Retry** once your connection returns — your edits stay intact in the browser until saved.",
      ]),
      h2("Switching to the Legacy Editor"),
      p("Click **Legacy** in the top worksheet header (to the left of the Status selector). If any spreadsheet edits are still saving, the application automatically flushes and saves them before switching so nothing is lost."),
    ],
  },

  // =========================================================================
  // D. LEGACY EDITOR
  // =========================================================================
  {
    categorySlug: "legacy-editor",
    slug: "using-the-legacy-editor",
    title: "Using the Legacy Table Editor",
    summary: "How to navigate pages, edit cells, fill values down, filter by flags, export, and switch to the Spreadsheet Editor.",
    sortOrder: 1,
    relatedSlugs: ["choosing-your-default-editor", "spreadsheet-editor-getting-started", "reviewing-and-editing-worksheets"],
    contextKeys: ["legacy-editor"],
    needsReview: true,
    blocks: [
      h2("Navigating the Legacy Editor"),
      p("The Legacy Editor displays 200 products per page with **Prev** and **Next** pagination buttons below the table. Use the search box, **Flags** checklist menu, and status dropdown in the workspace toolbar to narrow rows."),
      h2("Editing Products & Filling Down"),
      steps([
        "Click an editable cell (highlighted in light green), type the new value, and press **Enter** or click outside to save.",
        "To copy an edited value down into consecutive rows, drag the fill handle on the active cell downward and release.",
        "Click a column header's dropdown arrow (**▾**) to sort, **Freeze Column**, or toggle **Wrap Text**. Drag column or row dividers to resize.",
      ]),
      h2("Exporting & Switching Editors"),
      p("All export buttons (**Export for POS**, **Store Count Excel / Digital Store Count Excel**, **Generate Store Count PDF**, and **Export Raw Worksheet**) work identically in both editors. Click **Spreadsheet** in the top header at any time to switch to the Spreadsheet Editor."),
    ],
  },

  // =========================================================================
  // E. INVENTORY MANAGEMENT
  // =========================================================================
  {
    categorySlug: "inventory-management",
    slug: "understanding-all-inventory",
    title: "Understanding All Inventory",
    summary: "How to view your master product catalog, check Last Imported and Last Updated timestamps, and add individual products.",
    sortOrder: 1,
    relatedSlugs: ["searching-filtering-sorting-inventory", "importing-inventory-and-pos-importer", "managing-old-skus-and-deletion"],
    contextKeys: ["inventory"],
    needsReview: true,
    blocks: [
      h2("What All Inventory Stores"),
      p("**All Inventory** is your master catalog of products used to match vendor SKUs during price updates, look up current list costs and retail prices, and identify active vs. inactive products."),
      p("Each row displays the product's **SKU**, **Product Number**, **Description**, **Vendor**, **Brand**, **List Cost**, **Price**, **Size Desc.**, **Status (Active / Inactive)**, and **Old SKU** indicator."),
      h2("Timestamps at the Top of the Page"),
      bullets([
        "**Last Imported:** Shows when a full POS inventory catalog file was last imported.",
        "**Last Updated:** Shows when inventory prices were last synced from an exported price update worksheet.",
      ]),
      h2("Adding a Single Product Manually"),
      steps([
        "Open **All Inventory** from the sidebar.",
        "Click **+ Add Product**.",
        "Enter the product's SKU, Description, Vendor, Brand, List Cost, Price, and Size Description, then save.",
      ]),
      note("Administrator Review Note", "Add a screenshot of the All Inventory header and product table before publishing."),
    ],
  },
  {
    categorySlug: "inventory-management",
    slug: "searching-filtering-sorting-inventory",
    title: "Searching, Filtering & Sorting Inventory",
    summary: "How to use global search, Excel-style column filters, Vendor/Brand pickers, and Active/Inactive or Old SKU filters.",
    sortOrder: 2,
    relatedSlugs: ["understanding-all-inventory", "importing-inventory-and-pos-importer"],
    contextKeys: ["inventory"],
    needsReview: true,
    blocks: [
      h2("Global Search"),
      p("Type a SKU, product number, description keyword, vendor, or brand into the top search bar and press **Enter** (or click **Search**) to search across your entire catalog."),
      h2("Column Filters & Sorting"),
      steps([
        "Click the dropdown arrow (**▾**) next to any column heading (SKU, Product Number, Description, Vendor, Brand, List Cost, Price, Status, or Old SKU).",
        "Sort ascending or descending, or clear the current sort.",
        "For **Vendor** and **Brand**, pick an exact value from the searchable list (with product counts shown beside each entry) or type a partial match.",
        "For **Status**, filter to **Active only** or **Inactive only**. For **Old SKU**, filter to **Old SKUs only** or **Current SKUs only**.",
      ]),
      p("Active filters appear as blue chips above the table. Click **×** on any chip to remove that filter."),
    ],
  },
  {
    categorySlug: "inventory-management",
    slug: "importing-inventory-and-pos-importer",
    title: "Importing Inventory & Using the Unified POS Importer",
    summary: "How to upload POS inventory files, use the Unified POS Importer wizard, and update inactive product lists.",
    sortOrder: 3,
    relatedSlugs: ["understanding-all-inventory", "using-pos-excel-cleaner", "managing-old-skus-and-deletion"],
    contextKeys: ["inventory"],
    needsReview: true,
    blocks: [
      h2("Option 1: Unified POS Importer (Recommended for Raw POS Exports)"),
      p("The **Unified POS Importer** cleans your raw POS export and imports products with their Active/Inactive status in one guided workflow:"),
      steps([
        "On **All Inventory**, click **Unified POS Importer**.",
        "Drag and drop (or browse for) your Amber/Cybex POS export file (`.xlsx`, `.xls`, or `.csv`).",
        "In the **Preview** step, review the cleaned records, search or filter by Active/Inactive status, and uncheck any rows you want to exclude.",
        "Confirm and run the import. A progress bar tracks batches and displays a final summary of inserted, updated, skipped, and failed rows.",
      ]),
      h2("Option 2: Standard Inventory & Inactive List Upload"),
      bullets([
        "**Upload POS Inventory:** Imports or updates products by SKU. Check **Mark missing products inactive** only if your uploaded file represents your complete active catalog and you want unlisted items flagged as Inactive.",
        "**Upload Inactive SKU List:** Marks listed SKUs as Inactive without deleting them from inventory.",
      ]),
      warn("Never Deletes Historical Worksheets", "Importing inventory updates product catalog records only — it never deletes saved price update worksheets."),
    ],
  },
  {
    categorySlug: "inventory-management",
    slug: "managing-old-skus-and-deletion",
    title: "Managing Old SKUs, Product Matching & Deleting Inventory",
    summary: "How SKU matching works, how to mark superseded Old SKUs, and how to delete selected products safely.",
    sortOrder: 4,
    relatedSlugs: ["understanding-all-inventory", "importing-inventory-and-pos-importer", "spreadsheet-flags-and-errors"],
    contextKeys: ["inventory"],
    needsReview: true,
    blocks: [
      h2("How Product Matching Works"),
      p("When vendor spreadsheets arrive with spaces, dashes, or check digits in barcodes, the application automatically normalizes SKUs so they match your **All Inventory** SKUs reliably. If a specific vendor code uses a different format, you can still enter a **Cleaned SKU** directly inside a price worksheet."),
      h2("Tracking Old SKUs"),
      p("When a vendor replaces a barcode or SKU with a new one, you can flag the retired record as an **Old SKU** directly in **All Inventory** (and link it to its replacement SKU where applicable). Filtering the **Old SKU** column lets you audit retired SKUs cleanly without losing history."),
      h2("Deleting Selected Products vs. Clear Inventory"),
      bullets([
        "**Delete Selected:** Check the boxes next to specific products you want to remove, click **Delete Selected**, and confirm in the dialog.",
        "**Clear Inventory:** Removes all products from the inventory catalog (requires explicit confirmation). Only use this when intentionally performing a full catalog reload.",
      ]),
      warn("Use Clear Inventory with Caution", "Clearing inventory removes all catalog records until you re-import a POS file. Always confirm with a supervisor before clearing the full catalog."),
    ],
  },

  // =========================================================================
  // F. CALENDAR & REMINDERS
  // =========================================================================
  {
    categorySlug: "calendar-and-reminders",
    slug: "using-the-price-update-calendar",
    title: "Using the Price Update Calendar",
    summary: "How to switch between Month, Week, and List views, filter scheduled worksheets, and drag-and-drop to reschedule.",
    sortOrder: 1,
    relatedSlugs: ["scheduling-price-updates-and-reminders", "monitoring-reminders-and-notifications"],
    contextKeys: ["calendar"],
    needsReview: true,
    blocks: [
      h2("Calendar Views & Summary Counters"),
      p("Open **Calendar** in the sidebar to see all scheduled price updates across **Month**, **Week**, and **List** views. Summary cards at the top display counts for **Scheduled**, **Upcoming**, **Active Reminders**, and **Failed Reminders**."),
      h2("Filtering Scheduled Updates"),
      p("Use the filter bar to narrow events by keyword, **Vendor**, **Status** (Scheduled, Completed/Exported, Cancelled), **Reminder Status** (Active, Sent, Failed, None), or **Timeframe**."),
      h2("Inspecting & Rescheduling Events"),
      bullets([
        "**Click any event card** to open its detail panel, view reminder status and history, jump straight into the worksheet, edit the schedule, or cancel the schedule.",
        "**Drag and drop** an active Scheduled card onto another future date on the calendar grid to reschedule it quickly (a confirmation dialog lets you review the move before saving).",
      ]),
      note("Administrator Review Note", "Add a screenshot of the Price Update Calendar in Month view showing scheduled cards and reminder badges."),
    ],
  },
  {
    categorySlug: "calendar-and-reminders",
    slug: "scheduling-price-updates-and-reminders",
    title: "Scheduling a Price Update & Setting Reminders",
    summary: "How to assign an effective date to a worksheet, choose reminder timing and recipients, and reschedule or cancel.",
    sortOrder: 2,
    relatedSlugs: ["using-the-price-update-calendar", "monitoring-reminders-and-notifications"],
    contextKeys: ["calendar", "worksheet"],
    needsReview: true,
    blocks: [
      h2("When a Worksheet Can Be Scheduled"),
      p("Once a price update worksheet has products and is in a schedulable status (**Ready**, **Being Reviewed**, **Reviewed**, or already **Scheduled**), the **Schedule** button in the worksheet header becomes active."),
      h2("Scheduling Step-by-Step"),
      steps([
        "Open the worksheet and click **Schedule** in the top header.",
        "Pick the **Effective Date** when the new prices should take effect.",
        "Turn on **Send email reminder** if you want the team notified automatically.",
        "Choose when to send the reminder (such as **1 day before**, **Same day**, **2 days before**, or a **Custom date & time**).",
        "Keep the **Default recipients** configured in Settings, or switch to **Custom recipients** to add specific email addresses for this update only.",
        "Click **Save Schedule**. The worksheet's status changes to **Scheduled** and it appears on the Calendar.",
      ]),
      h2("Rescheduling or Cancelling a Schedule"),
      p("Click the **Scheduled: [Date]** button in the worksheet header (or click the event on the Calendar) to change the date, update the reminder, or **Cancel Schedule** (which restores the worksheet's previous status and cancels any unsent reminder)."),
    ],
  },
  {
    categorySlug: "calendar-and-reminders",
    slug: "monitoring-reminders-and-notifications",
    title: "Understanding Upcoming, Sent & Failed Reminders",
    summary: "How automated email reminders behave, what each badge means, and how administrators check reminder diagnostics.",
    sortOrder: 3,
    relatedSlugs: ["scheduling-price-updates-and-reminders", "settings-and-notifications-overview"],
    contextKeys: ["calendar", "settings"],
    needsReview: true,
    blocks: [
      h2("Reminder Status Badges"),
      tbl(
        ["Badge", "Meaning"],
        [
          ["Reminder Active", "Scheduled and waiting for its reminder date and time to arrive."],
          ["Reminder Sent", "Email reminder was delivered successfully to the configured recipients."],
          ["Reminder Failed", "Delivery failed after retry attempts — check Settings → Notifications & Diagnostics for the error message."],
          ["Reminder Expired", "The scheduled reminder window passed without being eligible to send."],
          ["No reminder / Reminder Off", "The worksheet is scheduled on the calendar without an email reminder enabled."],
        ],
      ),
      h2("Checking Diagnostics & Running a Manual Check (Admin)"),
      p("Administrators can open **Settings → Price Update Calendar & Notifications** to view pending, due, sent, and failed reminder counts, send a **Test Email**, and click **Run Reminder Check Now** to process due reminders immediately."),
    ],
  },

  // =========================================================================
  // G. PRICING & STORE TOOLS
  // =========================================================================
  {
    categorySlug: "pricing-and-store-tools",
    slug: "using-the-pricing-calculator",
    title: "Using the Vendor Pricing Calculator",
    summary: "How to calculate single items, box/case unit costs, pasted cost lists, and bulk CSV simulations without affecting saved sheets.",
    sortOrder: 1,
    relatedSlugs: ["managing-vendor-and-brand-discounts", "creating-a-new-price-update"],
    contextKeys: ["calculator"],
    needsReview: true,
    blocks: [
      h2("Three Calculator Modes"),
      p("Open **Pricing Calculator** from the sidebar to test retail prices using your live saved Vendor and Brand discount rules:"),
      bullets([
        "**Single Item:** Pick a vendor (and optional brand), enter the list cost, and see the net cost and rounded retail price instantly. Check **Calculate from a box/case price** to enter a case cost and quantity per box.",
        "**Batch Calculator:** Choose a vendor/brand, paste a column of list costs (one per line), and view all net and retail prices side by side.",
        "**Bulk CSV Upload:** Paste or upload multi-vendor CSV rows (`Vendor,Brand,ListCost,Divisor,DiscountOverride`) to simulate many items at once and download the results.",
      ]),
      note("Completely Non-Destructive", "Nothing entered in the Pricing Calculator modifies your inventory, saved vendor discounts, or existing price update worksheets."),
    ],
  },
  {
    categorySlug: "pricing-and-store-tools",
    slug: "managing-vendor-and-brand-discounts",
    title: "Managing Vendor & Brand Discounts",
    summary: "How to add, edit, and delete default vendor discounts and brand-specific overrides.",
    sortOrder: 2,
    relatedSlugs: ["using-the-pricing-calculator", "creating-a-new-price-update"],
    contextKeys: ["vendors"],
    needsReview: true,
    blocks: [
      h2("How Saved Discounts Work"),
      p("Open **Vendor Discounts** from the sidebar to manage the default percentage discounts applied automatically whenever you create a price update or use the Pricing Calculator."),
      bullets([
        "**Vendor Default Discount:** Applies to all products from that vendor unless a more specific brand discount exists.",
        "**Brand-Specific Override:** Applies to a specific brand under a vendor and takes priority over the general vendor default.",
      ]),
      h2("Adding or Updating a Discount"),
      steps([
        "Choose either the **Vendor Default** or **Brand Override** form tab.",
        "Type or pick the vendor name (and brand name for a brand override) from the suggestions.",
        "Enter the default discount percentage (for example, `10` for 10%) and click **Save**.",
      ]),
      p("You can search, sort, edit, or delete existing discount entries directly from the table below."),
    ],
  },
  {
    categorySlug: "pricing-and-store-tools",
    slug: "using-pos-excel-cleaner",
    title: "Using the POS Excel Cleaner",
    summary: "How to validate an Amber/Cybex POS export and download a standardized 8-column Excel workbook.",
    sortOrder: 3,
    relatedSlugs: ["importing-inventory-and-pos-importer", "understanding-all-inventory"],
    contextKeys: ["pos-cleaner"],
    needsReview: true,
    blocks: [
      h2("When to Use POS Excel Cleaner"),
      p("Use **POS Excel Cleaner** when you want to clean a raw Amber/Cybex POS export into a neat, standardized 8-column Excel file for archiving, sharing, or importing."),
      steps([
        "Open **POS Excel Cleaner** from the sidebar.",
        "Drag and drop your `.xlsx`, `.xls`, or `.csv` POS export onto the upload zone (or click **Choose Excel File**).",
        "Wait a moment while the file headers and product rows are validated.",
        "Review the status card and preview, then click the download button to save the cleaned Excel workbook.",
      ]),
      tip("Importing Directly into All Inventory?", "If your goal is to update **All Inventory** directly from a raw POS file, you can also use the **Unified POS Importer** right inside the All Inventory page."),
    ],
  },
  {
    categorySlug: "pricing-and-store-tools",
    slug: "using-99-price-manager",
    title: "Using the 99 Price Manager",
    summary: "How to select or bulk-paste SKUs, export Check or Uncheck .99 Excel batches, and review batch history.",
    sortOrder: 4,
    relatedSlugs: ["understanding-all-inventory", "using-adhoc-count-sheets"],
    contextKeys: ["price-99"],
    needsReview: true,
    blocks: [
      h2("Building a 99 Price Batch"),
      steps([
        "Open **99 Price Manager** from the sidebar.",
        "Search for products by SKU or description and click to add them to your selection — or click **Bulk SKU Entry** to paste a list of SKUs at once.",
        "Review your selected list and remove any unwanted items.",
        "Click the **Check** or **Uncheck** export action to preview the batch, then confirm to download the Excel file and log the batch to history.",
      ]),
      h2("Viewing & Managing Batch History"),
      p("Switch to the **History** tab to search past batches, filter by **Check / Uncheck**, inspect the products included in any batch, re-export a previous batch, or delete old history records."),
    ],
  },
  {
    categorySlug: "pricing-and-store-tools",
    slug: "using-adhoc-count-sheets",
    title: "Using Ad Hoc Inventory Count Sheets",
    summary: "How to create quick multi-vendor count sheets for missed products or inventory discrepancies and export them for store teams.",
    sortOrder: 5,
    relatedSlugs: ["exporting-store-count-sheets", "understanding-all-inventory"],
    contextKeys: ["adhoc-counts"],
    needsReview: true,
    blocks: [
      h2("Creating an Ad Hoc Count Sheet"),
      steps([
        "Open **Ad Hoc Count Sheets** from the sidebar and click **Create New Count Sheet**.",
        "Click the sheet title to rename it (for example, `Missed Items — Front Wall`).",
        "Add products one at a time using the SKU input, or click **Bulk Paste** to look up many SKUs across multiple vendors at once.",
        "Enter optional values in **QQH**, **LAYWAY**, **PREPAID**, **Expiry**, or **On Transfer** — changes autosave automatically.",
        "Click **Export for Teams** to download a ready-to-use Excel count sheet with frozen headers, locked product columns, and unlocked count entry columns.",
      ]),
      p("When counting is complete, toggle the sheet status from **In Progress** to **Completed** so your team knows it is finished."),
    ],
  },

  // =========================================================================
  // H. SETTINGS & ADMINISTRATION
  // =========================================================================
  {
    categorySlug: "settings-and-administration",
    slug: "settings-and-notifications-overview",
    title: "Settings, Preferences & Notification Configuration",
    summary: "A guide to all four tabs in Settings: Appearance & Themes, Dashboard & Layout, Calendar & Notifications, and System & Data Rules.",
    sortOrder: 1,
    relatedSlugs: ["appearance-themes-and-density", "choosing-your-default-editor", "monitoring-reminders-and-notifications"],
    contextKeys: ["settings"],
    needsReview: true,
    blocks: [
      h2("Personal Settings (Available to All Staff)"),
      bullets([
        "**Appearance & Themes:** Choose New UI vs. Classic UI, set your Default Price Update Editor, pick Light/Dark/System theme, select an Accent Color, and choose Table Density.",
        "**Dashboard & Layout:** Show, hide, or reorder Dashboard sections, pick visible key metrics, hide optional sidebar items, or restore defaults.",
        "**System & Data Rules:** Reference summary of how New UI and Classic UI share the exact same live data safely.",
      ]),
      h2("Calendar & Notification Settings (Administrator Managed)"),
      p("Under **Settings → Price Update Calendar & Notifications**, administrators can:"),
      bullets([
        "Add, edit, or remove **Default Reminder Recipients** who receive scheduled price update reminder emails.",
        "Set the organization's **Timezone**, **Default Reminder Time**, and whether reminders default to enabled.",
        "Send a **Test Email** to confirm delivery.",
        "Inspect live reminder scheduler diagnostics and trigger **Run Reminder Check Now**.",
      ]),
    ],
  },
  {
    categorySlug: "settings-and-administration",
    slug: "managing-the-help-centre-admin-guide",
    title: "Managing the Help Centre (Administrator Guide)",
    summary: "How authorized administrators create, edit, illustrate with screenshots, preview, organize, and publish staff documentation.",
    sortOrder: 2,
    relatedSlugs: ["welcome-to-genesis-pricing", "settings-and-notifications-overview"],
    contextKeys: ["help-admin"],
    needsReview: true,
    blocks: [
      h2("Who Can Edit Documentation"),
      p("All logged-in staff can read **Published** Help Centre articles. Creating, editing, uploading screenshots, reordering, publishing, unpublishing, and deleting documentation is restricted to authorized administrators and enforced securely on the server."),
      h2("Drafts vs. Published Articles"),
      bullets([
        "**Draft:** Visible only to administrators. Staff cannot see draft articles or unpublished edits.",
        "**Published:** Visible to all staff in the Help Centre, search results, and contextual help side panels.",
        "**Editing a Published Article:** When you save draft edits to an already-published article, staff continue seeing the current published version untouched until you click **Publish Changes**.",
      ]),
      h2("How to Review & Publish an Article"),
      steps([
        "Open **Help Centre** from the sidebar and turn on **Admin Manage Mode** (or click **Edit Article** on any article).",
        "Update the Title, Category, Summary, and content blocks using the visual block editor — add Headings (which automatically build the Table of Contents), Paragraphs, Numbered Steps, Bullet Lists, Callout Boxes (Note/Tip/Warning), Tables, Links to other articles, and uploaded Screenshots.",
        "Click **Preview** to check exactly how the article will look to staff in Light and Dark Mode.",
        "Click **Save Draft** to keep working privately, or click **Publish** when ready for staff to read.",
      ]),
      h2("Reordering & Revision History"),
      p("Use the up/down arrows in Admin Manage Mode to reorder categories and articles. Every draft save and publish creates a timestamped snapshot in **Revision History**, allowing you to preview or restore a previous version at any time."),
    ],
  },
];
