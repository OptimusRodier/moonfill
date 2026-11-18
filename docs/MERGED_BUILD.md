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
| `detect-platform.js` | adapted from the colleague's Checklist Autofill | platform detection, loaded by `background.js` with `importScripts` (`PlatformDetect`) |
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

## 7b. Automatic platform detection

**What the agent sees:** open an Implementation record and, a moment later, the preset is already the right one. A small **red** message appears beside the orb for 9 seconds — a bolt icon, `PLATFORM DETECTED AUTOMATICALLY` and the platform name — and the menu shows a red line `⚡ Detected automatically: <platform>` plus a red `AUTO` tag on the selected preset. Nothing to click, no permission prompt; **Fill** is ready. If nothing is recognised the menu shows a grey `Platform not detected: pick it from the list` and the current preset is kept.

**How it works**
1. `techfill.js` (every second, once per record, only while the page is visible) reads the record field **Landing Page URL** (the link address is preferred over the displayed text; a bare `shop.com` is accepted).
2. It sends `{ action: "detectPlatform", url }` to the background, which runs `PlatformDetect.run(url)`:
   * refuses non-web addresses and private/local hosts (`localhost`, `*.local`, `10.x`, `127.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, IPv6 literals);
   * answers from the **session cache** when the site was seen recently (12 h when a platform was found, 1 h when not);
   * otherwise downloads the page once with `fetch` (credentials omitted, redirects followed, 8 s timeout, response headers + HTML, first 1.5 M characters);
   * counts, per platform, how many of its **signs** (regular expressions) appear; the platform with the most wins; a tie or no match = not detected;
   * if nothing was found **and** the fetch failed or returned a small page (< 20 000 characters, likely script-rendered), re-reads the page once in an **inactive background tab** (waits for load + 1.5 s, reads the DOM and a few JavaScript globals, closes the tab; 15 s limit).
3. The answer `{ name | null, reason, via }` goes back to the orb, which maps the name to a preset key (`TechfillCore.PLATFORM_KEYS`), makes sure that preset exists (`upgradePresets`), sets it as `activePreset`, and shows the red message. Once per record: after detection the agent can still pick another preset by hand and it will not be overridden until the next record.

**Platforms and presets (13).** BigCommerce, Lightspeed, Magento, OpenCart, PrestaShop, Salesforce Commerce Cloud, Shopify, Shoplazza, Shopware 5, Shopware 6, Squarespace, Wix, WooCommerce. Shopify, WooCommerce, Magento and PrestaShop keep Techfill's original presets. The other nine are **ready-made presets** added with detection (preset keys `bigcommerce`, `lightspeed`, `opencart`, `sfcc`, `shoplazza`, `shopware5`, `shopware6`, `squarespace`, `wix`); they take the same text as every preset with the team template values of the Checklist Autofill for: eCommerce platform, Tag Management Solution (`Other`), Deduplication Solution (`Other`) with `Other Deduplication Solution = <Platform> plugin`, Voucher Tracking implemented, Product Level Tracking implemented. None of them has a Parameters button. A fresh install or an old saved list is brought up to date automatically (`presetsV` 4): all 15 presets exist without opening the popup.

**Permissions.** The manifest now declares `host_permissions` for `https://*/*` and `http://*/*` so the background can read client sites without any user prompt. This is the **widest permission of the extension**: review it before the merge into the integrator. Nothing from the client's site is stored (only the platform name, in session storage) or sent anywhere; the only network request is the GET of the landing page.

**Messages.** `detectPlatform` (orb → background).

**Limits.** The signs are best guesses taken from the colleague's project (adjust them in `detect-platform.js` when a site is detected wrongly). Sites behind bot protection, logins or geo-blocks may not be readable; a site that mixes several platforms' signs equally is reported as not detected. Detection does not detect Google Tag Manager, so GTM stays a manual choice. Verified only with offline fixtures (all 13 platforms, ties, no match, cache, tab fallback with stubs); **no live site has been read yet**.

## 8. Changes after the first merged build

* **Result is pasted sooner.** Polling stays at 10 s until 2:30 after submission and then runs every 2 s (previously a flat 10 s made the paste start up to 10 s after the result appeared). Revert by setting `POLL_FAST_MS = POLL_MS` in `background.js`.
* **Scan fields from a background tab.** When the result was posted from a background tab (page not visible), the field fill used to be skipped with "the page is not visible"; the tab is now brought forward once and the fill retried.
* **Presets panel on the page** instead of a window; **orb click closes everything**.

## 9. Test checklist for the merge (on a real record)

0. (Detection) Open records whose Landing Page URL is a Shopify site, a WooCommerce site and a custom site: the first two select their preset with the red message; the custom one shows the grey "not detected" line.

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
