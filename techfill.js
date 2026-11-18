// techfill.js (v0.3, merged build: runs next to Moonfill's salesforce.js)
// Fills the technical checklist on an Implementation (TSE__c) record from a saved preset.
// Full specification: docs/SPEC.md. Summary of the rules:
//  - Only empty fields are filled, except fields the user changed in the Parameters panel (those overwrite).
//  - Moonpull Status, Consent Signals, TCF Plugin, AASAF and Consent Management Platform belong to
//    Moonfill (latest Moonpull result) and are never written here.
//  - SingleView fields follow the account type: Client Type, double-checked with Platform Offer.
//  - Safeguards: refuses to start on top of unsaved edits, verifies every written value, aborts the
//    save if anything else on the form changed, reports Salesforce's own error, reads values back.
//  - UI: a draggable round button (orb) that opens a menu on hover.
(() => {
  "use strict";

  const RECORD_RE = /\/r\/TSE__c\/([a-zA-Z0-9]+)\/view/;
  const DOCK_ID = "techfill-dock";
  const BTN_ID = "techfill-btn";
  const RESET_ID = "techfill-reset";
  const ORB_ID = "techfill-orb";
  // Shared with Moonfill (same extension): one writer at a time on the record, and Moonfill must not
  // auto-save a review form Techfill left open.
  const LOCK_ATTR = "awinEditLock";
  const OPEN_ATTR = "techfillOpenEdit";
  const SCAN_PREFIX = "moonfillJob_";
  const SCAN_ACTIVE = ["submitting", "waiting", "posting", "waiting_browser"];
  const PARAMS_ID = "techfill-params";
  const PARAM_KEYS = ["standard", "gtm"]; // e-commerce presets always keep every option, so no Parameters for them
  let paramsOpen = false;
  let selfWrite = false;
  const ORB = 46;      // size of the floating button
  const EDGE = 8;      // keep this far from the window edge
  const BUILD = "0.4-merged"; // internal stamp: a dock built by an older build is rebuilt
  const SEL_ID = "techfill-preset";
  const PANEL_ID = "techfill-panel";
  const STYLE_ID = "techfill-style";
  const SAVE = 'button[name="SaveEdit"]';
  const CANCEL = 'button[name="CancelEdit"]';
  const SAVE_ERROR = "records-record-edit-error, .forceFormPageError, .pageLevelErrors, .slds-popover_error, .slds-has-error .slds-form-element__help, .save-error";
  let running = false;
  let ownEditFor = null; // record where Techfill itself left the form in edit mode (review mode)
  let footerOutsideTab = false; // some layouts draw the Save footer outside the Details tab

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  async function waitFor(fn, timeoutMs = 8000, interval = 200) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function realClick(el) {
    ["mousedown", "mouseup", "click"].forEach((type) =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
  }

  // Lightning keeps visited record pages in the DOM, hidden: only look inside the active one
  const root = () => document.querySelector(".oneContent.active") || document;
  const visibleAll = (sel) => Array.from(root().querySelectorAll(sel)).filter(isVisible);

  // The content of the Details tab. Everything we click or fill lives in here, so the
  // "Key Fields" box at the top of some records (its own Edit / pencil) is never touched.
  function detailsPanel() {
    const tab = visibleAll('a[data-tab-value="detailTab"]')[0];
    if (!tab || tab.getAttribute("aria-selected") !== "true") return null;
    const id = tab.getAttribute("aria-controls");
    const byId = id && document.getElementById(id);
    if (byId && isVisible(byId)) return byId;
    return visibleAll('[role="tabpanel"]').find((p) => p.querySelector(".test-id__field-label, .slds-form-element__label")) || null;
  }
  const scope = () => detailsPanel() || root();
  const inScope = (sel) => Array.from(scope().querySelectorAll(sel)).filter(isVisible);

  const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\*/g, "").trim().toLowerCase();

  function labelText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll(".slds-assistive-text, lightning-helptext, abbr, button, svg").forEach((n) => n.remove());
    return norm(c.textContent);
  }

  function toBool(v) {
    if (/^(true|yes|y|1|checked|on)$/i.test(v)) return true;
    if (/^(false|no|n|0|unchecked|off)$/i.test(v)) return false;
    return null;
  }

  // Current value of a field box (lower-cased), whether the form is in view or edit mode
  function valueOfBox(box) {
    const checkbox = box.querySelector('input[type="checkbox"]');
    if (checkbox) return checkbox.checked ? "true" : "false";
    const radios = Array.from(box.querySelectorAll('input[type="radio"]'));
    if (radios.length) {
      const on = radios.find((r) => r.checked);
      return on ? norm((on.closest(".slds-radio") || on.parentElement).textContent) : "";
    }
    const combo = box.querySelector('button[role="combobox"]');
    if (combo) return norm(combo.textContent).replace(/^--none--$/, "");
    const select = box.querySelector("select");
    if (select) return select.selectedOptions[0] ? norm(select.selectedOptions[0].text) : "";
    const input = box.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
    if (input) return norm(input.value);
    const v = box.querySelector("lightning-formatted-text, .test-id__field-value, .slds-form-element__static");
    return v ? norm(v.textContent) : "";
  }
  function readValue(label) {
    const box = findFieldBox(label);
    return box ? valueOfBox(box) : "";
  }

  // ---------- dates ----------
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const pad2 = (n) => String(n).padStart(2, "0");
  function isoDate(y, m, d) {
    y = Number(y) < 100 ? Number(y) + 2000 : Number(y); m = Number(m); d = Number(d);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  const monthOf = (name) => { const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase()); return i < 0 ? null : i + 1; };
  // First date in a text as YYYY-MM-DD, or null. Reads 2026-11-03, 03/11/2026 (day first),
  // 3 Nov 2026 and Nov 3, 2026; anything after the date (a time) is ignored.
  function parseDate(text) {
    const s = String(text == null ? "" : text);
    let m;
    if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return isoDate(m[1], m[2], m[3]);
    if ((m = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/))) return isoDate(m[3], m[2], m[1]);
    if ((m = s.match(/\b(\d{1,2})\.?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b/)) && monthOf(m[2])) return isoDate(m[3], monthOf(m[2]), m[1]);
    if ((m = s.match(/\b([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/)) && monthOf(m[1])) return isoDate(m[3], monthOf(m[1]), m[2]);
    return null;
  }
  const formatDate = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  // Does the page show what we meant to write? true / false / null (a date shown in a format we can't read)
  function compareValues(expected, shown) {
    const e = norm(expected);
    const sh = norm(shown).replace(/^--none--$/, "");
    if (e === sh) return true;
    const de = parseDate(expected);
    if (de) {
      const ds = parseDate(shown);
      if (ds) return de === ds;
      if (/\d/.test(sh)) return null;
    }
    return false;
  }
  // ---------- end dates ----------

  // The record's creation date: the "Created." line of its Implementation History box.
  // { date: "YYYY-MM-DD" } or { reason }. Hidden content is read too (the box may sit on another tab).
  function createdDate() {
    const HEAD = "h1, h2, h3, h4, span, button, a, legend, [role='heading']";
    const CARD = "article, .slds-card, lst-related-list-single-container, force-related-list-single-container, section";
    const ROW = "tr, [role='row'], li, .slds-tile";
    const title = "implementation history";
    const cards = [...new Set(Array.from(root().querySelectorAll(HEAD))
      .filter((e) => { const t = norm(e.textContent); return t === title || t.startsWith(title + " ("); })
      .map((e) => e.closest(CARD)).filter(Boolean))];
    if (!cards.length) return { reason: 'no "Implementation History" box on this record (if it is on the Related tab, open that tab once, then come back to Details)' };
    const rows = new Set();
    for (const card of cards) {
      for (const e of card.querySelectorAll("*")) {
        const t = norm(e.textContent);
        if (t !== "created." && t !== "created") continue;
        const row = e.closest(ROW);
        if (row && card.contains(row)) rows.add(row);
      }
    }
    const dates = [...new Set([...rows].map((r) => parseDate(r.textContent)).filter(Boolean))];
    if (dates.length === 1) return { date: dates[0] };
    return { reason: dates.length ? `"Implementation History" shows ${dates.length} different creation dates` : 'no "Created." line with a date in "Implementation History" (it may only show under View All)' };
  }

  // These five fields belong to Moonfill: they always come from the latest Moonpull scan result,
  // which overwrites whatever is on the record. Techfill never writes them and never lists them.
  const SCAN_OWNED = ["Moonpull Status", "Consent Signals", "Transparency & Consent Framework Plugin", "AASAF", "Consent Management Platform"];
  const SCAN_OWNED_KEYS = new Set(SCAN_OWNED.map((l) => norm(l)));

  // Is the account Access? Client Type decides first. When Client Type says Access, Platform Offer
  // must agree: if it does not, Platform Offer wins (not Access). With no Client Type, Platform Offer decides.
  // Returns { access: true | false | null (cannot tell), note }
  function accessDecision(clientType, platformOffer) {
    const ct = norm(clientType);
    const po = norm(platformOffer);
    if (ct && ct !== "access") return { access: false, note: `Client Type "${clientType}" (not Access)` };
    if (ct === "access") {
      if (!po) return { access: true, note: "Client Type Access (Platform Offer not found, not double-checked)" };
      if (po === "access") return { access: true, note: "Access (Client Type and Platform Offer agree)" };
      return { access: false, note: `Client Type says Access but Platform Offer is "${platformOffer}": Platform Offer wins, not Access` };
    }
    if (po) return { access: po === "access", note: `Client Type empty, Platform Offer "${platformOffer}" decides` };
    return { access: null, note: "Client Type and Platform Offer not found" };
  }

  // SingleView fields follow the account type (see accessDecision):
  //   Access          -> Setup Type "SV not activated", Integration Status skipped
  //   anything else   -> Setup Type "MasterTag enabled", Integration Status "New"
  function singleViewEntries(isAccess) {
    if (isAccess) return [{ label: "SingleView Setup Type", value: "SV not activated" }];
    return [
      { label: "SingleView Setup Type", value: "MasterTag enabled" },
      { label: "SingleView Integration Status", value: "New" }
    ];
  }

  // {today} in a value becomes today's date as dd/mm/yyyy
  function todayString() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // ---------- preset text -> list of { label, value } ----------
  // One line per field:  Field label = value     (# starts a comment, empty values are skipped)
  // overrides: labels the user changed in the Parameters panel. Those overwrite what is already on the record.
  function parsePreset(text, overrides) {
    const force = new Set((overrides || []).map((l) => norm(l)));
    const out = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 1) continue;
      const label = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/\{today\}/gi, todayString());
      if (!label || !value || SCAN_OWNED_KEYS.has(norm(label))) continue; // scan fields are Moonfill's
      out.push({ label, value, created: /\{created\}/i.test(value), force: force.has(norm(label)) });
    }
    return out;
  }

  // ---------- finding a field and its control ----------
  function findFieldBox(label) {
    const want = norm(label);
    const labels = scope().querySelectorAll(".slds-form-element__label, .slds-form-element__legend, .test-id__field-label");
    for (const l of labels) {
      if (!isVisible(l) || labelText(l) !== want) continue;
      const box = l.closest(".slds-form-element");
      if (box) return box;
    }
    return null;
  }

  function controlOf(box) {
    if (box.querySelector(".slds-dual-listbox")) return { kind: "multi" };
    const checkbox = box.querySelector('input[type="checkbox"]');
    if (checkbox) return { kind: "checkbox", el: checkbox };
    const radios = Array.from(box.querySelectorAll('input[type="radio"]'));
    if (radios.length) return { kind: "radio", els: radios };
    const combo = box.querySelector('button[role="combobox"]');
    if (combo) return { kind: "combobox", el: combo };
    const select = box.querySelector("select");
    if (select) return { kind: "select", el: select };
    if (box.querySelector('input[role="combobox"]')) return { kind: "lookup" };
    const text = box.querySelector(
      "textarea, input:not([type]), input[type='text'], input[type='number'], input[type='url'], input[type='email'], input[type='tel']"
    );
    if (text) return { kind: "text", el: text };
    return null;
  }

  // ---------- guard: has anything else on the form changed? ----------
  // Values of every editable field in the Details tab except the ones we write. Taken before
  // and after filling: a difference means a dependent field moved (or something else is writing
  // to the record), and then nothing is saved automatically.
  const boxLabel = (box) => {
    const l = box.querySelector(".slds-form-element__label, .slds-form-element__legend, .test-id__field-label");
    return l ? labelText(l) : "";
  };
  function snapshotForm(skipLabels) {
    const out = {};
    const counts = {};
    for (const box of Array.from(scope().querySelectorAll(".slds-form-element")).filter(isVisible)) {
      const label = boxLabel(box);
      if (!label || skipLabels.has(label) || !controlOf(box)) continue;
      const lookup = box.querySelector('input[role="combobox"]');
      counts[label] = (counts[label] || 0) + 1;
      out[`${label}#${counts[label]}`] = lookup ? norm(lookup.value) : valueOfBox(box);
    }
    return out;
  }
  function firstDifference(before, after) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] !== after[key]) return key.replace(/#\d+$/, "");
    }
    return null;
  }
  // After writing a field: does the control really show the new value? (up to 3 s)
  async function keptValue(e) {
    return !!(await waitFor(() => {
      const box = findFieldBox(e.label);
      if (!box) return false;
      const c = controlOf(box);
      if (!c) return true;
      if (c.kind === "checkbox") { const want = toBool(e.value); return c.el.checked === (want === null ? false : want); } // empty = unchecked
      if (c.kind === "radio") return true;
      return compareValues(e.value, valueOfBox(box)) !== false;
    }, 3000, 150));
  }

  // ---------- setters: each returns { status, why? } ----------
  // status: set | same | kept (already had another value) | problem
  function setCheckbox(el, value, overwrite) {
    const want = toBool(value);
    if (want === null) return { status: "problem", why: "use true or false" };
    if (el.checked === want) return { status: "same" };
    if (el.checked && !overwrite) return { status: "kept" };
    el.click();
    return { status: "set" };
  }

  function setText(el, value, overwrite) {
    const current = el.value.trim();
    if (current === value) return { status: "same" };
    if (current && !overwrite) return { status: "kept" };
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    el.focus();
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur(); // dates and some text fields only commit the value on blur
    return { status: "set" };
  }

  function setRadio(radios, value, overwrite) {
    const textOf = (r) => norm((r.closest(".slds-radio") || r.parentElement).textContent);
    const target = radios.find((r) => textOf(r) === norm(value));
    if (!target) return { status: "problem", why: `option "${value}" not found` };
    if (target.checked) return { status: "same" };
    if (radios.some((r) => r.checked) && !overwrite) return { status: "kept" };
    target.click();
    return { status: "set" };
  }

  function setSelect(sel, value, overwrite) {
    const curText = sel.selectedOptions[0] ? norm(sel.selectedOptions[0].text) : "";
    if (curText === norm(value)) return { status: "same" };
    const empty = !sel.value || /^(|--none--|select an option|none)$/.test(curText);
    if (!empty && !overwrite) return { status: "kept" };
    const opt = Array.from(sel.options).find((o) => norm(o.text) === norm(value) || norm(o.value) === norm(value));
    if (!opt) return { status: "problem", why: `option "${value}" not in the list` };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { status: "set" };
  }

  function comboOptions(btn) {
    const scopeEl = btn.closest(".slds-combobox") || btn.closest(".slds-form-element") || root();
    return Array.from(scopeEl.querySelectorAll('[role="option"], lightning-base-combobox-item')).filter(isVisible);
  }
  function optionText(o) {
    const c = (o.querySelector(".slds-truncate, .slds-media__body") || o).cloneNode(true);
    c.querySelectorAll(".slds-assistive-text, svg, lightning-icon").forEach((n) => n.remove());
    return norm(c.textContent);
  }
  const optionMatches = (o, want) => {
    const w = norm(want);
    return optionText(o) === w || norm(o.getAttribute("data-value")) === w;
  };

  async function setCombobox(btn, value, overwrite) {
    const current = norm(btn.textContent);
    const empty = /^(|--none--|select an option|select\.\.\.|none)$/.test(current);
    if (current === norm(value)) return { status: "same" };
    if (!empty && !overwrite) return { status: "kept" };

    // two tries: the first click can be swallowed (e.g. by a date picker that is still closing)
    let opt = null;
    for (let attempt = 0; attempt < 2 && !opt; attempt++) {
      btn.click(); // open the list
      opt = await waitFor(() => comboOptions(btn).find((o) => optionMatches(o, value)), 2500, 150);
      if (!opt) {
        if (btn.getAttribute("aria-expanded") === "true") btn.click(); // close it again
        await sleep(250);
      }
    }
    if (!opt) {
      btn.click();
      await sleep(300);
      const seen = comboOptions(btn).map(optionText).filter(Boolean);
      if (btn.getAttribute("aria-expanded") === "true") btn.click();
      return {
        status: "problem",
        why: seen.length
          ? `option "${value}" not in the list (saw: ${seen.slice(0, 8).join(" | ")})`
          : "the dropdown did not open"
      };
    }
    realClick(opt);
    await sleep(200);
    return { status: "set" };
  }

  async function applyField({ label, value }, overwrite) {
    const box = findFieldBox(label);
    if (!box) return { status: "notfound" };
    const c = controlOf(box);
    if (!c) return { status: "problem", why: "no editable control (read-only?)" };
    try {
      switch (c.kind) {
        case "checkbox": return setCheckbox(c.el, value, overwrite);
        case "radio": return setRadio(c.els, value, overwrite);
        case "combobox": return await setCombobox(c.el, value, overwrite);
        case "select": return setSelect(c.el, value, overwrite);
        case "text": return setText(c.el, value, overwrite);
        case "multi": return { status: "problem", why: "multi-select list is not supported yet" };
        case "lookup": return { status: "problem", why: "lookup field is not supported yet" };
        default: return { status: "problem", why: "unknown field type" };
      }
    } catch (e) {
      return { status: "problem", why: String((e && e.message) || e) };
    }
  }

  // Reset (for testing): put a field back to --None-- / empty / unchecked. Radios cannot be cleared.
  async function clearField({ label }) {
    const box = findFieldBox(label);
    if (!box) return { status: "notfound" };
    const c = controlOf(box);
    if (!c) return { status: "problem", why: "no editable control (read-only?)" };
    try {
      switch (c.kind) {
        case "checkbox": return setCheckbox(c.el, "false", true);
        case "combobox": return await setCombobox(c.el, "--None--", true);
        case "text": return setText(c.el, "", true);
        case "select": {
          const r = setSelect(c.el, "--None--", true);
          if (r.status !== "problem") return r;
          const blank = Array.from(c.el.options).find((o) => !o.value);
          if (!blank) return r;
          if (c.el.value === "") return { status: "same" };
          c.el.value = "";
          c.el.dispatchEvent(new Event("input", { bubbles: true }));
          c.el.dispatchEvent(new Event("change", { bubbles: true }));
          return { status: "set" };
        }
        case "radio": return { status: "kept" }; // a radio group has no empty state
        default: return { status: "problem", why: "cannot be cleared here" };
      }
    } catch (e) {
      return { status: "problem", why: String((e && e.message) || e) };
    }
  }

  // ---------- getting the Details form into edit mode ----------
  // Both lookups stay inside the Details tab: the Key Fields box at the top of some records
  // has its own pencil, and clicking it only edits that box (the old bug).
  const saveButton = () =>
    inScope(SAVE)[0] || (footerOutsideTab ? visibleAll(SAVE)[0] : null) || null;
  const editTrigger = () => inScope("button.test-id__inline-edit-trigger")[0] || null;

  async function openDetailsTab() {
    const tab = visibleAll('a[data-tab-value="detailTab"]')[0];
    if (!tab) return;
    if (tab.getAttribute("aria-selected") !== "true") realClick(tab);
    await waitFor(() => detailsPanel() && (editTrigger() || saveButton()), 8000);
  }

  function expandSections() {
    inScope('button.slds-section__title-action[aria-expanded="false"], button.slds-accordion__summary-action[aria-expanded="false"]')
      .forEach((b) => b.click());
  }

  async function ensureEditMode() {
    footerOutsideTab = false;
    if (saveButton()) return true;
    const trigger = editTrigger();
    if (!trigger) return false;
    trigger.click();
    const found = await waitFor(() => saveButton() || visibleAll(SAVE)[0], 8000);
    if (found && !saveButton()) footerOutsideTab = true;
    return !!found;
  }

  // ---------- UI ----------
  function injectStyle() {
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle) oldStyle.remove();
    const st = document.createElement("style");
    st.id = STYLE_ID;
    const D = `#${DOCK_ID}`;
    const P = `#${PANEL_ID}`;
    st.textContent = `
      ${D}{position:fixed;z-index:999999;width:${ORB}px;height:${ORB}px;font:13px/1.4 -apple-system,"Segoe UI",system-ui,sans-serif;
        color:#e9f1f0;user-select:none;-webkit-user-select:none}
      ${D} *{box-sizing:border-box}
      ${D} button{font:inherit;color:inherit;cursor:pointer}

      /* the floating button: a small orb with a stitched ring (stitching = filling in) */
      ${D} .tf-orb{position:absolute;inset:0;display:grid;place-items:center;border:0;border-radius:50%;padding:0;touch-action:none;
        background:radial-gradient(120% 120% at 28% 18%,#4a8fe8 0%,#1f54a2 52%,#0b2354 100%);color:#fff;
        box-shadow:0 8px 20px rgba(11,35,84,.55),0 1px 3px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.4);
        transition:transform .18s ease,box-shadow .18s ease;cursor:grab}
      ${D} .tf-orb::before{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px dashed rgba(76,195,245,.6);
        transition:transform .6s ease,border-color .2s ease;pointer-events:none}
      ${D} .tf-orb svg{width:21px;height:21px;fill:currentColor;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35));transition:transform .25s ease}
      ${D}:hover .tf-orb,${D}.open .tf-orb{transform:scale(1.06);box-shadow:0 10px 26px rgba(11,35,84,.65),0 1px 3px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.4)}
      ${D}:hover .tf-orb::before,${D}.open .tf-orb::before{transform:rotate(90deg);border-color:rgba(76,195,245,.95)}
      ${D}:hover .tf-orb svg,${D}.open .tf-orb svg{transform:rotate(-14deg)}
      ${D}.dragging .tf-orb{cursor:grabbing;transform:scale(.96)}
      ${D}.running .tf-orb::before{animation:tf-spin 1.1s linear infinite;border-color:#f8d559}
      @keyframes tf-spin{to{transform:rotate(360deg)}}

      /* the menu that opens next to the orb (towards the side that has room) */
      ${D} .tf-menu{position:absolute;top:0;left:${ORB}px;padding-left:12px;opacity:0;visibility:hidden;
        transform:translateX(-8px) scale(.96);transform-origin:left top;transition:opacity .16s ease,transform .16s ease,visibility .16s}
      ${D}.tf-flip-x .tf-menu{left:auto;right:${ORB}px;padding-left:0;padding-right:12px;transform:translateX(8px) scale(.96);transform-origin:right top}
      ${D}.tf-flip-y .tf-menu{top:auto;bottom:0}
      ${D}.tf-flip-y .tf-menu{transform-origin:left bottom}
      ${D}.tf-flip-y.tf-flip-x .tf-menu{transform-origin:right bottom}
      ${D}.open:not(.dragging) .tf-menu{opacity:1;visibility:visible;transform:none}
      ${D} .tf-card{width:252px;padding:12px;border-radius:16px;background:rgba(9,20,42,.97);
        border:1px solid rgba(76,195,245,.18);box-shadow:0 14px 34px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06)}
      ${D} .tf-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:9px;margin-bottom:8px;border-bottom:1px dashed rgba(76,195,245,.35)}
      ${D} .tf-brand{font-weight:700;letter-spacing:.16em;font-size:11px;text-transform:uppercase;color:#f8d559}
      ${D} .tf-mode{font-size:11px;color:#8ea6c4;border:1px solid rgba(76,195,245,.3);border-radius:999px;background:none;padding:2px 10px;white-space:nowrap}
      ${D} .tf-mode:hover:not(:disabled){border-color:#4cc3f5;color:#fff}
      ${D} .tf-mode.auto{color:#f8d559;border-color:rgba(248,213,89,.55)}
      ${D} .tf-hint{font-size:11px;color:#8ea6c4;padding:4px 2px}
      ${D} .tf-params{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:8px;padding:8px 12px;border-radius:11px;
        border:1px solid rgba(76,195,245,.3);background:none;color:#cfdcec;font-weight:600;transition:border-color .15s,color .15s}
      ${D} .tf-params svg{width:15px;height:15px;fill:currentColor}
      ${D} .tf-params:hover:not(:disabled){border-color:#4cc3f5;color:#fff}
      ${D} .tf-params.on{border-color:#f8d559;color:#f8d559}
      ${D} [hidden]{display:none!important}
      /* automatic platform detection: a small red message beside the orb, a red line and tag in the menu */
      ${D} .tf-toast{position:absolute;top:50%;left:${ORB + 14}px;display:flex;align-items:center;gap:9px;white-space:nowrap;padding:7px 14px 7px 10px;
        border-radius:999px;background:linear-gradient(135deg,#e0484b,#ff6b5e);color:#fff;opacity:0;pointer-events:none;
        transform:translateY(-50%) translateX(-8px);transition:opacity .3s ease,transform .3s ease;
        box-shadow:0 8px 22px rgba(224,72,75,.55),inset 0 0 0 1.5px rgba(255,255,255,.22)}
      ${D}.tf-flip-x .tf-toast{left:auto;right:${ORB + 14}px;transform:translateY(-50%) translateX(8px)}
      ${D} .tf-toast.show{opacity:1;transform:translateY(-50%);animation:tf-pop .55s ease both,tf-glow 1.5s ease-in-out .55s 3}
      ${D}.open .tf-toast{opacity:0;animation:none}
      ${D} .tf-toast svg{width:17px;height:17px;fill:#fff;flex:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
      ${D} .tf-toast .tf-t1{display:block;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.92}
      ${D} .tf-toast .tf-t2{display:block;font-size:13px;font-weight:800;letter-spacing:.01em;margin-top:2px}
      @keyframes tf-pop{0%{transform:translateY(-50%) scale(.78);opacity:0}60%{transform:translateY(-50%) scale(1.07);opacity:1}100%{transform:translateY(-50%) scale(1);opacity:1}}
      @keyframes tf-glow{50%{box-shadow:0 8px 30px rgba(255,107,94,.95),inset 0 0 0 1.5px rgba(255,255,255,.4)}}
      ${D} .tf-autoline{margin:-4px 0 10px;font-size:11px;font-weight:700;color:#ff8a85}
      ${D} .tf-autoline.none{color:#8ea6c4;font-weight:500}
      ${D} .tf-autotag{margin-left:auto;padding:1px 7px;border-radius:999px;background:#e0484b;color:#fff;font-size:9px;font-weight:800;letter-spacing:.1em}
      ${D} .tf-badge{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;display:none;pointer-events:none;
        background:#f8d559;color:#0b2354;font:700 11px/19px -apple-system,"Segoe UI",system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.45)}
      ${D} .tf-badge.on{display:block}
      ${D} .tf-badge.bad{background:#e0484b;color:#fff}
      ${D} .tf-scans{display:flex;align-items:center;gap:8px;width:100%;margin-top:10px;padding:8px 2px 0;border:0;border-top:1px dashed rgba(76,195,245,.35);
        background:none;text-align:left;color:#8ea6c4;font-size:12px}
      ${D} .tf-scans:hover{color:#fff}
      ${D} .tf-scans.attn{color:#f8d559}
      ${D} .tf-scans.bad{color:#ff9b9d}
      ${D} .tf-link{display:block;margin:6px 0 0 auto;padding:2px 0;border:0;background:none;color:#8ea6c4;font-size:11px;text-decoration:underline;text-underline-offset:3px}
      ${D} .tf-link:hover{color:#fff}
      ${D} .tf-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#8ea6c4;margin:0 0 5px}
      ${D} .tf-list{display:flex;flex-direction:column;gap:2px;max-height:210px;overflow:auto;margin:0 -4px 10px;padding:0 4px}
      ${D} .tf-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:none;padding:6px 8px;border-radius:9px;color:#cfdcec}
      ${D} .tf-row:hover:not(:disabled){background:rgba(76,195,245,.1);color:#fff}
      ${D} .tf-row .tf-dot{width:7px;height:7px;border-radius:50%;border:1.5px solid #566b8c;flex:none}
      ${D} .tf-row.active{background:rgba(23,167,232,.18);color:#fff;font-weight:600}
      ${D} .tf-row.active .tf-dot{background:#f8d559;border-color:#f8d559;box-shadow:0 0 8px rgba(248,213,89,.75)}
      ${D} .tf-actions{display:flex;gap:8px}
      ${D} .tf-go{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:11px;padding:9px 12px;font-weight:700;color:#fff;
        background:linear-gradient(135deg,#1493d0,#17a7e8);box-shadow:0 4px 12px rgba(23,147,208,.45),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .12s ease,filter .12s ease}
      ${D} .tf-go svg{width:15px;height:15px;fill:currentColor}
      ${D} .tf-go:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.1)}
      ${D} .tf-reset{border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:9px 12px;background:none;color:#cfdcec;white-space:nowrap}
      ${D} .tf-reset:hover:not(:disabled){border-color:#e0484b;color:#ff9b9d}
      ${D} .tf-reset.armed{border-color:#e0484b;background:rgba(224,72,75,.18);color:#ffb3b5}
      ${D} .tf-status{min-height:15px;margin-top:8px;font-size:12px;color:#4cc3f5}
      ${D} button:disabled{opacity:.55;cursor:progress}

      /* report panel (opens next to the orb) */
      ${P}{position:fixed;z-index:999999;width:360px;max-height:65vh;overflow:auto;
        background:rgba(9,20,42,.98);color:#e8eaed;font:13px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif;border-radius:14px;padding:12px 14px;
        border-top:3px solid #17a7e8;box-shadow:0 14px 34px rgba(0,0,0,.5)}
      ${P}.ok{border-top-color:#2e844a}
      ${P}.warn{border-top-color:#d99a1c}
      ${P}.bad{border-top-color:#e0484b}
      ${P} .tf-title{font-weight:600;font-size:14px;padding-right:22px}
      ${P} .tf-close{position:absolute;top:6px;right:8px;border:none;background:none;color:#9aa0a6;font-size:18px;cursor:pointer}
      ${P} .tf-close:hover{color:#fff}
      ${P} .tf-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 6px}
      ${P} .tf-chip{padding:2px 9px;border-radius:999px;font-size:12px;background:#26324d}
      ${P} .tf-chip.ok{background:#1f5c36}
      ${P} .tf-chip.warn{background:#6b4d0f}
      ${P} .tf-chip.bad{background:#7a2325}
      ${P} .tf-meta{color:#9aa0a6;font-size:12px;margin-bottom:4px}
      ${P} .tf-h{margin-top:8px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
      ${P} .tf-h.warn{color:#f0b84a}
      ${P} .tf-h.bad{color:#ff7b7e}
      ${P} .tf-item{padding:1px 0 1px 8px;border-left:2px solid #2c3f66;margin-top:2px;font-size:12px}
      ${P} details{margin-top:8px;font-size:12px}
      ${P} summary{cursor:pointer;color:#9aa0a6}
      ${P} .tf-note{margin-top:10px;padding-top:8px;border-top:1px dashed #2c3f66}
      ${P}.tf-wide{width:440px}
      ${P} .tf-ed-row{display:flex;gap:6px;margin:8px 0}
      ${P} .tf-ed-sel{width:100%;margin-top:8px;background:#0f1a31;color:#e8eefb;border:1px solid #2c3f66;border-radius:10px;padding:7px 10px;font:inherit;font-weight:600;outline:none}
      ${P} .tf-ed-btn{flex:1;border:1px solid #2c3f66;border-radius:999px;background:none;color:#cfdcec;padding:5px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
      ${P} .tf-ed-btn:hover{border-color:#17a7e8;color:#fff}
      ${P} .tf-ed-btn.danger:hover,${P} .tf-ed-btn.armed{border-color:#e0484b;color:#ff9b9d}
      ${P} .tf-ed-name{width:100%;background:#0f1a31;color:#e8eefb;border:1px solid #2c3f66;border-radius:10px;padding:7px 10px;font:inherit;outline:none}
      ${P} .tf-ed-text{width:100%;height:300px;margin-top:8px;resize:vertical;white-space:pre;tab-size:2;background:#0b1528;color:#d3e3f7;border:1px solid #253a5e;border-radius:10px;
        padding:8px 10px;font:12px/1.55 Consolas,"SF Mono",monospace;outline:none;caret-color:#4cc3f5}
      ${P} .tf-ed-name:focus,${P} .tf-ed-text:focus,${P} .tf-ed-sel:focus{border-color:#17a7e8}
      ${P} .tf-seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;border:1px solid #2c3f66;border-radius:999px;padding:3px;margin-top:10px}
      ${P} .tf-seg button{border:0;border-radius:999px;padding:6px 8px;background:none;color:#8ea6c4;font:inherit;font-weight:700;cursor:pointer}
      ${P} .tf-seg button.on{background:linear-gradient(135deg,#1f54a2,#17a7e8);color:#fff}
      ${P} .tf-saved{min-height:16px;margin-top:6px;color:#8ee6a8;font-size:12px;font-weight:600}
      ${P} .tf-params-list{margin-top:8px}
      ${P} .tf-prow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #27334d}
      ${P} .tf-pname{font-size:12px}
      ${P} .tf-psel{background:#0f1a31;border:1px solid #2c3f66;border-radius:8px;padding:3px 8px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;color:#8ee6a8}
      ${P} .tf-psel[data-v="No"]{color:#ff9b9d}
      ${P} .tf-psel:focus{outline:none;border-color:#17a7e8}
      ${P} .tf-prow.saved .tf-psel{border-color:#f8d559}
      ${P} .tf-copy{margin-top:8px;padding:3px 10px;border:1px solid #4cc3f5;border-radius:6px;background:none;color:#4cc3f5;cursor:pointer;font:inherit}
    `;
    document.head.appendChild(st);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function removePanel() {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
    paramsOpen = false;
    const pb = document.getElementById(PARAMS_ID);
    if (pb) pb.classList.remove("on");
  }

  function openPanel(title, build, reportText) {
    injectStyle();
    removePanel();
    const panel = el("div");
    panel.id = PANEL_ID;
    const close = el("button", "tf-close", "×");
    close.title = "Close";
    close.addEventListener("click", removePanel);
    panel.append(close, el("div", "tf-title", title));
    build(panel);
    if (reportText) {
      const copy = el("button", "tf-copy", "Copy report");
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(reportText); copy.textContent = "Copied ✓"; }
        catch (e) { copy.textContent = "Copy failed"; }
      });
      panel.appendChild(copy);
    }
    panel.style.visibility = "hidden";
    document.body.appendChild(panel);
    positionPanel(panel);
  }

  // Opens beside the open menu (never on top of it or of the orb): on the side that has room.
  // Falls back to above / below the orb when the window is too narrow for that.
  function positionPanel(panel) {
    const dock = document.getElementById(DOCK_ID);
    const vw = window.innerWidth, vh = window.innerHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const MENU = 252 + 12 + 12; // card + its gap + a little air
    let x = 16, y = 16;
    if (dock) {
      const r = dock.getBoundingClientRect();
      const flipX = r.left + ORB / 2 > vw / 2;
      const w = panel.offsetWidth;
      const roomRight = vw - r.right - EDGE - MENU;
      const roomLeft = r.left - EDGE - MENU;
      if (!flipX && roomRight >= w) {
        panel.style.maxHeight = vh - 2 * EDGE + "px";
        x = r.right + MENU;
        y = r.top;
      } else if (flipX && roomLeft >= w) {
        panel.style.maxHeight = vh - 2 * EDGE + "px";
        x = r.left - MENU - w;
        y = r.top;
      } else {
        const below = vh - r.bottom - EDGE - 10, above = r.top - EDGE - 10;
        const useBelow = below >= above;
        panel.style.maxHeight = Math.max(160, Math.min(useBelow ? below : above, vh * 0.65)) + "px";
        x = r.left + w > vw - EDGE ? r.right - w : r.left;
        y = useBelow ? r.bottom + 10 : r.top - panel.offsetHeight - 10;
      }
    }
    const w = panel.offsetWidth, h = panel.offsetHeight;
    panel.style.left = clamp(x, EDGE, Math.max(EDGE, vw - w - EDGE)) + "px";
    panel.style.top = clamp(y, EDGE, Math.max(EDGE, vh - h - EDGE)) + "px";
    panel.style.visibility = "visible";
  }

  const simplePanel = (title, lines) =>
    openPanel(title, (p) => lines.forEach((l) => p.appendChild(el("div", "tf-meta", l))));

  function reportPanel(preset, rep, clientType, saveNote, reportText, opts = {}) {
    openPanel(`Techfill · ${opts.reset ? "Reset · " : ""}${preset.name}`, (p) => {
      p.classList.add(rep.problem.length ? "bad" : rep.notfound.length ? "warn" : "ok");
      const chips = el("div", "tf-chips");
      const chip = (cls, text) => chips.appendChild(el("span", "tf-chip " + cls, text));
      chip("ok", `✓ ${rep.set.length} ${opts.reset ? "cleared" : "filled"}`);
      if (rep.same.length) chip("", `= ${rep.same.length} ${opts.reset ? "already empty" : "already right"}`);
      if (rep.kept.length) chip("warn", `↷ ${rep.kept.length} kept`);
      if (rep.notfound.length) chip("warn", `? ${rep.notfound.length} not found`);
      if (rep.problem.length) chip("bad", `! ${rep.problem.length} to check`);
      p.appendChild(chips);
      if (!opts.reset) p.appendChild(el("div", "tf-meta", `Account: ${clientType || "unknown"}`));

      const group = (cls, heading, items) => {
        if (!items.length) return;
        p.appendChild(el("div", "tf-h " + cls, heading));
        items.forEach((i) => p.appendChild(el("div", "tf-item", i)));
      };
      group("bad", "To check", rep.problem);
      group("warn", "Not found on the page", rep.notfound);
      group("warn", opts.reset ? "Left as they are (cannot be cleared)" : "Kept (already had a value)", rep.kept);

      if (rep.set.length) {
        const d = el("details");
        d.appendChild(el("summary", null, `${opts.reset ? "Cleared" : "Filled"} fields (${rep.set.length})`));
        rep.set.forEach((i) => d.appendChild(el("div", "tf-item", i)));
        p.appendChild(d);
      }
      p.appendChild(el("div", "tf-note", saveNote));
    }, reportText);
  }

  // ---------- the whole run ----------
  async function runFill(btn, reset = false) {
    if (running) return;
    const other = document.documentElement.dataset[LOCK_ATTR];
    if (other && other !== "techfill") {
      simplePanel("Moonfill is filling this record", ["Wait a few seconds for it to finish, then click again."]);
      return;
    }
    document.documentElement.dataset[LOCK_ATTR] = "techfill";
    running = true;
    const dockButtons = Array.from(document.querySelectorAll(`#${DOCK_ID} button`)).filter((b) => b.id !== ORB_ID);
    dockButtons.forEach((b) => { b.disabled = true; });
    const startId = currentRecordId();
    setBusy(true, reset ? "Resetting…" : "Filling…");
    try {
      const s = await chrome.storage.local.get(["presets", "activePreset", "autoSave"]);
      const presets = s.presets || [];
      const preset = presets.find((p) => p.id === s.activePreset) || presets[0];
      let entries = preset ? parsePreset(preset.text, preset.overrides) : [];
      if (reset && entries.length) {
        // only the fields this preset fills (plus the two SingleView ones); fields left out of the
        // preset, such as the notes, are never touched
        const labels = new Set(entries.map((e) => norm(e.label)));
        entries = entries.map((e) => ({ label: e.label, value: "" }));
        ["SingleView Setup Type", "SingleView Integration Status", ...SCAN_OWNED].forEach((l) => {
          if (!labels.has(norm(l))) entries.push({ label: l, value: "" });
        });
      }
      if (!entries.length) {
        simplePanel("Nothing to fill yet", [
          "Click the Techfill icon in the toolbar and give a value to the fields you want filled."
        ]);
        return;
      }

      await openDetailsTab();
      // Never start on top of someone else's unsaved edits: Save would commit them too
      // (a form Techfill itself left open for review is fine).
      const alreadyEditing = visibleAll(SAVE).length > 0;
      if (alreadyEditing && ownEditFor !== startId) {
        simplePanel("The record is already in edit mode", [
          "Save or cancel your own edits first, then click Fill again.",
          "Saving from here would also save whatever you changed."
        ]);
        return;
      }
      expandSections();
      await sleep(300);
      if (!(await ensureEditMode())) {
        simplePanel("Could not open edit mode", ["Open the Details tab and try again."]);
        return;
      }
      await sleep(300);
      ownEditFor = null;
      delete document.documentElement.dataset[OPEN_ATTR];

      const rep = { set: [], same: [], kept: [], notfound: [], problem: [] };
      const blockers = []; // anything that makes an automatic save unsafe
      const written = [];  // what we really wrote, for the read-back after saving

      // {created}: the date on the Created. line of Implementation History
      if (entries.some((e) => e.created)) {
        const cd = createdDate();
        for (const e of entries.slice()) {
          if (!e.created) continue;
          if (cd.date) e.value = e.value.replace(/\{created\}/gi, formatDate(cd.date));
          else { rep.problem.push(`${e.label}: ${cd.reason}`); entries.splice(entries.indexOf(e), 1); }
        }
      }

      // SingleView fields come from Client Type (a line for them in the preset wins)
      const decision = reset ? { access: null, note: "" } : accessDecision(readValue("Client Type"), readValue("Platform Offer"));
      const clientType = decision.note; // shown in the report
      if (reset) {
        // nothing to derive when clearing
      } else if (decision.access !== null) {
        const have = new Set(entries.map((e) => norm(e.label)));
        singleViewEntries(decision.access).forEach((e) => { if (!have.has(norm(e.label))) entries.push(e); });
      } else {
        rep.problem.push("Client Type and Platform Offer not found or empty, SingleView fields skipped");
      }

      const targetLabels = new Set(entries.map((e) => norm(e.label)));
      const before = snapshotForm(targetLabels);

      let aborted = false;
      for (const e of entries) {
        if (currentRecordId() !== startId) { aborted = true; break; }
        const box = findFieldBox(e.label);
        const kind = box && controlOf(box) ? controlOf(box).kind : null;
        // Filling only touches empty fields, except the ones changed in the Parameters panel (e.force)
        const r = reset ? await clearField(e) : await applyField(e, !!e.force);
        if (r.status === "set") {
          if (await keptValue(e)) { rep.set.push(e.label); written.push({ label: e.label, value: e.value, kind }); }
          else {
            const msg = `${e.label}: did not keep its new value`;
            rep.problem.push(msg);
            blockers.push(msg);
          }
        } else if (r.status === "problem") rep.problem.push(`${e.label}: ${r.why}`);
        else rep[r.status].push(e.label);
      }
      if (aborted) return; // moved to another record mid-run: report nothing

      await sleep(300);
      const moved = firstDifference(before, snapshotForm(targetLabels));
      if (moved) {
        const msg = `"${moved}" changed unexpectedly`;
        rep.problem.push(msg);
        blockers.push(msg);
      }

      let saveNote = "Review the fields, then click Save.";
      let editStillOpen = true;
      if (!rep.set.length) {
        // nothing to save: leave edit mode again if we were the ones who opened it
        saveNote = reset ? "Nothing to clear." : "Nothing needed filling.";
        if (!alreadyEditing) {
          const cancel = inScope(CANCEL)[0] || visibleAll(CANCEL)[0];
          if (cancel) { cancel.click(); editStillOpen = false; }
        }
      } else if (s.autoSave) {
        const saves = visibleAll(SAVE);
        if (blockers.length) {
          saveNote = `Not saved: ${blockers.join("; ")}. The fields are filled on the page: check them, then click Save, or Cancel to discard.`;
        } else if (saves.length !== 1) {
          saveNote = `Not saved: expected one Save button, found ${saves.length}. Check the fields, then click Save, or Cancel to discard.`;
          rep.problem.push(`Expected one Save button, found ${saves.length}`);
        } else {
          saves[0].click();
          // wait for a definite outcome: Salesforce's own error, or edit mode closing
          const outcome = await waitFor(() => {
            const err = visibleAll(SAVE_ERROR).map((n) => n.textContent.replace(/\s+/g, " ").trim()).find(Boolean);
            if (err) return { error: err };
            return visibleAll(SAVE).length ? null : { ok: true };
          }, 15000, 150);
          if (!outcome) {
            saveNote = "Save was clicked but the page is still in edit mode and no error is shown. Check the record before trying again.";
            rep.problem.push("Save did not finish");
          } else if (outcome.error) {
            saveNote = `Salesforce did not save: ${outcome.error} Your changes are still on the page: fix them, or click Cancel.`;
            rep.problem.push("Salesforce refused the save");
          } else {
            editStillOpen = false;
            // read the saved values back from the record
            const wrongNow = () => written.filter((w) => {
              if (w.kind === "checkbox" || w.kind === "radio") return false;
              const b = findFieldBox(w.label);
              return b ? compareValues(w.value, valueOfBox(b)) === false : false;
            });
            const settled = await waitFor(() => (wrongNow().length ? null : true), 8000, 200);
            if (settled) saveNote = `Saved. ${written.length} value${written.length === 1 ? "" : "s"} checked on the record.`;
            else {
              const wrong = wrongNow().map((w) => w.label);
              saveNote = `Saved, but ${wrong.length} field${wrong.length === 1 ? "" : "s"} don't show the expected value: ${wrong.join(", ")}. Check them on the record.`;
              rep.problem.push(`Saved, but not as expected: ${wrong.join(", ")}`);
            }
          }
        }
      }
      if (blockers.length && !s.autoSave && rep.set.length) saveNote = `Check before you save: ${blockers.join("; ")}.`;
      if (editStillOpen && rep.set.length) {
        ownEditFor = startId; // a rerun may continue in this open form
        document.documentElement.dataset[OPEN_ATTR] = startId; // tells Moonfill not to auto-save it
      }

      const reportText = [
        `Techfill ${reset ? "reset" : "report"} (${preset.name})`,
        reset
          ? `Cleared ${rep.set.length} · already empty ${rep.same.length} · left as they are ${rep.kept.length}`
          : `Filled ${rep.set.length} · already right ${rep.same.length} · kept existing ${rep.kept.length}`,
        reset ? "" : `Account: ${clientType || "unknown"}`,
        rep.notfound.length ? "Not found: " + rep.notfound.join(", ") : "",
        ...rep.problem.map((p) => "Problem: " + p),
        rep.kept.length ? "Kept existing: " + rep.kept.join(", ") : "",
        saveNote
      ].filter(Boolean).join("\n");
      console.log("[Techfill]", reportText);
      reportPanel(preset, rep, clientType, saveNote, reportText, { reset });
    } catch (err) {
      console.error("[Techfill]", err);
      simplePanel("Techfill hit an error", [String((err && err.message) || err)]);
    } finally {
      dockButtons.forEach((b) => { b.disabled = false; });
      setBusy(false);
      if (document.documentElement.dataset[LOCK_ATTR] === "techfill") delete document.documentElement.dataset[LOCK_ATTR];
      running = false;
    }
  }

  // ---------- the floating button (orb): drag it anywhere, hover to open ----------
  const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  let dockPos = null;      // { rx, ry }: where the orb sits, as 0..1 of the free space (survives window resizes)
  let dragging = false;
  let closeTimer = null;

  function setBusy(on, text) {
    const dock = document.getElementById(DOCK_ID);
    if (!dock) return;
    dock.classList.toggle("running", !!on);
    const st = dock.querySelector(".tf-status");
    if (st) st.textContent = on ? text : "";
    // a run finished while the pointer is elsewhere: tuck the menu away again
    if (!on && !dock.matches(":hover") && !dock.classList.contains("pinned")) dock.classList.remove("open");
  }

  function placeDock(dock) {
    const spanX = Math.max(1, window.innerWidth - ORB - 2 * EDGE);
    const spanY = Math.max(1, window.innerHeight - ORB - 2 * EDGE);
    const p = dockPos || { rx: 0, ry: 1 }; // default: bottom left
    moveDock(dock, EDGE + p.rx * spanX, EDGE + p.ry * spanY);
  }
  function moveDock(dock, x, y) {
    const cx = Math.max(EDGE, Math.min(x, window.innerWidth - ORB - EDGE));
    const cy = Math.max(EDGE, Math.min(y, window.innerHeight - ORB - EDGE));
    dock.style.left = cx + "px";
    dock.style.top = cy + "px";
    // open the menu towards the side that has room
    dock.classList.toggle("tf-flip-x", cx + ORB / 2 > window.innerWidth / 2);
    dock.classList.toggle("tf-flip-y", cy + ORB / 2 > window.innerHeight / 2);
  }
  function ratiosOf(dock) {
    const spanX = Math.max(1, window.innerWidth - ORB - 2 * EDGE);
    const spanY = Math.max(1, window.innerHeight - ORB - 2 * EDGE);
    const r = dock.getBoundingClientRect();
    return {
      rx: Math.max(0, Math.min(1, (r.left - EDGE) / spanX)),
      ry: Math.max(0, Math.min(1, (r.top - EDGE) / spanY))
    };
  }

  async function refreshPresets(keepParams) {
    const list = document.getElementById(SEL_ID);
    const dock = document.getElementById(DOCK_ID);
    if (!list || !dock) return;
    try {
      const s = await chrome.storage.local.get(["presets", "activePreset", "autoSave"]);
      const presets = s.presets || [];
      const active = presets.some((p) => p.id === s.activePreset) ? s.activePreset : (presets[0] && presets[0].id);
      list.textContent = "";
      presets.forEach((p) => {
        const row = el("button", "tf-row" + (p.id === active ? " active" : ""));
        row.type = "button";
        row.append(el("span", "tf-dot"), el("span", null, p.name));
        if (detect.presetId === p.id && detect.rid === currentRecordId()) row.append(el("span", "tf-autotag", "AUTO"));
        row.addEventListener("click", () => chrome.storage.local.set({ activePreset: p.id }));
        list.appendChild(row);
      });
      const cur = presets.find((p) => p.id === active);
      dock.querySelector(".tf-orb").title = cur ? `Techfill · ${cur.name}` : "Techfill";
      const mode = dock.querySelector(".tf-mode");
      if (mode) { mode.textContent = s.autoSave ? "● saves automatically" : "○ review first"; mode.classList.toggle("auto", !!s.autoSave); }
      if (!presets.length) list.appendChild(el("div", "tf-hint", "Open the Techfill icon in the toolbar to add a preset."));
      // Parameters only for the presets that have optional Yes / No fields
      const eligible = !!cur && PARAM_KEYS.includes(cur.key);
      const pb = document.getElementById(PARAMS_ID);
      if (pb) pb.hidden = !eligible;
      if (paramsOpen && !keepParams) { if (eligible) openParams(); else removePanel(); }
    } catch (e) { /* extension was reloaded: this page needs a refresh */ }
  }

  // ---------- automatic platform detection ----------
  // When an Implementation record opens, its "Landing Page URL" is read, the background reads that site
  // and recognises the platform, and the matching preset is selected: nothing to click, ready to Fill.
  const detect = { rid: null, url: null, state: "idle", name: null, presetId: null, at: 0 };
  let toastTimer = null;

  // The preset list always holds every ready-made preset (a fresh install needs no visit to the popup)
  async function initPresets() {
    try {
      const C = TechfillCore;
      const s = await chrome.storage.local.get(["presets", "activePreset", "presetsV"]);
      if (s.presetsV === 4 && s.presets && s.presets.length) return;
      const list = C.upgradePresets(s.presets || []);
      const std = list.find((p) => p.key === "standard") || list[0];
      const active = list.some((p) => p.id === s.activePreset) ? s.activePreset : std.id;
      await chrome.storage.local.set({ presets: list, activePreset: active, presetsV: 4 });
    } catch (e) { /* extension was reloaded */ }
  }

  function webAddress(raw) {
    const t = String(raw == null ? "" : raw).trim();
    if (!t || /\s/.test(t)) return null;
    if (/^https?:\/\//i.test(t)) return t;
    return /^[\w-]+(\.[\w-]+)+([/?#:].*)?$/.test(t) ? "https://" + t : null;
  }
  // The client's site: the record's "Landing Page URL" (a link's address is preferred over its text)
  function landingPageUrl() {
    for (const l of root().querySelectorAll(".test-id__field-label, .slds-form-element__label, .slds-form-element__legend")) {
      if (labelText(l) !== "landing page url") continue;
      const box = l.closest(".slds-form-element, records-record-layout-item, force-record-layout-item");
      if (!box) continue;
      const href = Array.from(box.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")).find((h) => /^https?:\/\//i.test(h));
      const input = box.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
      const text = (box.querySelector("lightning-formatted-text, lightning-formatted-url, .test-id__field-value, .slds-form-element__static") || {}).textContent;
      const url = webAddress(href || text || (input && input.value));
      if (url) return url;
    }
    return null;
  }

  function showToast(name) {
    const dock = document.getElementById(DOCK_ID);
    const t = dock && dock.querySelector(".tf-toast");
    if (!t) return;
    t.querySelector(".tf-t2").textContent = name;
    t.classList.remove("show");
    void t.offsetWidth; // restart the animation
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 9000);
  }
  function updateAutoLine() {
    const dock = document.getElementById(DOCK_ID);
    const line = dock && dock.querySelector(".tf-autoline");
    if (!line) return;
    const mine = detect.rid === currentRecordId();
    if (mine && detect.name) { line.textContent = `⚡ Detected automatically: ${detect.name}`; line.className = "tf-autoline"; line.hidden = false; }
    else if (mine && detect.state === "done") { line.textContent = "Platform not detected: pick it from the list"; line.className = "tf-autoline none"; line.hidden = false; }
    else line.hidden = true;
  }

  async function applyDetection(rid, answer) {
    if (detect.rid !== rid) return; // the agent moved to another record meanwhile
    detect.state = "done";
    const C = TechfillCore;
    const key = answer && answer.name ? C.PLATFORM_KEYS[answer.name] : null;
    if (!key) { updateAutoLine(); return; }
    const s = await chrome.storage.local.get(["presets", "activePreset"]);
    let presets = s.presets || [];
    let preset = presets.find((p) => p.key === key);
    if (!preset) { // a preset the saved list does not have yet
      presets = C.upgradePresets(presets);
      preset = presets.find((p) => p.key === key);
      await chrome.storage.local.set({ presets });
    }
    if (!preset || detect.rid !== rid) return;
    detect.name = answer.name;
    detect.presetId = preset.id;
    if (s.activePreset !== preset.id) await chrome.storage.local.set({ activePreset: preset.id });
    await refreshPresets();
    updateAutoLine();
    showToast(answer.name);
  }

  // Called every second by ensureButton: once per record, as soon as its landing page shows
  function autoDetectTick() {
    const rid = currentRecordId();
    if (detect.rid !== rid) {
      Object.assign(detect, { rid, url: null, state: "idle", name: null, presetId: null });
      const t = document.querySelector(`#${DOCK_ID} .tf-toast`);
      if (t) t.classList.remove("show");
      updateAutoLine();
    }
    if (detect.state !== "idle" || document.visibilityState !== "visible") return;
    const url = landingPageUrl();
    if (!url) return;
    detect.state = "running";
    detect.url = url;
    chrome.runtime.sendMessage({ action: "detectPlatform", url })
      .then((answer) => applyDetection(rid, answer))
      .catch(() => { if (detect.rid === rid) detect.state = "done"; });
  }

  // ---------- Moonfill scans: a badge on the orb and one line in the menu ----------
  async function refreshScans() {
    const dock = document.getElementById(DOCK_ID);
    if (!dock) return;
    try {
      const all = await chrome.storage.local.get(null);
      const jobs = Object.keys(all).filter((k) => k.startsWith(SCAN_PREFIX)).map((k) => all[k]);
      const active = jobs.filter((j) => SCAN_ACTIVE.includes(j.state));
      const parked = active.filter((j) => j.state === "waiting_browser").length;
      const failed = jobs.filter((j) => j.state === "failed" && Date.now() - (j.finishedAt || 0) < 10 * 60 * 1000).length;
      const badge = dock.querySelector(".tf-badge");
      const row = dock.querySelector(".tf-scans");
      let text = "🌙 Moonpull: no scan running", cls = "";
      if (failed) { text = `🌙 Moonpull: ${failed} failed, open to see why`; cls = "bad"; }
      else if (parked) { text = "🌙 Moonpull: result ready, waiting for the browser"; cls = "attn"; }
      else if (active.length) { text = `🌙 Moonpull: ${active.length} scan${active.length > 1 ? "s" : ""} running`; cls = "attn"; }
      if (row) { row.textContent = text; row.className = "tf-scans " + cls; }
      if (badge) {
        badge.className = "tf-badge" + (failed ? " on bad" : active.length ? " on" : "");
        badge.textContent = failed ? "!" : String(active.length || "");
      }
    } catch (e) { /* extension was reloaded: this page needs a refresh */ }
  }
  setInterval(refreshScans, 30000); // lets a "failed" notice expire on its own

  // ---------- Presets editor (a panel like Parameters; the separate window is only a fallback) ----------
  async function openPresetsPanel() {
    const C = TechfillCore; // techfill-core.js
    const s = await chrome.storage.local.get(["presets", "activePreset", "autoSave"]);
    let presets = (s.presets || []).map((p) => ({ ...p, overrides: p.overrides || [] }));
    if (!presets.length) presets = C.DEFAULTS.map(C.defaultPreset);
    let activeId = presets.some((p) => p.id === s.activePreset) ? s.activePreset : presets[0].id;
    let autoSave = !!s.autoSave;
    const cur = () => presets.find((p) => p.id === activeId) || presets[0];

    openPanel("Presets", (p) => {
      p.classList.add("tf-wide");
      ["keydown", "keyup", "keypress"].forEach((t) => p.addEventListener(t, (e) => e.stopPropagation())); // keep typing away from Salesforce shortcuts
      const sel = el("select", "tf-ed-sel");
      const row = el("div", "tf-ed-row");
      const mk = (text, cls) => { const b = el("button", "tf-ed-btn" + (cls ? " " + cls : ""), text); b.type = "button"; return b; };
      const dup = mk("Duplicate"), rst = mk("Reset values"), del = mk("Delete", "danger");
      row.append(dup, rst, del);
      const name = el("input", "tf-ed-name");
      name.type = "text";
      name.placeholder = "Preset name";
      name.style.marginTop = "8px";
      const ta = el("textarea", "tf-ed-text");
      ta.spellcheck = false;
      const seg = el("div", "tf-seg");
      const bRev = el("button", null, "Review first"), bSave = el("button", null, "Save automatically");
      bRev.type = bSave.type = "button";
      seg.append(bRev, bSave);
      const saved = el("div", "tf-saved");
      p.append(sel, row, name, ta, el("div", "tf-meta", "After filling"), seg, saved);

      let flashT = null, saveT = null;
      const flash = (t) => { saved.textContent = t; clearTimeout(flashT); flashT = setTimeout(() => { saved.textContent = ""; }, 1500); };
      const save = async (extra) => {
        selfWrite = true;
        await chrome.storage.local.set({ presets, activePreset: activeId, ...(extra || {}) });
        flash("Saved ✓");
      };
      const later = () => { clearTimeout(saveT); saveT = setTimeout(() => save(), 300); };
      const draw = () => {
        sel.textContent = "";
        presets.forEach((pr) => { const o = el("option", null, pr.name); o.value = pr.id; sel.appendChild(o); });
        sel.value = activeId;
        name.value = cur().name;
        ta.value = cur().text;
        bRev.classList.toggle("on", !autoSave);
        bSave.classList.toggle("on", autoSave);
        [del, rst].forEach((b) => { b.classList.remove("armed"); });
        del.textContent = "Delete";
        rst.textContent = "Reset values";
      };
      const arm = (btn, label, action) => {
        let armed = false, t = null;
        btn.addEventListener("click", () => {
          if (!armed) {
            armed = true; btn.textContent = "Sure?"; btn.classList.add("armed");
            t = setTimeout(() => { armed = false; btn.textContent = label; btn.classList.remove("armed"); }, 3000);
            return;
          }
          clearTimeout(t); armed = false; btn.classList.remove("armed"); btn.textContent = label;
          action();
        });
      };

      sel.addEventListener("change", async () => { activeId = sel.value; await save(); draw(); });
      ta.addEventListener("input", () => { cur().text = ta.value; later(); });
      name.addEventListener("input", () => {
        cur().name = name.value || "Untitled";
        const o = sel.selectedOptions[0]; if (o) o.textContent = cur().name;
        later();
      });
      dup.addEventListener("click", async () => {
        const c = cur();
        const copy = { id: C.uid(), key: c.key, name: "Copy of " + c.name, text: c.text, overrides: [...(c.overrides || [])] };
        presets.push(copy); activeId = copy.id;
        await save(); draw(); name.focus(); name.select();
      });
      arm(del, "Delete", async () => {
        if (presets.length <= 1) { flash("Keep at least one preset"); return; }
        presets = presets.filter((x) => x.id !== activeId);
        activeId = presets[0].id;
        await save(); draw();
      });
      arm(rst, "Reset values", async () => {
        const d = C.DEFAULTS.find((x) => x.key === cur().key) || C.DEFAULTS[0];
        cur().text = C.makeTemplate(d);
        cur().overrides = []; // back to the ready-made values: nothing is forced any more
        await save(); draw(); flash("Back to the usual values ✓");
      });
      bRev.addEventListener("click", async () => { autoSave = false; await save({ autoSave }); draw(); });
      bSave.addEventListener("click", async () => { autoSave = true; await save({ autoSave }); draw(); });
      draw();
    });
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== "openPresetsPanel") return;
    if (document.getElementById(DOCK_ID)) { openPresetsPanel(); sendResponse({ ok: true }); } else sendResponse({ ok: false });
  });

  // ---------- Parameters: Yes / No for every optional field of the active preset ----------
  const activePresetNow = async () => {
    const s = await chrome.storage.local.get(["presets", "activePreset"]);
    const presets = s.presets || [];
    return presets.find((p) => p.id === s.activePreset) || presets[0] || null;
  };
  function paramRows(text) {
    const seen = new Set();
    const rows = [];
    for (const e of parsePreset(text)) {
      const k = norm(e.label);
      if (seen.has(k) || !/^(yes|no)$/i.test(e.value)) continue;
      seen.add(k);
      rows.push({ label: e.label, value: /^yes$/i.test(e.value) ? "Yes" : "No" });
    }
    return rows;
  }
  // Change "Label = value" inside the preset text, keeping everything else exactly as it is
  function setLineValue(text, label, value) {
    const want = norm(label);
    return String(text).split("\n").map((line) => {
      const t = line.trim();
      const i = line.indexOf("=");
      if (!t || t.startsWith("#") || i < 0 || norm(line.slice(0, i)) !== want) return line;
      return line.slice(0, i + 1) + " " + value;
    }).join("\n");
  }
  async function saveParam(presetId, label, value, row) {
    const s = await chrome.storage.local.get("presets");
    const presets = s.presets || [];
    const p = presets.find((x) => x.id === presetId);
    if (!p) return;
    p.text = setLineValue(p.text, label, value);
    // a value picked here is the user's decision: from now on it overwrites what is on the record
    p.overrides = Array.from(new Set([...(p.overrides || []), label]));
    selfWrite = true;
    await chrome.storage.local.set({ presets });
    row.classList.add("saved");
    setTimeout(() => row.classList.remove("saved"), 700);
  }
  async function openParams() {
    const preset = await activePresetNow();
    if (!preset || !PARAM_KEYS.includes(preset.key)) { removePanel(); return; }
    const rows = paramRows(preset.text);
    openPanel(`Parameters · ${preset.name}`, (p) => {
      p.appendChild(el("div", "tf-meta", rows.length
        ? "Yes / No for each optional field. A value you pick here is saved at once, stays after the job, and overwrites what is already on the record the next time you click Fill. Scan results (Moonpull Status, Consent Signals, TCF Plugin, AASAF, Consent Management Platform) are not listed: they always come from the latest Moonpull result."
        : "This preset has no Yes / No fields."));
      const list = el("div", "tf-params-list");
      rows.forEach((r) => {
        const row = el("div", "tf-prow");
        const sel = el("select", "tf-psel");
        ["Yes", "No"].forEach((v) => { const o = el("option", null, v); o.value = v; sel.appendChild(o); });
        sel.value = r.value;
        sel.dataset.v = r.value;
        sel.addEventListener("change", () => { sel.dataset.v = sel.value; saveParam(preset.id, r.label, sel.value, row); });
        row.append(el("span", "tf-pname", r.label), sel);
        list.appendChild(row);
      });
      p.appendChild(list);
    });
    paramsOpen = true;
    const pb = document.getElementById(PARAMS_ID);
    if (pb) pb.classList.add("on");
  }

  function buildDock() {
    injectStyle();
    const dock = el("div");
    dock.id = DOCK_ID;
    dock.dataset.build = BUILD;

    // --- the orb ---
    const orb = el("button", "tf-orb");
    orb.id = ORB_ID;
    orb.type = "button";
    orb.setAttribute("aria-label", "Techfill");
    orb.innerHTML = PEN;

    // --- the menu ---
    const menu = el("div", "tf-menu");
    const card = el("div", "tf-card");
    const head = el("div", "tf-head");
    const modeChip = el("button", "tf-mode", "");
    modeChip.type = "button";
    modeChip.title = "Click to switch: review first / saves automatically";
    modeChip.addEventListener("click", async () => {
      const cur = await chrome.storage.local.get("autoSave");
      chrome.storage.local.set({ autoSave: !cur.autoSave });
    });
    head.append(el("span", "tf-brand", "Techfill"), modeChip);
    const list = el("div", "tf-list");
    list.id = SEL_ID;
    const fill = el("button", "tf-go");
    fill.id = BTN_ID;
    fill.type = "button";
    fill.title = "Fill the tech checklist from the selected preset";
    fill.innerHTML = PEN + "<span>Fill</span>";
    fill.addEventListener("click", () => runFill(fill));
    // Reset (for testing): this preset's fields back to --None-- / empty. Two clicks, so never by accident.
    const rst = el("button", "tf-reset", "Reset");
    rst.id = RESET_ID;
    rst.type = "button";
    rst.title = "Set this preset's fields back to --None-- / empty (click twice)";
    let armed = false;
    let armTimer = null;
    rst.addEventListener("click", () => {
      if (running) return;
      if (!armed) {
        armed = true;
        rst.textContent = "Sure?";
        rst.classList.add("armed");
        armTimer = setTimeout(() => { armed = false; rst.textContent = "Reset"; rst.classList.remove("armed"); }, 3000);
        return;
      }
      clearTimeout(armTimer);
      armed = false;
      rst.textContent = "Reset";
      rst.classList.remove("armed");
      runFill(rst, true);
    });
    const actions = el("div", "tf-actions");
    actions.append(fill, rst);
    const pbtn = el("button", "tf-params");
    pbtn.id = PARAMS_ID;
    pbtn.type = "button";
    pbtn.hidden = true;
    pbtn.title = "Choose Yes / No for each optional field of this preset";
    pbtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg><span>Parameters</span>';
    pbtn.addEventListener("click", () => (paramsOpen ? removePanel() : openParams()));
    // Moonfill's scans, summarised: click opens its popup (jobs, history, Force paste)
    const autoLine = el("div", "tf-autoline");
    autoLine.hidden = true;
    const scans = el("button", "tf-scans");
    scans.type = "button";
    scans.title = "Open the Moonpull scans";
    scans.addEventListener("click", () => chrome.runtime.sendMessage({ action: "openMoonfillPopup" }).catch(() => {}));
    const presetsLink = el("button", "tf-link", "Edit presets…");
    presetsLink.type = "button";
    presetsLink.addEventListener("click", () => openPresetsPanel());
    card.append(head, el("div", "tf-label", "Preset"), list, autoLine, actions, pbtn, el("div", "tf-status"), scans, presetsLink);
    menu.appendChild(card);
    const badge = el("span", "tf-badge");
    const toast = el("div", "tf-toast");
    toast.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg><span><span class="tf-t1">Platform detected automatically</span><span class="tf-t2"></span></span>';
    dock.append(menu, orb, badge, toast);

    // --- open on hover, close shortly after the pointer leaves ---
    let suppressOpen = false; // after a click that closed everything, hovering must not reopen the menu
    const open = () => { clearTimeout(closeTimer); if (!dragging && !suppressOpen) dock.classList.add("open"); };
    const close = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (!dock.classList.contains("pinned") && !running) dock.classList.remove("open"); }, 380);
    };
    // A click on the orb: if anything is open (menu or any panel) close it all and leave just the orb;
    // otherwise pin the menu open.
    const toggleAll = () => {
      const anyOpen = dock.classList.contains("open") || !!document.getElementById(PANEL_ID);
      if (anyOpen) {
        clearTimeout(closeTimer);
        dock.classList.remove("open", "pinned");
        removePanel();
        suppressOpen = true;
      } else {
        dock.classList.add("open", "pinned");
      }
    };
    dock.addEventListener("pointerenter", open);
    dock.addEventListener("pointerleave", () => { suppressOpen = false; close(); });
    dock.addEventListener("focusin", open);

    // --- drag the orb anywhere (a click without moving pins the menu open or closed) ---
    let start = null;
    orb.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = dock.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top };
      orb.setPointerCapture(e.pointerId);
    });
    orb.addEventListener("pointermove", (e) => {
      if (!start) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      if (!dragging) { dragging = true; dock.classList.add("dragging"); dock.classList.remove("open", "pinned"); removePanel(); }
      moveDock(dock, e.clientX - start.dx, e.clientY - start.dy);
    });
    const release = (e) => {
      if (!start) return;
      start = null;
      try { orb.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (dragging) {
        dragging = false;
        dock.classList.remove("dragging");
        dockPos = ratiosOf(dock);
        chrome.storage.local.set({ dockPos });
        moveDock(dock, dock.getBoundingClientRect().left, dock.getBoundingClientRect().top); // refresh menu side
      } else {
        toggleAll();
      }
    };
    orb.addEventListener("pointerup", release);
    orb.addEventListener("pointercancel", release);
    orb.addEventListener("click", (e) => { // keyboard (Enter / Space): pointer clicks are handled above
      if (e.detail !== 0) return;
      toggleAll();
    });

    document.body.appendChild(dock);
    placeDock(dock);
    initPresets().then(() => refreshPresets());
    refreshScans();
    chrome.storage.local.get("dockPos").then((s) => { if (s.dockPos) { dockPos = s.dockPos; placeDock(dock); } }).catch(() => {});
  }

  // Escape closes a pinned menu; a click elsewhere unpins it; resizing keeps the orb on screen
  document.addEventListener("keydown", (e) => {
    const dock = document.getElementById(DOCK_ID);
    if (e.key === "Escape" && dock && dock.classList.contains("pinned")) dock.classList.remove("pinned", "open");
  });
  document.addEventListener("pointerdown", (e) => {
    const dock = document.getElementById(DOCK_ID);
    if (dock && dock.classList.contains("pinned") && !dock.contains(e.target)) dock.classList.remove("pinned", "open");
  }, true);
  window.addEventListener("resize", () => {
    const dock = document.getElementById(DOCK_ID);
    if (dock && !dragging) placeDock(dock);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Object.keys(changes).some((k) => k.startsWith(SCAN_PREFIX))) refreshScans();
    if (changes.presets || changes.activePreset || changes.autoSave) {
      const own = selfWrite && !changes.activePreset; // our own Yes / No edit: leave the open panel alone
      selfWrite = false;
      refreshPresets(own);
    }
    if (changes.dockPos && !dragging) {
      dockPos = changes.dockPos.newValue || null; // moved in another tab: follow it
      const dock = document.getElementById(DOCK_ID);
      if (dock) placeDock(dock);
    }
  });

  const currentRecordId = () => (location.pathname.match(RECORD_RE) || [])[1] || null;
  let lastRecord = null;

  function ensureButton() {
    const rid = currentRecordId();
    if (rid !== lastRecord) { lastRecord = rid; ownEditFor = null; delete document.documentElement.dataset[OPEN_ATTR]; removePanel(); } // old report belongs to the old record
    const existing = document.getElementById(DOCK_ID);
    if (!rid) {
      if (existing) existing.remove();
      removePanel();
      return;
    }
    if (existing && existing.dataset.build !== BUILD) { existing.remove(); buildDock(); return; } // left by an older build
    if (existing) { autoDetectTick(); return; }
    if (!document.body) return;
    buildDock();
  }
  setInterval(ensureButton, 1000);
  ensureButton();
})();
