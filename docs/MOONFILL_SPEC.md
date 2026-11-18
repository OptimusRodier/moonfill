# Moonfill — product specification (v2.0)

> **Merged build:** this specification describes the product as it was before the merge. In the merged extension (Moonfill 2.1) read `MERGED_BUILD.md` first: it lists what changed (shared edit lock, scan badge on the orb, preset editor opened from the popup).


> Audience: an AI agent or engineer who must understand, operate, extend or merge this product **without reading the code**.
> Everything here describes behaviour implemented in `background.js`, `content.js`, `salesforce.js`, `popup.js`/`popup.html` and `manifest.json`.
> Statements marked **ASSUMPTION** or **OPEN ISSUE** are not verified or not solved and must be treated with care.

## 1. Purpose

Moonfill is a Chrome/Edge (Manifest V3) extension for Awin technical-services agents. It automates the **Moonpull integration scan** round trip that used to be manual:

1. On a Salesforce program (Implementation, object `TSE__c`) record the agent clicks **Submit Moonpull form**.
2. Moonfill opens the Microsoft Forms "Moonpull" request form, fills it (affiliate link, advertiser ID, geo, "Teams" delivery), submits it and closes the tab.
3. The scan runs on Awin's side and, ~3–5 minutes later, a Power Automate flow writes the **result as a text file** to a SharePoint folder (named after the Forms response ID) and also sends it through Teams.
4. Moonfill polls that folder every 10 seconds from the moment of submission, reads the file, **posts the result into the record's Chatter feed**, and **fills five Salesforce fields from the result**, then notifies the agent.

Typical saving (agent's own estimate): ~8 minutes of hands-on work per scan (≈5 min entering the form, ≈2 min copy/paste, ≈1 min changing fields), ~130 hours per year at 4–5 scans a day. The scan itself still takes the same time; Moonfill removes the babysitting.

Beyond the scan it also provides two **shortcut buttons** next to the scan button — **New Implementation** and **IR** (Internal Review) — which open sets of Awin UI tabs for the MID as a tab group, and a single **IR** button on the Salesforce **Case** page.

Non-goals: it does not decide the scan's content, does not edit the Moonpull flow, does not send anything to any server of its own, and does not fill the technical checklist (that is **Techfill**; see `INTEGRATION_BRIEF.md`).

## 2. Glossary

| Term | Meaning |
|---|---|
| MID | Awin advertiser (merchant) ID; digits. |
| Moonpull | Awin's automated integration scanner; produces a text result per advertiser. |
| Geo | Two-letter market code the Moonpull form asks for (e.g. `GB`). Derived from the record (§6.2). |
| Job | One scan, from the click to the posted result. Visible in the popup. |
| Response ID | Id of the Microsoft Forms submission; it is the **file name** of the result (`<ResponseId>.txt`). |
| Result file | The scan result text in the SharePoint folder (§7.3). Appears ~3–5 min after submission and is deleted by the flow ~30 s later. |
| Chatter | Salesforce feed on the record; where the result is posted. |
| Parked / `waiting_browser` | The result is ready but no browser window is visible, so posting waits. |
| Force paste | Manual retry of posting with the stored result text. |
| Scan fields | Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF, Consent Management Platform. |

## 3. Environment, permissions

* Chromium browsers (Chrome, Edge), MV3 service worker.
* Host permissions: `forms.office.com`, `forms.cloud.microsoft` (the form), `awin.lightning.force.com` (Salesforce), `zanox.sharepoint.com` (result files). The user must be **signed in** to SharePoint and Salesforce in the same browser; Moonfill reuses those sessions (`fetch` with `credentials: "include"`).
* Extension permissions and why: `tabs` (open/find/close tabs), `storage` (jobs), `activeTab`, `scripting`, `webRequest` (read the Forms response id from the submit response header), `alarms` (wake the worker), `notifications`, `tabGroups` (New Implementation / IR tab groups).
* No external servers. The only network calls are to SharePoint (read result), Salesforce (page itself), Forms (page itself).

## 4. Components

| File | Runs in | Role |
|---|---|---|
| `background.js` | service worker | job state machine, polling, reading the result, posting orchestration, notifications, badge, tab groups |
| `content.js` | Microsoft Forms pages | fills and submits the Moonpull form when the background says this tab is a Moonfill run |
| `salesforce.js` | Salesforce Lightning pages | detects the record, reads MID/geo/program, draws the buttons, posts to Chatter, fills fields |
| `popup.html`, `popup.js` | toolbar popup | shows running scans and history, Force paste / Copy result |
| `css/style.css` | popup | styling |

## 5. End-to-end flow

1. `salesforce.js` detects a `TSE__c` record page, reads MID/geo/program and injects the buttons (§6).
2. Click **Submit Moonpull form** → message `openForm` {url, mid, geo, program, recordId, recordUrl} → background opens the Forms URL in a focused tab (must be focused so Forms renders), stores per-tab info in `storage.session` and creates a **job** in state `submitting`.
3. `content.js` asks the background `moonfillShouldFill` (answered "fill" only for a tab created by Moonfill, before it was submitted and within 5 minutes of its creation). It waits up to ~45 s for the form fields, fills them, clicks submit after 2 s, and after the "Thank you" message waits 3 s and asks the background to close the tab (`closeTab`).
4. The background watches `webRequest.onHeadersReceived` for the Forms API response `POST … 201` whose `Location` header contains `responses(<id>)`; that id is the **response id**. Job → `waiting`, `submittedAt` set, polling starts.
5. **Polling**: GET the result file (§7.3) every 10 s from submission, and every **2 s from 2:30 onward** (the result normally lands 3–5 minutes after submission, so a result is noticed within ~2 s instead of up to 10 s). 404 = not ready. When found: safety check, clean, store text (+ parsed fields) on the job, then post (§8).
6. After a successful post the five fields are filled from the result (§9).
7. Job → `done`; notification "result pasted"; popup shows Complete. On failure → `failed` with a reason, sticky notification, Force paste available if a result was captured.

Timings: form fill ≈25 s; result appears ≈3–5 min after submit (it was ≈4:30–5:00 earlier, ≈3 min more recently); job times out **6.5 minutes** after submission ("no result after 6.5 minutes").

## 6. Salesforce record page

### 6.1 Detection and buttons

* Active on `https://awin.lightning.force.com/lightning/r/TSE__c/<recordId>/view`. A 1-second loop re-checks, so Lightning navigation is followed. It works inside the **active** page container (`.oneContent.active`) because Lightning keeps old record pages hidden in the DOM.
* It waits for: the MID link `a[href*="ui.awin.com/dashboard/awin/advertiser/<MID>"]`, the field label "Country of the program", and the first card body (`div.slds-card__body.slds-card__body_inner`), then injects one row `#moonfillSalesforceSection` (class `mf-row`) into that card body.
* The row is a flex container with `justify-content: space-between` and a row gap; button order **left → right**: **Submit Moonpull form** (deep blue gradient, 🌙), **IR** (moon-yellow gradient, dark-blue text, 🔎) exactly in the middle, **New Implementation** (light blue gradient, 🚀) at the far right. Column gap 24 px (`BUTTON_GAP_PX`). Rounded pills, hover lift. A `BUILD` stamp rebuilds buttons/styles left by an older build after an extension reload.
* Disabled (grey, tooltip "MID not found on this record") when no MID. MID shorter than 3 characters disables the Moonpull button. **New Implementation** and **IR** use the digits of the MID.
* Clicking **IR** sends `createIRTabs` {mid}; **New Implementation** sends `createNITabs` {mid} (§13).

### 6.2 Reading the record, deriving the geo

Fields are read by label (`.test-id__field-label` text, value in `lightning-formatted-text` / `.test-id__field-value`): **Country of the program**, **Region**, **Currency**. The MID comes from the dashboard link above. The **program name** is taken from a field labelled `Program` or `Program name`, else the record title, else the tab title.

`normalizeGeo(country, region, currency)` returns a geo code. Order of rules (first hit wins):

1. Country name found in the table below (case-insensitive) → its code.
2. The field already holds a supported code (`UK` → `GB`).
3. Variants by prefix: "united arab…"→AE, "united kingdom…"→GB, "united states…"→US, "korea…"→KR, "czech…"→CZ, "russia…"→RU, "viet…"→VN, "new zealand…"→NZ.
4. Unsupported Asian countries → `SG`: bangladesh, bhutan, brunei, burma, cambodia, east timor, hong kong, indonesia, laos, macao, macau, maldives, mongolia, myanmar, nepal, pakistan, sri lanka, taiwan, timor-leste.
5. Unsupported Gulf/Middle-East countries → `AE`: bahrain, iraq, israel, jordan, kuwait, lebanon, oman, qatar, saudi arabia, yemen. (names containing "saudi" too)
6. Otherwise use **region** and **currency**: if the currency is `USD*` and the region is Brazil, Global, US or empty → `US`. For *broad* regions (dach, eastern europe, nordics, global) the currency decides first, then the region; for other regions the region decides first, then the currency.
7. Fallback `GB`.

Supported geo codes (the Moonpull form accepts these): `GB`, `FR`, `DE`, `US`, `ES`, `IT`, `NL`, `BR`, `SE`, `PL`, `PT`, `AT`, `CH`, `IE`, `AE`, `AR`, `AU`, `BE`, `BG`, `BO`, `BY`, `CA`, `CL`, `CN`, `CO`, `CZ`, `DK`, `EC`, `EE`, `FI`, `GR`, `HR`, `HU`, `IN`, `JP`, `KR`, `LT`, `LV`, `MX`, `MY`, `NO`, `NZ`, `PE`, `PH`, `RU`, `SG`, `TH`, `TR`, `UA`, `VN`.

Country → geo:

| Country | Geo |
|---|---|
| United Kingdom | `GB` |
| France | `FR` |
| Germany | `DE` |
| United States | `US` |
| United States of America | `US` |
| Spain | `ES` |
| Italy | `IT` |
| Netherlands | `NL` |
| Brazil | `BR` |
| Sweden | `SE` |
| Poland | `PL` |
| Portugal | `PT` |
| Austria | `AT` |
| Switzerland | `CH` |
| Ireland | `IE` |
| United Arab Emirates | `AE` |
| Argentina | `AR` |
| Australia | `AU` |
| Belgium | `BE` |
| Bulgaria | `BG` |
| Bolivia | `BO` |
| Belarus | `BY` |
| Canada | `CA` |
| Chile | `CL` |
| China | `CN` |
| Colombia | `CO` |
| Czech Republic | `CZ` |
| Czechia | `CZ` |
| Denmark | `DK` |
| Ecuador | `EC` |
| Estonia | `EE` |
| Finland | `FI` |
| Greece | `GR` |
| Croatia | `HR` |
| Hungary | `HU` |
| India | `IN` |
| Japan | `JP` |
| South Korea | `KR` |
| Korea, Republic of | `KR` |
| Lithuania | `LT` |
| Latvia | `LV` |
| Mexico | `MX` |
| Malaysia | `MY` |
| Norway | `NO` |
| New Zealand | `NZ` |
| Peru | `PE` |
| Philippines | `PH` |
| Russia | `RU` |
| Russian Federation | `RU` |
| Singapore | `SG` |
| Thailand | `TH` |
| Turkey | `TR` |
| Türkiye | `TR` |
| Ukraine | `UA` |
| Vietnam | `VN` |
| Viet Nam | `VN` |
| Luxembourg | `BE` |

Region → geo (only when the country is not supported):

| Region | Geo |
|---|---|
| benelux | `BE` |
| brazil | `BR` |
| dach | `DE` |
| eastern europe | `PL` |
| france | `FR` |
| italy | `IT` |
| nordics | `SE` |
| spain | `ES` |
| uk | `GB` |
| us | `US` |

Currency → geo (only unambiguous currencies; EUR and USD are deliberately absent except the USD rule above):

| Currency | Geo |
|---|---|
| `GBP` | `GB` |
| `SEK` | `SE` |
| `NOK` | `NO` |
| `DKK` | `DK` |
| `PLN` | `PL` |
| `CHF` | `CH` |
| `CZK` | `CZ` |
| `HUF` | `HU` |
| `BGN` | `BG` |
| `HRK` | `HR` |
| `BRL` | `BR` |
| `MXN` | `MX` |
| `ARS` | `AR` |
| `CLP` | `CL` |
| `COP` | `CO` |
| `PEN` | `PE` |
| `BOB` | `BO` |
| `AUD` | `AU` |
| `NZD` | `NZ` |
| `CAD` | `CA` |
| `JPY` | `JP` |
| `KRW` | `KR` |
| `CNY` | `CN` |
| `INR` | `IN` |
| `MYR` | `MY` |
| `SGD` | `SG` |
| `THB` | `TH` |
| `TRY` | `TR` |
| `UAH` | `UA` |
| `RUB` | `RU` |
| `BYN` | `BY` |
| `PHP` | `PH` |
| `VND` | `VN` |
| `AED` | `AE` |

### 6.3 Case page: one IR button

On `https://awin.lightning.force.com/lightning/r/Case/<caseId>/view` a section `#moonfillCaseSection` with a single **IR** button is inserted just above the **Case Details** card. The MID is read from the field **Awin UI Link** inside the card titled **Program (Signed Product) Details** (must be digits, not `0`). If it is missing the button is greyed with the tooltip "MID not found in Program (Signed Product) Details yet" and the loop retries each second.

## 7. Microsoft Forms and the result file

### 7.1 Opening the form

URL (fixed, Awin's Moonpull request form): `https://forms.cloud.microsoft/pages/responsepage.aspx?id=07KaWlh7JUWYUdFycma616fCV2xjqwdEqzYTwuOkzBJUMU5JTTM1MTdVTVY5OVNKTk1TREtLU0wxUS4u&lang=en`.

### 7.2 Filling the form (`content.js`)

Questions are found by (case-insensitive) title text, with fallbacks if Forms changes markup:

| Question title contains | Value written |
|---|---|
| `Affiliate Link` | `https://www.awin1.com/cread.php?awinmid=<MID>&id=111` |
| `advertiser ID` | `<MID>` |
| `geo location` | `<GEO>` |
| `How do you want to receive the results` → option `Teams` | clicked |

After `input`/`change` events it waits 2 s, clicks the submit button (`button[data-automation-id="submitButton"]` or first button matching /submit/i), then watches for the thank-you message and closes the tab after 3 s. If a field cannot be found after ~45 s (plus a fresh burst on user activity) a red banner "🌙 Moonfill couldn't find: … The form's layout likely changed again — this needs a script update." is shown. The form is filled only when the background confirms this tab belongs to a run (no accidental fills on other forms).

### 7.3 Where the result is read

Folder (must end with `/`): `https://zanox.sharepoint.com/teams/Global-MoonpullI-Integration/Shared%20Documents/General/batch%20results%20use%20cases/Integartion%20Tests/Moonpull%20Integration%20dataCenter/` (the folder name really contains the typo "Integartion"). File: `<ResponseId>.txt`. Two attempts: the direct URL, then the SharePoint REST endpoint `…/_api/web/GetFileByServerRelativePath(decodedurl='…')/$value`. A 404 means "not ready". An HTML/login page, HTTP error or network error counts as an error; after **6 consecutive** errors a sticky notification "can't read the result folder" (click opens the SharePoint site to refresh the session) is shown and polling continues.

### 7.4 What a result looks like

Plain text. Lines used by Moonfill (others are posted as-is):

```
Your Moonpull Intergration scan is complete
Input:
Afiliate Link: https://www.awin1.com/cread.php?awinmid=<MID>&id=111
Advertiser ID: <MID>
Geo region: GB
Result:
Enhanced Memory Cookie Status: Cookie on user consent
Enhanced Script Status: Script appears immediately
Enhanced CMP Details: Generic CMP
Consent Signal/Variable: AWIN.Tracking.AdvertiserConsent
EnhancedCustomVariable_Immediate: false
EnhancedCustomVariable_AfterConsent: true
EnhancedCustomVariable_AfterConsentAndRefresh: true
Apple Site App Association: 1
Android Site App Association: 1
Extracted PublisherID: 111
AUDIT URL (external, Technical Serivce only): https://app.mnpll.com/#/reporting/audits/<id>/output-report
…
```

Safety check: if `Advertiser ID: <n>` in the file differs from the job's MID nothing is posted and the job fails ("result is for MID n, expected m"). Cleaning (`cleanResult`): CRLF → LF and, if the text starts with a "…scan is complete for:" line followed by a block before `Input:`, that block is removed. Posted text = `Pasted via Moonfill v<manifest version>` + newline + cleaned text (the promo line is never added twice).

## 8. Posting to Chatter

### 8.1 Strategy ladder (`postResultToRecord`)

Chatter needs a **visible** page. Moonfill tries, in order, and stops at the first success:

1. **Background tab, fast** — reuse a tab already showing the record, else open the record in an inactive tab. Short timeouts (tab 10 s, box 10 s, editor 8 s).
2. **Active tab, patient** — make the tab active in its window (does not steal OS focus) and retry with long timeouts (tab 30 s, box 20 s, editor 10 s).
3. **Temporary window** (`AUTO_WINDOW`, any retryable failure) — open the record in a new, focused window (1200×800), post, close the window. The page must report itself visible within 8 s.
4. **Park** — if the failure was "page not visible", the job goes to `waiting_browser`: notification "result ready", retried every 15 s whenever a browser window is focused, kept up to 8 hours. Any other failure → `failed`.

After a successful post the previously active tab is re-activated. If `AUTO_SHARE` is false, or field filling left an unsaved form, the tab/window is left open.

**Force paste** (popup button, or notification button) re-runs posting with the stored result text, bringing the tab forward **and focusing its window** (this is the only mode that takes OS focus).

### 8.2 Chatter steps (in the page, `postToChatter`)

1. Scope everything to the active page container and visible elements only.
2. If the editor is not showing: click the **Chatter** tab (`a[data-tab-value="collaborateTab"]`), wait for the editor `.forceChatterMessageBodyInputRichTextEditor .ql-editor` or the placeholder `span.bBody` "Share an update…".
3. Click the placeholder to expand the editor; insert the text; wait for the Share button `button.cuf-publisherShareButton.qe-textPostDesktop` to be enabled (8 s).
4. Click **Share**, then wait up to 15 s for the editor to empty (post confirmed).

Failure messages (shown in notifications/popup): "the page is not on the expected record", "the browser window is not visible", "Chatter tab not found on this record", "Chatter tab opened but the "Share an update..." box did not appear", "clicked "Share an update..." but the editor did not open", "could not insert the text into the editor", "the Share button stayed disabled", "clicked Share but could not confirm the post" (no retry, to avoid double posts).

### 8.3 Diagnostics

Each post attempt logs a step trace to the **service worker console** (`Moonfill post steps: background tab: … -> active tab: … -> temporary window opened -> temporary window: …`). No trace is shown in the popup.

**OPEN ISSUE — temporary window.** In the author's tests the temporary window did not visibly open when the browser was behind other apps and the flow fell back to the notification + Force paste. Hypotheses: (a) the OS refuses to bring a background app's new window to the front (Windows focus-stealing prevention), so the window opens occluded, reports "not visible" and is closed; (b) a failure that was not flagged retryable. Mitigations in place: every retryable failure now escalates to the window; real errors are traced. Suggested workaround to test: in Edge/Chrome disable the flag "Calculate window occlusion on Windows" (`#calculate-native-win-occlusion`) so covered windows still count as visible (not verified; may be locked by IT policy).

## 9. Filling Salesforce fields from the result

Runs on the same tab right after a successful Chatter post (message `moonfillFill` {recordId, fields, save: true}). It cannot be switched off in the UI (a build constant `FILL_FIELDS`). The result text is parsed in the background (`parseMoonpullFields`) when the file is read and stored on the job, so Force paste can still fill after the file is gone.

### 9.1 Mapping rules

| Salesforce field | Source line in the result | Rule |
|---|---|---|
| **Moonpull Status** | `Enhanced Memory Cookie Status` | contains "on user consent" → `Memory on user consent`; contains "not found" → `Critical`; contains "appears immediately" → `Healthy`; contains "closed advertiser" → `Warning`; anything else → `Review in platform`. If the line is absent the field is **not touched**. |
| **Consent Signals** | `EnhancedCustomVariable_AfterConsent` | `true` → `Yes`; anything else or missing → `No` |
| **Transparency & Consent Framework Plugin** | `EnhancedCustomVariable_AfterConsentAndRefresh` | `true` → `Yes`; anything else or missing → `No` |
| **AASAF** | `Apple Site App Association` and `Android Site App Association` | `Yes` only if every one of these lines present equals `1`; otherwise (a `0`, or none present) → `No` |
| **Consent Management Platform** | `Enhanced CMP Details` | if the value contains one of `Cookiebot`, `Iubenda`, `OneTrust`, `Osano`, `Sourcepoint`, `Google Consent Mode` (case/space/punctuation-insensitive) → that option; otherwise, or line missing → `Other` |

Line lookup is tolerant: the key may appear after bullets/bold markers, anywhere on its line; values are trimmed of `*`/`_`; CRLF accepted. Values are **always overwritten** on the record — the latest scan wins over anything already filled (these fields are not part of Techfill's presets or panel).

### 9.2 Execution

1. Require the page to be visible and on the same record.
2. Open the **Details** tab, expand collapsed sections, open edit mode (or reuse it). Fail → note "could not open edit mode on the Details tab".
3. If the result was posted from a **background tab** the page is not visible and the form cannot be edited: the background brings that tab forward once and retries the fill. For each field: wait up to 8 s for it to appear (sections can render late, expanding collapsed ones), then set it (picklist combobox, native select, radio; with overwrite). Fields that were not found or could not be set get a **second chance** after 1.5 s.
4. If nothing changed → click Cancel to leave edit mode. Otherwise click **Save** and wait up to 12 s for edit mode to close. If saving does not finish the form stays open (`keepOpen`) and the tab is not closed.
5. The report is logged in the Salesforce tab console (`[Moonfill] field fill: …`); the service worker logs `Moonfill fields sent: …`.

The success notification mentions the fields **only when something is wrong**: "fields to check: …", "not on the page: …", "fields not saved, check required fields", "Fields not filled: …", "not in the result: Moonpull Status".

## 10. Notifications and badge

| Title | When | Click | Buttons |
|---|---|---|---|
| Moonfill: result pasted | job done | opens/focuses the record | Check result |
| Moonfill: result ready | parked (no visible browser) | opens the popup | Force paste, Open Moonfill |
| Moonfill: scan failed | failed (sticky) | opens the popup | Force paste (only if a result was captured), Open Moonfill |
| Moonfill: can't read the result folder | 6 consecutive read errors (sticky) | opens the SharePoint site | — |

Ids encode `moonfill|<kind>|<jobId>|<time>` so clicks work after a worker restart. The toolbar icon badge shows the number of active jobs (amber background when a result is parked, dark blue otherwise) and a red "!" for 10 minutes after a failure.

## 11. Popup

Title "Moonpull scans" (History/Back toggles "Scan history"). One card per job: program or `MID <n>`, state text (e.g. "Result ready · waiting for the browser to be in front"), timestamps; failed or waiting jobs with a stored result show **Force paste** and **Copy result**. A completed card disappears from the main view after 1 minute and a failed one after 10 minutes; History keeps the last 50 finished jobs. Two small icon buttons open the author's portfolio page and the GitHub repository. **No settings.**

## 12. State

`chrome.storage.local`: one key per job `moonfillJob_<uuid>`: `{ id, program, mid, geo, recordId, recordUrl, startedAt, state, errors, responseId, submittedAt, postingAt, resultText, fields[{label,value}], trace[], error, note, finishedAt, fillNote }`. States: `submitting` → `waiting` → `posting` → (`done` | `waiting_browser` | `failed`). `resultText`/`fields` are deleted on `done`. A job stuck in `posting` for 3 minutes while no post is actually running is failed as "posting was interrupted, check Chatter" (the stored result still allows Force paste).
`chrome.storage.session`: `moonfillTab_<tabId>` = per-form-tab info `{ mid, geo, program, recordId, recordUrl, jobId, at, submitted }`.

## 13. New Implementation and IR tab groups

`createNITabs`/`createIRTabs` {mid} open the following URLs in **inactive** tabs, group them (`tabs.group`), title the group `<MID>` (New Implementation, colour **cyan**) or `<MID> IR` (IR, colour **orange**). URL lists were taken from the Awin Helper extension.

New Implementation: `https://ui.awin.com/` + `tracking-settings/us/awin/advertiser/<MID>/main-settings`, `awin/merchant/<MID>/settings/invite-user`, `commission-manager/us/awin/merchant/<MID>/commission-groups`, `advertiser-mastertag/us/awin/<MID>/plugins`, `advertiser-mastertag/us/awin/<MID>/trackingtagsettings`, `provider/merchant-settings/<MID>/account-details/network/awin`, `provider/finance/fee-manager/en/<MID>`, `provider/merchant-settings/<MID>/mobile-tracking/network/awin`, `provider/migrated-advertiser-settings/<MID>`, `provider/pre-join-publishers?advertiserId=<MID>`.

IR: `https://ui.awin.com/` + `tracking-settings/us/awin/advertiser/<MID>/main-settings`, `commission-manager/us/awin/merchant/<MID>/commission-groups`, `advertiser-mastertag/us/awin/<MID>/plugins`, `awin/merchant/<MID>/validate-pending/network/awin`, `advertiser-integration-tool/trackingwizard/us/awin/merchant/<MID>`, `provider/test-transactions`, `provider/merchant-settings/<MID>/account-details/network/awin`, `provider/merchant-settings/<MID>/mobile-tracking/network/awin`, `provider/finance/fee-manager/en/<MID>`, `provider/pre-join-publishers?advertiserId=<MID>`, `provider/migrated-advertiser-settings/<MID>`.

## 14. Message protocol (runtime messages)

| `action` | From → to | Payload |
|---|---|---|
| `openForm` | Salesforce page → background | url, mid, geo, program, recordId, recordUrl |
| `moonfillShouldFill` | Forms page → background | (reply `{fill, advertiserID, geo}`) |
| `closeTab` | Forms page → background | — |
| `forcePost` | popup / notification → background | jobId |
| `createNITabs`, `createIRTabs` | Salesforce page → background | mid |
| `moonfillPost` | background → Salesforce page | text, recordId, share, options (fast, activated, visibleWaitMs) |
| `moonfillFill` | background → Salesforce page | recordId, fields, save |

## 15. Configuration constants (`background.js`)

| Constant | Value | Meaning |
|---|---|---|
| `POLL_MS` | 10 s | polling interval from submission until `FAST_AFTER_MS` (must stay < ~15 s; the file lives ~30 s) |
| `POLL_FAST_MS` / `FAST_AFTER_MS` | 2 s / 150 s | faster polling once the result is due, so pasting starts right after it appears |
| `JOB_TIMEOUT_MS` | 6.5 min | give up waiting for the result |
| `PARKED_TIMEOUT_MS` | 8 h | how long a waiting result is kept |
| `PARK_RETRY_MS` | 15 s | retry of a parked result while a browser window is focused |
| `AUTO_SHARE` | true | click Share (false: paste only, leave tab open) |
| `AUTO_WINDOW` | true | temporary window fallback |
| `FILL_FIELDS` | true | fill the five fields after posting |
| `HISTORY_MAX` | 50 | finished jobs kept |
| `FAILED_BADGE_MS` | 10 min | "!" badge duration |
| `BUTTON_GAP_PX` (`salesforce.js`) | 24 | gap between the three buttons |

## 16. Design tokens

Deep blue `#0b2354 → #1f54a2` (Submit Moonpull form), light blue `#17a7e8` (New Implementation, app colour), moon yellow `#f8d559 → #f5b933` with dark-blue text `#0b2354` (IR). Popup uses the same header colours. Techfill uses the same palette.

## 17. Known limitations

1. **OPEN ISSUE**: temporary window (§8.3).
2. The Microsoft Forms question titles and `data-automation-id` attributes can change; the red banner reports it.
3. The result folder URL and the flow's file naming are hard-coded; a change of the flow requires a code change.
4. SharePoint/Salesforce sessions must be valid; otherwise the notification "can't read the result folder".
5. The scan-field fill uses Lightning's standard edit markup and was exercised against mock pages; verify on a real record (Details tab, edit mode, Save).
6. `AASAF` rule assumes both association files must be present (both `1`) for Yes — confirm with the process owner if one file should suffice.
7. If the Moonpull flow's file format changes, the mapping rules in §9.1 need updating.

## 18. Test checklist

1. Record with MID: three buttons appear (Moonpull left, IR middle, New Implementation right); record without MID: greyed.
2. Submit: form opens, fills, submits, closes (≈25 s); popup shows the job.
3. Result appears (≈3–5 min): posted in Chatter with the first line `Pasted via Moonfill v…`; notification; the five fields set and saved (try results with each Memory Cookie status and with missing lines).
4. Result for a different MID → nothing posted, failed card.
5. Edge behind another app: expect either the temporary window or "result ready" + Force paste.
6. Force paste, Copy result, History.
7. Case page: single IR button above Case Details.
8. New Implementation / IR open grouped tabs (cyan "<MID>" / orange "<MID> IR").

## 19. Integration notes

See `INTEGRATION_BRIEF.md`. In short: keep one field-writing engine with a per-field `overwrite` flag (Moonfill's scan fields overwrite, Techfill's checklist fields fill empty-only), keep the ownership table, namespace storage keys (`moonfillJob_*`, `moonfillTab_*` already are), and share the palette and the orb.
