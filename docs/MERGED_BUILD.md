# Merged build — Moonfill 2.1 (Moonfill 2.0 + Techfill 0.3)

> Audience: an AI agent or engineer who must understand the merged extension without reading the code.
> Read after `INTEGRATION_BRIEF.md`; the two product specifications (`MOONFILL_SPEC.md`, `TECHFILL_SPEC.md`) remain valid for each part.
> Status: exercised only against a mock Salesforce page (both scripts loaded together, no runtime errors, buttons/orb/badge/lock verified). **Not yet run on a real record.**

## 1. What it is

One Chromium MV3 extension, named **Moonfill**, version **2.1**, containing both products. The version was bumped from 2.0 because the posted promo line reads `Pasted via Moonfill v<manifest version>`, which now identifies the merged build. Techfill keeps its own version (0.3) inside the docs.

## 2. File map

| File | From | Role in the merged build |
|---|---|---|
| `manifest.json` | Moonfill | one manifest; Salesforce pages load **`salesforce.js` then `techfill.js`**; permissions unchanged (`tabs`, `storage`, `activeTab`, `scripting`, `webRequest`, `alarms`, `notifications`, `tabGroups`) |
| `background.js` | Moonfill | job pipeline as before, plus two message handlers: `openPresets`, `openMoonfillPopup` |
| `content.js` | Moonfill | Microsoft Forms filler (unchanged) |
| `salesforce.js` | Moonfill | buttons row, Case IR button, Chatter posting, scan-field fill — now wrapped by the shared edit lock |
| `techfill.js` | Techfill | the orb, preset menu, Fill, Reset, Parameters, report panels, plus scan badge/row and the shared edit lock |
| `popup.html`, `popup.js`, `css/style.css` | Moonfill | scans/history popup; new **Presets** button next to *History* |
| `techfill-core.js` | extracted from Techfill's popup script | the ready-made presets and helpers (`TechfillCore`), loaded **before** `techfill.js` on Salesforce pages and by `presets.html` |
| `presets.html`, `presets.js` | Techfill's former toolbar popup | the preset editor as a **fallback window** (500×780), used only when no Implementation record tab is available |

Everything else (assets, README) is as in Moonfill.

## 3. What the user sees

* **Salesforce Implementation record:** Moonfill's button row (Submit Moonpull form left, IR middle, New Implementation right) **and** Techfill's draggable orb.
* **Orb menu** (hover): preset list, **Fill**, **Reset**, **Parameters** (Standard/GTM presets only), then a one-line **Moonpull status** (`no scan running` / `N scans running` / `result ready, waiting for the browser` / `N failed, open to see why`; click opens Moonfill's popup) and an **Edit presets…** link that opens the **Presets panel** on the page (same style as Parameters: preset picker, Duplicate / Reset values / Delete with two-click confirmation, name, text, *Review first / Save automatically*; edits are saved as you type).
* **Clicking the orb** when the menu or any panel is open closes everything and leaves only the orb; clicking it when nothing is open pins the menu open.
* **Orb badge:** a small moon-yellow counter while Moonpull scans are active, a red `!` for 10 minutes after a failure.
* **Case page:** Moonfill's single IR button (unchanged).
* **Toolbar popup:** Moonfill's scans/history (unchanged) with a new **Presets** button: on an Implementation record tab it opens the Presets panel next to the orb; elsewhere it opens the editor window.
* Notifications are Moonfill's (unchanged).

## 4. How the two halves coordinate

### 4.1 Field ownership
Unchanged (see `INTEGRATION_BRIEF.md` §3): Moonfill owns Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF, Consent Management Platform (always overwritten from the latest scan result); Techfill owns the rest of the checklist (empty-only, plus Parameters overrides). Techfill's *Reset* testing tool also clears the five scan fields.

### 4.2 Edit lock (one writer at a time)
Both halves enter the record's edit mode and click Save, so they must never overlap. The lock is a DOM attribute on `<html>`: `data-awin-edit-lock="moonfill" | "techfill"`.

* **Techfill** (`runFill`, Fill and Reset): if the lock is held by Moonfill it refuses with the panel *"Moonfill is filling this record — wait a few seconds, then click again"*; otherwise it takes the lock for the run and releases it at the end.
* **Moonfill** (`fillMoonpullFields`): waits up to 30 s for a Techfill lock to clear; if it does not, the scan fields are not filled and the note *"Techfill is filling this record, so the scan fields were not filled (Force paste retries)"* is shown. Otherwise it takes the lock for its fill and releases it.

### 4.3 Techfill's review form
In *Review first* mode Techfill leaves the filled form open for the agent. It marks this with `<html data-techfill-open-edit="<recordId>">`. If a Moonpull result arrives meanwhile, Moonfill **fills the five scan fields into that open form but does not save** (so it never saves Techfill's unreviewed changes) and reports *"fields filled but not saved: Techfill's review form is open, click Save"*. The marker is removed when Techfill starts a new run or the record changes; Moonfill also requires a visible Save button before honouring it.

### 4.4 Scan status in the orb
`techfill.js` reads `chrome.storage.local` keys starting with `moonfillJob_` (Moonfill's job records) and listens to their changes; active states are `submitting`, `waiting`, `posting`, `waiting_browser`; a job counts as failed for 10 minutes after `finishedAt`. It only reads; Moonfill alone writes jobs.

## 5. Runtime messages added

| `action` | From → to | Effect |
|---|---|---|
| `openPresets` | popup → background | fallback: opens (or focuses) `presets.html` in a 500×780 popup window |
| `openPresetsPanel` | popup → Salesforce page (`techfill.js`) | opens the Presets panel; replies `{ok:true}` only when the orb exists on that page |
| `openMoonfillPopup` | orb → background | tries `chrome.action.openPopup()`, falls back to a popup window of `popup.html` |

All earlier Moonfill messages are unchanged (`MOONFILL_SPEC.md` §14).

## 6. Storage (union, no collisions)

Moonfill: `moonfillJob_<uuid>` (local), `moonfillTab_<tabId>` (session). Techfill: `presets`, `activePreset`, `autoSave`, `presetsV`, `dockPos`. The preset editor and the orb stay in sync through `storage.onChanged`.

## 7. Known duplication and follow-ups

1. **Two field-writing engines** live in the same content-script world: Moonfill's (`ff…` functions in `salesforce.js`, overwrite semantics, used for the five scan fields) and Techfill's (inside the `techfill.js` closure, with snapshot/verify/read-back safeguards). Merge them into one engine with a per-field `overwrite` flag; Techfill's is the safer base.
2. `techfill.js` here differs from the standalone Techfill 0.3 only by the merged-build additions (lock, marker, scan badge/row, Edit presets link). The standalone zip is superseded by this build.
3. The temporary-window issue (`MOONFILL_SPEC.md` §8.3) is unchanged.
4. The questions in `INTEGRATION_BRIEF.md` §7 (Platform Offer wording, Pixel Sent rule, AASAF rule) are still open.

## 8. Changes after the first merged build

* **Result is pasted sooner.** Polling stays at 10 s until 2:30 after submission and then runs every 2 s (previously a flat 10 s made the paste start up to 10 s after the result appeared). Revert by setting `POLL_FAST_MS = POLL_MS` in `background.js`.
* **Scan fields from a background tab.** When the result was posted from a background tab (page not visible), the field fill used to be skipped with "the page is not visible"; the tab is now brought forward once and the fill retried.
* **Presets panel on the page** instead of a window; **orb click closes everything**.

## 9. Test checklist for the merge (on a real record)

1. Open an Implementation record: both the button row and the orb appear; the orb menu shows the Moonpull status line.
2. Submit a Moonpull scan: the orb badge shows `1`; the menu line says `1 scan running`; when the result is posted the badge disappears.
3. During a scan's field-fill moment click Techfill's Fill: it refuses politely; after a few seconds it works.
4. Techfill in *Review first*, leave the form open, let a scan finish: the five scan fields are filled but not saved, with the note; click Save by hand.
5. *Presets* in the popup and *Edit presets…* in the orb both open the same editor window (second call focuses the existing one); editing a preset updates the orb menu.
6. A failed scan: red `!` badge, line `N failed, open to see why`, click opens Moonfill's popup.
7. Parameters change on a record that already has other values, then Fill: those fields are overwritten and stay changed after the job.
8. Open Parameters or Presets, then click the orb: menu and panel close, only the orb remains; hover does not reopen it until the pointer leaves and returns.
9. From the popup, *Presets* on a record tab opens the panel beside the orb; on another page it opens the window.
10. Time from "result appears in the folder" to "text in Chatter": a few seconds (2 s polling after 2:30).
