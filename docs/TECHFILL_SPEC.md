# Techfill — product specification (v0.3)

> **Merged build:** this specification describes the product as it was before the merge. In the merged extension (Moonfill 2.1) read `MERGED_BUILD.md` first: it lists what changed (shared edit lock, scan badge on the orb, preset editor opened from the popup).


> Audience: an AI agent or engineer who must understand, operate, extend or merge this product **without reading the code**.
> Everything here describes behaviour that is implemented in `techfill.js`, `techfill-popup.js`, `techfill-popup.html` and `manifest.json`.
> Statements marked **ASSUMPTION** are not verified against a live Salesforce org and must be checked before relying on them.

## 1. Purpose

Techfill is a Chrome/Edge (Manifest V3) extension for Awin agents. On a Salesforce **Implementation** record (object `TSE__c`) it fills the repetitive **technical checklist** fields in one click, from a saved **preset** (one preset per integration platform: Standard, Shopify, WooCommerce, Magento, PrestaShop, GTM). It exists to remove ~1 minute of manual field changing per implementation and, more importantly, to make the checklist consistent.

It is deliberately conservative: it only fills **empty** fields (except fields the user has explicitly changed in the Parameters panel), it refuses to start on top of the user's unsaved edits, it verifies what it wrote, and it never saves if anything unexpected happened.

Non-goals: it does not run Moonpull scans, does not post to Chatter, does not fill the five scan-result fields (see §3), does not detect the e-commerce platform automatically (the agent picks the preset), and does not talk to any server (everything is local, only `chrome.storage.local`).

## 2. Glossary

| Term | Meaning |
|---|---|
| Implementation record | Salesforce Lightning record of object `TSE__c`. URL contains `/r/TSE__c/<id>/view`. |
| Technical checklist | The group of fields on the record's **Details** tab that describe how an advertiser's tracking is implemented (Img tag implemented, Script tag implemented, …). |
| Preset | A named block of text, one line per field: `Field label = value`. Stored locally. |
| Orb | The small round floating button (pen icon) Techfill injects on Implementation records. |
| Parameters | The on-page panel listing a preset's Yes/No fields so the user can flip them. Only for Standard and GTM presets. |
| Override (force) | A field the user changed in Parameters. From then on it **overwrites** the value on the record when Fill runs. |
| Scan-owned fields | Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF, Consent Management Platform. Filled by **Moonfill** from the Moonpull scan result, never by Techfill. |
| Access | An account type. Drives the SingleView fields (see §6.1). |
| SingleView | A product area on the record; two of its fields are derived automatically (see §6.1). |
| MID | Awin advertiser (merchant) ID. Not used by Techfill. |
| Review mode / Save mode | Popup setting "After filling": *Review first* (fill, user clicks Save) or *Save automatically*. |

## 3. Field ownership (Techfill vs Moonfill)

| Fields | Owner | Behaviour |
|---|---|---|
| Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF, Consent Management Platform | **Moonfill** | Always set from the **latest** Moonpull scan result, overwriting what is on the record. Techfill ignores these labels even if a preset contains them, and never lists them in Parameters. (Reset, a testing tool, does clear them — §10.) |
| SingleView Setup Type, SingleView Integration Status | Techfill (derived) | Computed from the account type (§6.1). |
| Everything else in the default preset (§5.3) | Techfill | Empty-only fill, or overwrite when overridden in Parameters. |
| Successful Tracking Test, SingleView date/time-tracking fields, notes fields | Nobody (by design) | Left to the agent. Never touched, not even by Reset. |

## 4. Where it runs, permissions

* Content script `techfill.js` is injected on `https://awin.lightning.force.com/*`. It activates only when the URL path matches `/r/TSE__c/<recordId>/view` (checked every second, so it follows Lightning's single-page navigation).
* Toolbar popup: `techfill-popup.html` / `techfill-popup.js` (preset editor).
* Manifest permission: **`storage` only**. No host permissions beyond the content-script match, no background script, no network requests.
* Chrome and Edge (Chromium, MV3).

## 5. Presets

### 5.1 Format

* One line per field: `Field label = value`. The label must equal the label shown in Salesforce (case-insensitive, `*` and extra spaces ignored). The value is either the exact text of a picklist option, free text, a date, or `true`/`false` for checkboxes.
* Lines starting with `#` are comments and ignored. Lines without a value are skipped.
* Tokens inside values: `{today}` → today's date as `dd/mm/yyyy`; `{created}` → the date on the **Created.** line of the record's *Implementation History* box (see §6.3).
* Parsing function behaviour: labels in the scan-owned list are dropped; a label in the preset's `overrides` list gets `force = true`.

### 5.2 Ready-made presets

| Key | Preset name | `{ecom}` (eCommerce platform) | `{tms}` (Tag Management Solution) | Parameters button |
|---|---|---|---|---|
| `standard` | Standard (direct imp) | Not Applicable | Not Applicable | yes |
| `shopify` | Shopify | Shopify | Not Applicable | no |
| `woocommerce` | WooCommerce | Wordpress (Woocommerce) | Not Applicable | no |
| `magento` | Magento | Magento | Not Applicable | no |
| `prestashop` | PrestaShop | Prestashop | Not Applicable | no |
| `gtm` | GTM | Not Applicable | GTM (Google Tag Manager) | yes |

All presets share the same text; only the two fields `eCommerce platform` and `Tag Management Solution` differ. "Standard (direct imp)" is a direct implementation (no platform, no tag manager). E-commerce platform presets never show Parameters because their option set is fixed ("ecommerce will always have all the options").

A preset object in storage: `{ id, key, name, text, overrides[] }`. Duplicating a preset copies `key` (so a copy of Standard still gets Parameters) and `overrides`.

### 5.3 Default field list (the `text` of every ready-made preset)

| Field label (exact text in Salesforce) | Default value | Shown in Parameters panel |
|---|---|---|
| Pixel Sent | `{today}` | no |
| Successful Tracking Test | *(blank: not filled by default)* | no |
| Img tag implemented | `Yes` | yes (Yes/No dropdown) |
| Script tag implemented | `Yes` | yes (Yes/No dropdown) |
| 1st party cookie compliant | `Yes` | yes (Yes/No dropdown) |
| Mastertag implemented on all pages | `Yes` | yes (Yes/No dropdown) |
| Server to server | `Yes` | yes (Yes/No dropdown) |
| 3rd Party S2S Integration Tool | *(blank: not filled by default)* | no |
| Adblocking solution | `Yes` | yes (Yes/No dropdown) |
| Deduplication | `Yes with channel parameters` | no |
| Deduplication Solution | `Not Applicable` | no |
| Other Deduplication Solution | *(blank: not filled by default)* | no |
| Deduplication Parameter | `source,utm_source` | no |
| Channel parameters implemented | `aw,awin` | no |
| Tag Management Solution | `{tms}` | no |
| eCommerce platform | `{ecom}` | no |
| Website Platform URL | *(blank: not filled by default)* | no |
| Other eCommerce platform | *(blank: not filled by default)* | no |
| Transactional app available | `Yes` | yes (Yes/No dropdown) |
| App tracking implemented | `No` | yes (Yes/No dropdown) |
| Keep users on m-web | `No` | yes (Yes/No dropdown) |
| Voucher Tracking implemented | `Yes` | yes (Yes/No dropdown) |
| Product Level Tracking implemented | `Yes` | yes (Yes/No dropdown) |
| Multi-currency implemented | `No` | yes (Yes/No dropdown) |
| VAT and Delivery implemented | `Both excluded` | no |
| Mobile Site Tracking Implemented | `Yes` | yes (Yes/No dropdown) |
| App tracking provider | `No` | yes (Yes/No dropdown) |
| Other App tracking implemented | *(blank: not filled by default)* | no |
| Link Builder activated | `Yes` | yes (Yes/No dropdown) |
| Active cross device | *(blank: not filled by default)* | no |
| MT plugins activated | *(blank: not filled by default)* | no |
| Custom parameters implemented | `Yes` | yes (Yes/No dropdown) |
| Custom parameters notes | `N vs R` | no |
| Product Feed uploaded | `Yes` | yes (Yes/No dropdown) |
| Product Feed format | *(blank: not filled by default)* | no |
| Batch validation | `Yes` | yes (Yes/No dropdown) |
| Linked Accounts activated | `No` | yes (Yes/No dropdown) |
| AM set up in Awin UI | *(blank: not filled by default)* | no |
| IP Truncation Level Enabled | `Level 4` | no |
| Transaction Referrer Truncation | `Strip path information when no valid domain` | no |
| Tech notes | *(blank: not filled by default)* | no |
| Sales Tech Handover Notes | *(blank: not filled by default)* | no |

Values in `{ }` are substituted when the preset is created (`{ecom}`, `{tms}` from §5.2) or when Fill runs (`{today}`, `{created}`).

## 6. Rules

### 6.1 Account type → SingleView fields (Access double-check)

Techfill reads two fields from the record: **Client Type** and **Platform Offer** (**ASSUMPTION**: these are the exact labels, and "Access" is the exact option text; comparison is case-insensitive equality with `access`).

| Client Type | Platform Offer | Decision | Reason shown in the report |
|---|---|---|---|
| not Access (anything non-empty) | (ignored) | **not Access** | `Client Type "<x>" (not Access)` |
| Access | Access | **Access** | `Access (Client Type and Platform Offer agree)` |
| Access | something else | **not Access** — *Platform Offer wins* | `Client Type says Access but Platform Offer is "<x>": Platform Offer wins, not Access` |
| Access | empty / field not found | **Access** (cannot double-check) | `Client Type Access (Platform Offer not found, not double-checked)` |
| empty | Access | **Access** | `Client Type empty, Platform Offer "Access" decides` |
| empty | something else | **not Access** | `Client Type empty, Platform Offer "<x>" decides` |
| empty | empty | **unknown** → SingleView fields skipped and a problem is reported | `Client Type and Platform Offer not found` |

Resulting entries:

* Access → `SingleView Setup Type = SV not activated` (Integration Status is **not** written).
* not Access → `SingleView Setup Type = MasterTag enabled` and `SingleView Integration Status = New`.
* A line for these labels inside the preset text wins over the derived value.

### 6.2 Empty-only vs overwrite

* Default: a field that already has a value is **kept** (reported under "Kept"). A field whose value already equals the target is reported "already right".
* A field the user changed in the Parameters panel is **forced**: it overwrites the existing value. The forced set persists (see §11).
* Radios, checkboxes and text follow the same rule (checkbox: forced → set to the target state).

### 6.3 `{created}` (Pixel Sent from history)

`createdDate()` looks, in the whole active page (hidden content included), for a box titled **Implementation History** (exact title or `Implementation History (n)`), finds rows containing a cell whose text is `Created.` (or `Created`), and parses the first date in each row. Accepted formats: `YYYY-MM-DD`, `dd/mm/yyyy` (day first), `3 Nov 2026`, `Nov 3, 2026`. If exactly one distinct date results it is formatted `dd/mm/yyyy` and substituted. Otherwise the line is **skipped** and a problem explains why (box missing / no Created line / several different dates). The default preset still uses `{today}` for Pixel Sent; switching to `{created}` is a manual edit.

## 7. User interface

### 7.1 The orb (floating button)

* A 46 px round button with a pen icon and a dashed "stitched" ring. Appears bottom-left by default on Implementation records.
* **Draggable anywhere** (free placement, kept 8 px inside the window). Position is stored as ratios `{rx, ry}` of the free area in `chrome.storage.local.dockPos`, so it survives window resizes and is shared across tabs (a move in one tab moves it in others).
* **Hover** opens the menu; leaving closes it after ~0.38 s. **Click without moving**: if the menu or any panel (Parameters, Presets, report) is open, **everything closes and only the orb remains** (hovering does not reopen the menu until the pointer has left and re-entered); if nothing is open, the menu is pinned open. Esc or a click elsewhere unpins a pinned menu. Dragging closes the menu.
* The menu opens toward the side with room (left or right of the orb, upward or downward).
* During a run the ring spins and the menu shows a status line (`Filling…` / `Resetting…`); all menu buttons are disabled except the orb.

### 7.2 The menu

Header: brand "TECHFILL" and a clickable **mode chip**: `○ review first` / `● saves automatically` (toggles the same `autoSave` setting as the popup).
Body, top to bottom:
1. **Preset** list (one row per preset, active one marked with a yellow dot). Clicking a row sets `activePreset`.
2. **Fill** and **Reset** buttons side by side. Reset needs two clicks (first click turns it into "Sure?" for 3 s).
3. **Parameters** button (full width) — visible only when the active preset's `key` is `standard` or `gtm`. When not pressed it is just a button; no panel is shown.
4. Status line.

### 7.3 Panels (open beside the menu, never over the orb or menu)

* **Report panel** after Fill/Reset: title `Techfill · <preset>`, coloured top border (green ok / amber warn / red bad), chips (filled, already right, kept, problems), the account decision (`Account: …`), grouped lists, a collapsible list of filled fields, the save note, and a **Copy report** button. The same text is logged to the page console as `[Techfill] …`.
* **Parameters panel**: see §11.
* Only one panel at a time. Panels close on navigation to another record.

### 7.4 Toolbar popup (preset editor)

Header with the orb logo. Sections: **Preset** (select, Duplicate, Reset values, Delete — Delete/Reset need two clicks; at least one preset must remain; preset name field; large monospace text area, saved as you type), **After filling** (Review first / Save automatically), and a collapsible help. If a preset is edited from the orb while the popup is open, the popup refreshes.

## 8. The Fill algorithm

1. Ignore if a run is in progress. Disable menu buttons, show `Filling…`.
2. Load storage `presets`, `activePreset`, `autoSave`. Parse the active preset (scan-owned labels removed). If there are no entries → panel *Nothing to fill yet*.
3. Open the **Details** tab and wait up to 8 s for it.
4. **Edit-mode guard**: if a `Save` button (`button[name="SaveEdit"]`) is already visible and Techfill did not itself leave the form open (`ownEditFor` ≠ this record) → panel *The record is already in edit mode* ("Save or cancel your own edits first… Saving from here would also save whatever you changed.") and stop.
5. Expand collapsed sections in the Details panel; wait 300 ms; click the Details inline-edit trigger (or reuse the open edit form); wait up to 8 s for Save to appear. Failure → panel *Could not open edit mode*.
6. Resolve `{created}` entries (§6.3).
7. Decide account type (§6.1) and add the derived SingleView entries unless the preset already has those labels.
8. **Snapshot**: record the value of every editable field in the Details tab except the fields about to be written.
9. For each entry: find the field box by label; detect control type (§9); write (empty-only, or overwrite if forced); on success verify **within 3 s** that the control now shows the value (dates compared by meaning). A value that does not stick becomes a *problem* and a **blocker**.
10. Wait 300 ms, take a second snapshot; if any non-target field differs → problem `"<field>" changed unexpectedly` and a blocker.
11. Decide the outcome:
    * Nothing was written → note `Nothing needed filling.`; if Techfill itself opened edit mode it clicks **Cancel** to leave it.
    * Something written and **Review mode** → note `Review the fields, then click Save.` (or `Check before you save: …` if there are blockers). The form stays open and a re-run is allowed (`ownEditFor`).
    * Something written and **Save mode**:
      * blockers → *not saved*: `Not saved: <blockers>. The fields are filled on the page: check them, then click Save, or Cancel to discard.`
      * not exactly one visible Save button → *not saved* (`expected one Save button, found N`).
      * otherwise click Save and wait up to 15 s for a definite outcome: Salesforce error banner text → `Salesforce did not save: <error> Your changes are still on the page…`; no outcome → `Save was clicked but the page is still in edit mode and no error is shown…`; edit mode closed → **read back** the saved values from the record (up to 8 s): `Saved. N values checked on the record.` or `Saved, but N fields don't show the expected value: …`.
12. Build the report, log it, show the panel, re-enable buttons.

Moving to another record mid-run aborts silently.

## 9. Supported control types

Picklist combobox (`button[role=combobox]`; opens the list and clicks the option whose text equals the value, two attempts), native `<select>`, radio group (click the radio whose label equals the value), checkbox (`true`/`false`), text / textarea / date input (value set through the native setter plus `input` and `change` events). **Unsupported** (reported as a problem): dual-listbox multi-select and lookup fields. Read-only fields have no control and are reported "no editable control (read-only?)". Fields not present are reported under "Not found".

## 10. Reset (testing tool)

Button *Reset* (two clicks). Sets back to `--None--` / empty / unchecked: every field **listed in the active preset**, plus SingleView Setup Type, SingleView Integration Status and the five scan-owned fields. Fields commented out of the preset (notes, Successful Tracking Test, …) are never touched. Radios cannot be cleared (reported "left as they are"). It follows the same mode, guards, snapshot, verification and save/read-back logic as Fill, so in Review mode it leaves the form open and a Fill can follow immediately.

## 11. Parameters panel

* Appears only for presets with key `standard` or `gtm`.
* Lists every line of the active preset whose value is exactly `Yes` or `No` (case-insensitive), **excluding** scan-owned fields, one row per field with a Yes/No dropdown.
* Changing a dropdown **immediately** rewrites that single line in the preset text (everything else in the text is preserved byte for byte) and adds the label to the preset's `overrides` list. Both persist in `chrome.storage.local`; **they are not reset when a job completes**. They are cleared only by the popup's *Reset values* (which restores the ready-made text and empties `overrides`) or by deleting the preset.
* Because of `overrides`, the next **Fill overwrites** those fields on the record with the chosen values, even if they already held something else.
* Switching preset while the panel is open re-renders it (or closes it for an e-commerce preset).

## 12. Storage schema (`chrome.storage.local`)

| Key | Type | Meaning |
|---|---|---|
| `presets` | array of `{id, key, name, text, overrides[]}` | all presets |
| `activePreset` | string (preset id) | selected preset |
| `autoSave` | boolean | Save mode when true |
| `presetsV` | number (3) | migration marker. v2 added the ready-made presets; v3 stripped the five scan fields from saved presets and added `overrides` |
| `dockPos` | `{rx, ry}` 0..1 | orb position |

No other state; nothing leaves the browser.

## 13. Visual design

Matches Moonfill so the two can be merged: deep blue `#0b2354 → #1f54a2`, light blue `#17a7e8` / `#4cc3f5`, moon yellow `#f8d559` (brand text, active-preset dot, "saves automatically" chip, spinning ring). Orb = deep-blue sphere with a stitched light-blue ring; Fill = light-blue gradient; panels = dark navy. DOM ids: `techfill-dock`, `techfill-orb`, `techfill-btn`, `techfill-reset`, `techfill-params`, `techfill-preset`, `techfill-panel`, `techfill-style`. An internal `BUILD` stamp makes a newer script replace an older dock/style left on the page after an extension reload.

## 14. Diagnostics

Page console (Salesforce tab): `[Techfill] <full report>` after each run, `[Techfill] <error>` on exceptions. The report panel's Copy button copies the same text.

## 15. Known limitations and assumptions

1. **ASSUMPTION**: field labels `Client Type`, `Platform Offer` and the value `Access` are as written in §6.1. If Platform Offer uses another wording, `accessDecision` must be adjusted.
2. Selectors target Lightning's standard markup (`.slds-form-element`, `.test-id__field-label`, `button[role=combobox]`, `a[data-tab-value="detailTab"]`, `button[name="SaveEdit"]`, …). The default Fill/Reset path was proven on real records by the author (Techfill ≤ 0.1); the v0.2+ safeguards (snapshot, read-back, guards), the orb and Parameters have been exercised only against a mock page and unit tests — **test on a few records you can easily correct before relying on them**.
3. Shadow DOM is not pierced (Lightning's synthetic shadow has been sufficient).
4. Date read-back tolerates display formats it can parse; an unreadable format is treated as "cannot verify" (no warning). Checkbox/radio targets are not read back.
5. The unexpected-change guard can fire on a legitimate dependent-field change; it then refuses to auto-save and names the field.
6. Platform auto-detection (from the client's landing page) is **not** in the standalone build (it needs a background script and a broad host permission); it exists in the merged build (§16b).
7. Multi-select and lookup fields are unsupported.

## 16. Tests

Automated (run in Node, no browser): date parsing/formatting and value comparison (15 cases), Access decision (7 cases), scan-field exclusion and override flags in the preset parser, migration stripping of old preset lines. A headless-browser preview exercised: orb drag and persisted position, hover menu, preset switching, Parameters visibility (Standard/GTM yes, Shopify no), Yes/No write-back changing exactly one line, panel placement without overlap, mode chip toggle.

Manual checklist on a real record: (1) Fill on an empty test record in Review mode, inspect; (2) Save mode, check the read-back note; (3) open edit mode yourself then click Fill → must refuse; (4) change a Parameters value on a record that already has a different value → Fill must overwrite it; (5) Client Type Access with a non-Access Platform Offer → SingleView = MasterTag enabled / New; (6) Reset then Fill round-trip; (7) navigate to another record mid-run.

## 16b. Automatic platform detection (merged build only)

Not in the standalone Techfill 0.3. In the merged Moonfill 2.1 the preset is chosen automatically from the record's **Landing Page URL**; see `MERGED_BUILD.md` §7b for the full description. Summary: the orb asks the background to read the client's site and recognise one of 13 platforms (BigCommerce, Lightspeed, Magento, OpenCart, PrestaShop, Salesforce Commerce Cloud, Shopify, Shoplazza, Shopware 5, Shopware 6, Squarespace, Wix, WooCommerce); the matching preset (one of 15 ready-made presets: the six in §5.2 plus nine platform presets) becomes the active one; a small red message "PLATFORM DETECTED AUTOMATICALLY · <name>" appears beside the orb, the menu shows a red line and an `AUTO` tag. Presets for the nine added platforms use the team template values (eCommerce platform, Tag Management Solution `Other`, Deduplication Solution `Other` + "<Platform> plugin", Voucher and Product Level Tracking). Storage marker `presetsV` is 4.

## 17. Integration notes (merging into the integrator)

* Reusable engine: field lookup by label, control detection and setters, snapshot/verify/save/read-back, date helpers, Access decision, `{today}`/`{created}`. Keep their behaviour; they are pure DOM functions of the active Lightning page.
* Do **not** let two components write the same field. The ownership table in §3 is authoritative.
* Moonfill already contains a second, smaller copy of the field-writing engine (prefix `ff…`, overwrite semantics) for the five scan fields. In the merged product keep one engine with an `overwrite` flag per field.
* Storage keys here are un-prefixed (`presets`, `autoSave`, …); namespace them (e.g. `techfill.*`) when sharing a storage area with other modules.
* A merged UI should keep one orb and offer Techfill's Fill/Reset/Parameters plus Moonfill's scan status inside the same menu, using the shared palette (§13).
