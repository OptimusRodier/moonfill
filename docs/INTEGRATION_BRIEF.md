# Integration brief — Moonfill and Techfill inside the integrator assistant

> **Merged build:** this specification describes the product as it was before the merge. In the merged extension (Moonfill 2.1) read `MERGED_BUILD.md` first: it lists what changed (shared edit lock, scan badge on the orb, preset editor opened from the popup).


> Audience: the team and the AI agent that will merge small Awin tools (Awin Helper and others) into one integrator assistant.
> Read this together with `moonfill/docs/SPEC.md` and `techfill/docs/SPEC.md`. Those two files describe each product completely; this file describes how they fit together and what to preserve when merging.

## 1. The two products in one paragraph each

**Moonfill** (v2.0) runs the *Moonpull scan* round trip from a Salesforce Implementation record: it submits the Microsoft Forms request, waits for the result file in SharePoint, posts it to the record's Chatter feed, fills five Salesforce fields from the result, and offers New Implementation / IR tab-group shortcuts (record page) and an IR shortcut (Case page).

**Techfill** (v0.3) fills the rest of the **technical checklist** on the same Implementation record from a per-platform preset, with safeguards (no stacking on unsaved edits, per-field verification, unexpected-change guard, Salesforce error reporting, read-back after save), a draggable orb UI, a Parameters panel for the Standard/GTM Yes/No fields, and a Reset tool for testing.

Both are Chromium MV3 extensions that act on the Salesforce Lightning org `https://awin.lightning.force.com`, on records of object `TSE__c` (and Moonfill also on `Case`). They share no code today and no storage.

## 2. How a typical implementation uses both

1. Agent opens the Implementation record.
2. **Techfill**: pick the platform preset (Standard, Shopify, WooCommerce, Magento, PrestaShop, GTM), optionally flip Yes/No parameters (Standard/GTM only), click **Fill** → the checklist is filled (empty fields only, plus fields the agent overrode in Parameters).
3. **Moonfill**: click **Submit Moonpull form** → ~3–5 minutes later the scan result is in Chatter and **Moonpull Status, Consent Signals, TCF Plugin, AASAF, Consent Management Platform** are set from it (overwriting).
4. **Moonfill** shortcuts (New Implementation / IR) open the Awin UI tabs for the MID.

The order of steps 2 and 3 does not matter because the two products write **disjoint field sets**.

## 3. Field ownership (authoritative)

| Field(s) | Owner | Write rule |
|---|---|---|
| Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF, Consent Management Platform | Moonfill | overwrite, from the latest Moonpull result (mapping in Moonfill SPEC §9.1) |
| SingleView Setup Type, SingleView Integration Status | Techfill | derived from the account type (below), fills if empty |
| All other checklist fields in Techfill's presets | Techfill | empty-only; overwrite only for fields the agent changed in Parameters |
| Successful Tracking Test, SingleView date/time-tracking fields, notes fields | the agent | never written (Techfill's *Reset* testing tool also never touches them) |

Rule of thumb for any merged component: **one owner per field; the owner decides overwrite vs empty-only.**

## 4. Business rules that must survive the merge

### 4.1 Moonpull result → fields (Moonfill)

* Moonpull Status ← `Enhanced Memory Cookie Status`: "on user consent" → Memory on user consent; "not found" → Critical; "appears immediately" → Healthy; "closed advertiser" → Warning; else Review in platform. Line absent → field untouched.
* Consent Signals ← `EnhancedCustomVariable_AfterConsent` (`true` → Yes, anything else/missing → No).
* Transparency & Consent Framework Plugin ← `EnhancedCustomVariable_AfterConsentAndRefresh` (`true` → Yes, else No).
* AASAF ← `Apple Site App Association` and `Android Site App Association`: Yes only if every present line is `1`; else No.
* Consent Management Platform ← `Enhanced CMP Details`: Cookiebot, Iubenda, OneTrust, Osano, Sourcepoint, Google Consent Mode if it matches (case/space/punctuation-insensitive), otherwise Other.

### 4.2 Is the account "Access"? (Techfill; planned for the merged product)

1. Read **Client Type**. If it is not Access (and not empty) → not Access.
2. If Client Type is Access → read **Platform Offer**. If Platform Offer is also Access → Access. If it is something else → **Platform Offer wins** (not Access). If Platform Offer cannot be read → treat as Access but flag that it could not be double-checked.
3. If Client Type is empty → Platform Offer decides; if both are empty → unknown (skip, report).
4. Access → SingleView Setup Type = `SV not activated` (Integration Status not written). Not Access → `MasterTag enabled` and `New`.

*Assumption to confirm:* the field label "Platform Offer" and the option text "Access".

### 4.3 Parameters (Techfill)

Only the Standard and GTM presets have a Parameters panel (e-commerce platform presets always keep every option). A value picked there is saved immediately, **persists after jobs**, and from then on **overwrites** the field on the record at the next Fill. The five Moonfill-owned fields are never shown there.

## 5. Shared technical conventions (keep when merging)

* **Salesforce page access.** Always scope to the *active* page container (`.oneContent.active`) and to *visible* elements: Lightning keeps previously opened records hidden in the DOM. Find fields by their label text (`.test-id__field-label` / `.slds-form-element__label`), never by position.
* **Safe writes.** Snapshot → write → verify the control shows the value → compare snapshot → save once → read back. Refuse to start when the form is already in edit mode (unless the tool itself left it open).
* **Visibility.** Writing needs a *visible* page. When the browser window is covered or minimized the page reports hidden; Moonfill parks the work, retries on focus, offers Force paste, and tries a temporary window (open issue, Moonfill SPEC §8.3).
* **Network traffic is explicit.** SharePoint reads (Moonfill) and, in the merged build, one GET of the client's landing page for platform detection (credentials omitted, cached, private hosts refused). The latter needs the broad `https://*/*` + `http://*/*` host permission — the widest permission of the extension; review it when merging into the integrator and keep any new traffic documented.
* **Palette.** Deep blue `#0b2354 → #1f54a2`, light blue `#17a7e8` / `#4cc3f5`, moon yellow `#f8d559`. Rounded pills, soft shadows, a dashed "stitched" ring on the orb.
* **UI model.** One draggable round **orb** (pen icon) that opens a menu on hover; no always-on panels; panels open only when asked (Parameters) or to report a result. Persist the orb position as ratios (`dockPos`) in extension storage.
* **Version stamps.** DOM ids and a `BUILD` stamp are used so a new script replaces UI left by an old script after an extension reload.
* **Storage.** Moonfill: `moonfillJob_<uuid>`, `moonfillTab_<tabId>` (session). Techfill: `presets`, `activePreset`, `autoSave`, `presetsV`, `dockPos` (un-prefixed — namespace them in the merged product, with a one-time migration).

## 6. What to reuse, what to avoid

| Reuse | Notes |
|---|---|
| Techfill field engine (lookup, control detection, setters, snapshot/verify/save/read-back, date helpers) | Add a per-field `overwrite` flag; Moonfill's scan fields use `true`. Moonfill carries a smaller copy of this engine (functions prefixed `ff`); replace it. |
| Moonfill job pipeline (form fill → response id → poll → post → fields) | Self-contained, event-driven, survives service-worker restarts through per-job storage. |
| Moonfill geo derivation | Large rule table (country → region → currency → fallback); keep as a data table. |
| New Implementation / IR URL lists | Taken from Awin Helper; the owner of Awin Helper should stay the single source. |

| Avoid | Why |
|---|---|
| Two components writing the same field | Last writer wins silently; use §3. |
| Fixed pixel positions for panels | Panels must open beside the open menu and never over the orb. |
| Posting to Chatter from a hidden tab | It fails; use the ladder in Moonfill SPEC §8.1. |
| Auto-saving when anything unexpected changed | Techfill refuses and tells the agent which field moved. |

## 7. Open questions for the merge

1. **Platform Offer wording** (§4.2) — confirm label and "Access" option text.
2. **Pixel Sent** — Techfill defaults to today's date (`{today}`); the colleague's checklist autofill uses the record's creation date (`{created}` is available in Techfill presets). Decide the rule.
3. **AASAF** — "Yes only if both association lines are 1" is the current reading; confirm.
4. **Platform auto-detection** — now implemented in the merged build (`MERGED_BUILD.md` §7b), without a permission prompt. Open points: review the broad host permission, and confirm the platform signs and the nine added platform presets' values with the process owner. It does not detect Google Tag Manager.
5. **Temporary window** for hidden browsers — unresolved (Moonfill SPEC §8.3); decide whether to rely on the occlusion flag, a notification-first flow, or a different mechanism.
6. **Overwrite policy** for Techfill's fields outside Parameters (currently empty-only).
7. Whether the integrator should expose the Moonpull scan status inside the orb menu (recommended) instead of a separate toolbar popup.

## 8. Test assets

* Moonfill: manual checklist (Moonfill SPEC §18) and the result-parser rules; a headless-browser preview was used only for UI layout.
* Techfill: Node tests for dates, comparison, Access decision, scan-field exclusion, overrides, migration; a headless-browser preview for the orb, menu, drag, persistence, Parameters and write-back (Techfill SPEC §16). Status: Moonfill's scan round trip (submit, wait, post) and Techfill's basic fill have been used by the author on real records. The newer parts — Moonfill's field fill and button row, Techfill's safeguards, orb, Parameters and Reset — have only been exercised against mock pages and unit tests, so the first real-record test of those is the next milestone.
