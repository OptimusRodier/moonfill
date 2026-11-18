console.log("🌙 Moonfill Salesforce RTP script active.");

// --- GEO Mapping ---
// Supported geo codes: country name -> code
const countryToGeo = {
  "United Kingdom": "GB", "France": "FR", "Germany": "DE",
  "United States": "US", "United States of America": "US", "Spain": "ES", "Italy": "IT",
  "Netherlands": "NL", "Brazil": "BR", "Sweden": "SE", "Poland": "PL", "Portugal": "PT",
  "Austria": "AT", "Switzerland": "CH", "Ireland": "IE",
  "United Arab Emirates": "AE", "Argentina": "AR", "Australia": "AU", "Belgium": "BE",
  "Bulgaria": "BG", "Bolivia": "BO", "Belarus": "BY", "Canada": "CA", "Chile": "CL",
  "China": "CN", "Colombia": "CO", "Czech Republic": "CZ", "Czechia": "CZ", "Denmark": "DK",
  "Ecuador": "EC", "Estonia": "EE", "Finland": "FI", "Greece": "GR", "Croatia": "HR",
  "Hungary": "HU", "India": "IN", "Japan": "JP", "South Korea": "KR", "Korea, Republic of": "KR",
  "Lithuania": "LT", "Latvia": "LV", "Mexico": "MX", "Malaysia": "MY", "Norway": "NO",
  "New Zealand": "NZ", "Peru": "PE", "Philippines": "PH", "Russia": "RU",
  "Russian Federation": "RU", "Singapore": "SG", "Thailand": "TH", "Turkey": "TR",
  "Türkiye": "TR", "Ukraine": "UA", "Vietnam": "VN", "Viet Nam": "VN",
  "Luxembourg": "BE" // no own geo: closest market (French/German speaking, Benelux)
};

const supportedGeos = new Set([
  "GB", "FR", "DE", "US", "ES", "IT", "NL", "BR", "SE", "PL", "PT", "AT", "CH", "IE",
  "AE", "AR", "AU", "BE", "BG", "BO", "BY", "CA", "CL", "CN", "CO", "CZ", "DK", "EC",
  "EE", "FI", "GR", "HR", "HU", "IN", "JP", "KR", "LT", "LV", "MX", "MY", "NO", "NZ",
  "PE", "PH", "RU", "SG", "TH", "TR", "UA", "VN"
]);

// Case-insensitive lookup, built once
const countryLookup = Object.fromEntries(
  Object.entries(countryToGeo).map(([k, v]) => [k.toLowerCase(), v])
);

// Unsupported South/South-East/East Asian countries -> SG (exact names; short names must not use
// "includes", e.g. "oman" is inside "romania")
const asiaToSG = new Set([
  "indonesia", "taiwan", "hong kong", "macau", "macao", "pakistan", "bangladesh", "sri lanka",
  "nepal", "bhutan", "maldives", "myanmar", "burma", "cambodia", "laos", "brunei", "mongolia",
  "timor-leste", "east timor"
]);
const asiaNeedlesSG = ["hong kong", "taiwan", "myanmar", "brunei", "lao people", "sri lanka", "timor"];
// Unsupported Gulf / Middle East countries -> AE
const gulfToAE = new Set([
  "saudi arabia", "qatar", "kuwait", "bahrain", "oman", "jordan", "lebanon", "iraq", "israel", "yemen"
]);
const gulfNeedlesAE = ["saudi", "kingdom of saudi"];

// Region (Salesforce picklist) -> main market, used only when the country is not supported
const regionToGeo = {
  "benelux": "BE", "brazil": "BR", "dach": "DE", "eastern europe": "PL", "france": "FR",
  "italy": "IT", "nordics": "SE", "spain": "ES", "uk": "GB", "us": "US"
  // "Global" has no market of its own: it falls through to the currency
};
// Regions that cover several markets: a distinctive currency refines the choice first
const broadRegions = new Set(["dach", "eastern europe", "nordics", "global"]);

// Currencies that point to a single market (EUR and USD are too ambiguous, so not listed)
const currencyToGeo = {
  GBP: "GB", SEK: "SE", NOK: "NO", DKK: "DK", PLN: "PL", CHF: "CH", CZK: "CZ", HUF: "HU",
  BGN: "BG", HRK: "HR", BRL: "BR", MXN: "MX", ARS: "AR", CLP: "CL", COP: "CO", PEN: "PE",
  BOB: "BO", AUD: "AU", NZD: "NZ", CAD: "CA", JPY: "JP", KRW: "KR", CNY: "CN", INR: "IN",
  MYR: "MY", SGD: "SG", THB: "TH", TRY: "TR", UAH: "UA", RUB: "RU", BYN: "BY", PHP: "PH",
  VND: "VN", AED: "AE"
};

function geoFromCurrency(currency) {
  const code = (currency || "").trim().slice(0, 3).toUpperCase(); // "EUR - Euro" -> "EUR"
  return currencyToGeo[code] || null;
}

// Order: 1) supported country/code  1b) other Asian country -> SG, Gulf/Middle East -> AE
//        2) USD in Brazil/Global/US regions -> US
//        3) region (broad regions: distinctive currency first)
//        4) distinctive currency      5) GB
function normalizeGeo(country, region, currency) {
  const raw = (country || "").trim();
  const lower = raw.toLowerCase();
  if (countryLookup[lower]) return countryLookup[lower];

  // The field may already hold a code ("FR", "UK")
  const upper = raw.toUpperCase();
  if (upper === "UK") return "GB";
  if (supportedGeos.has(upper)) return upper;

  // Variants such as "Korea (South)" or "United Arab Emirates (the)"
  const partial = [
    ["united arab", "AE"], ["united kingdom", "GB"], ["united states", "US"],
    ["korea", "KR"], ["czech", "CZ"], ["russia", "RU"], ["viet", "VN"], ["new zealand", "NZ"]
  ];
  for (const [needle, geo] of partial) if (lower.includes(needle)) return geo;

  // Unsupported Asian / Middle East countries go to the closest hub
  if (asiaToSG.has(lower) || asiaNeedlesSG.some((n) => lower.includes(n))) return "SG";
  if (gulfToAE.has(lower) || gulfNeedlesAE.some((n) => lower.includes(n))) return "AE";

  // Country not supported: use region and currency to find the closest market
  const reg = (region || "").trim().toLowerCase();
  const byCurrency = geoFromCurrency(currency);
  const byRegion = regionToGeo[reg] || null;
  // USD on an unsupported country in the Brazil/LatAm, Global or US regions = the US market
  // (e.g. Uruguay, region Brazil, USD). Other regions keep their own default.
  const isUsd = (currency || "").trim().toUpperCase().startsWith("USD");
  if (isUsd && ["brazil", "global", "us", ""].includes(reg)) {
    console.log(`🌙 Country "${raw}" not supported, region "${region}", currency USD => US`);
    return "US";
  }
  let geo;
  if (broadRegions.has(reg)) geo = byCurrency || byRegion;
  else geo = byRegion || byCurrency;
  geo = geo || "GB";
  console.log(`🌙 Country "${raw}" not supported -> region "${region}", currency "${currency}" => ${geo}`);
  return geo;
}

// --- Small helpers ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isVisible(el) {
  return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

async function waitFor(fn, timeoutMs = 20000, interval = 250) {
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

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Wait for elements ---
function waitForElement(selectorFunc, maxRetries = 50, interval = 200) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      let el;
      try { el = selectorFunc(); } catch (e) { return reject(e); } // predicate may abort the wait
      if (el) return resolve(el);
      if (++tries >= maxRetries) return reject("Element not found");
      setTimeout(check, interval);
    };
    check();
  });
}

// --- Detect record ID ---
function getRecordIdFromUrl() {
  const match = window.location.pathname.match(/\/r\/TSE__c\/([a-zA-Z0-9]+)\/view/);
  return match ? match[1] : null;
}

// --- Scope everything to the page that is active right now ---
// Lightning keeps previously visited pages in the DOM, hidden. Unscoped queries can
// match those stale pages (wrong MID, button inside a hidden card).
const activeRoot = () => document.querySelector(".oneContent.active") || document;
const visibleIn = (sel) =>
  Array.from(activeRoot().querySelectorAll(sel)).find(isVisible) || null;

// Value of a record-page field by its label ("" if missing or empty)
function readField(labelText) {
  const label = Array.from(activeRoot().querySelectorAll(".test-id__field-label"))
    .find((l) => l.textContent.trim() === labelText && isVisible(l));
  const v = label?.closest(".slds-form-element")
    ?.querySelector("lightning-formatted-text, .test-id__field-value");
  return v ? v.textContent.trim() : "";
}

// --- Program name (shown in the popup) ---
// Tries a "Program name" field first, then the record title, then the tab title.
function getProgramName() {
  try {
    const label = Array.from(activeRoot().querySelectorAll(".test-id__field-label"))
      .find((l) => /^program( name)?$/i.test(l.textContent.trim()) && isVisible(l));
    if (label) {
      const v = label.closest(".slds-form-element")
        ?.querySelector("lightning-formatted-text, .test-id__field-value");
      if (v && v.textContent.trim()) return v.textContent.trim();
    }
    const title = visibleIn('[slot="primaryField"], .slds-page-header__title');
    if (title && title.textContent.trim()) return title.textContent.trim();
    const t = document.title.split("|")[0].trim();
    if (t) return t;
  } catch (e) { /* fall through */ }
  return null;
}

// --- Buttons: look + spacing ---
const BUILD = "2.0-d"; // internal stamp: buttons built by an older build are rebuilt
const BUTTON_GAP_PX = 24; // space between the buttons: raise it for even more room

function injectStyles() {
  const old = document.getElementById("moonfillStyle");
  if (old) old.remove();
  const st = document.createElement("style");
  st.id = "moonfillStyle";
  st.textContent = `
    .mf-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px ${BUTTON_GAP_PX}px;margin:16px 0 8px;padding:2px 0}
    .mf-row.mf-single{justify-content:flex-start}
    .mf-btn{display:inline-flex;align-items:center;gap:9px;min-height:38px;padding:9px 22px;border:0;border-radius:999px;
      color:#fff;font:600 13px/1 -apple-system,"Segoe UI",system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;
      box-shadow:0 3px 8px rgba(15,23,42,.28),inset 0 1px 0 rgba(255,255,255,.22);
      transition:transform .12s ease,box-shadow .12s ease,filter .12s ease}
    .mf-btn .mf-ico{font-size:16px;line-height:1}
    .mf-btn:hover:not(:disabled){transform:translateY(-2px);filter:brightness(1.1);
      box-shadow:0 6px 14px rgba(15,23,42,.32),inset 0 1px 0 rgba(255,255,255,.22)}
    .mf-btn:active:not(:disabled){transform:translateY(0);filter:brightness(.95)}
    .mf-btn:focus-visible{outline:3px solid rgba(23,167,232,.5);outline-offset:2px}
    .mf-btn:disabled{background:#b9c0c8!important;box-shadow:none;cursor:not-allowed;opacity:.9}
    .mf-moon{background:linear-gradient(135deg,#0b2354,#1f54a2)}
    .mf-impl{background:linear-gradient(135deg,#1493d0,#17a7e8)}
    .mf-ir{background:linear-gradient(135deg,#f8d559,#f5b933);color:#0b2354;text-shadow:none}
  `;
  document.head.appendChild(st);
}

function makeButton(cls, icon, text, { enabled, title, onClick }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `mf-btn ${cls}`;
  const i = document.createElement("span");
  i.className = "mf-ico";
  i.textContent = icon;
  const t = document.createElement("span");
  t.textContent = text;
  b.append(i, t);
  b.title = title || "";
  if (enabled) b.addEventListener("click", onClick);
  else b.disabled = true;
  return b;
}

// --- Inject buttons (record page): Moonpull form | New Implementation | IR ---
function injectButton(cardBody, mid, geo) {
  injectStyles();
  activeRoot().querySelectorAll("#moonfillSalesforceSection").forEach((e) => e.remove());

  const container = document.createElement("div");
  container.id = "moonfillSalesforceSection";
  container.className = "mf-row";
  container.dataset.recordId = getRecordIdFromUrl() || "";
  container.dataset.v = BUILD;

  const hasMid = !!(mid && mid.length >= 3);
  const noMid = "MID not found on this record";

  container.appendChild(makeButton("mf-moon", "🌙", "Submit Moonpull form", {
    enabled: hasMid,
    title: hasMid ? "Fill and submit the Moonpull form for this MID" : noMid,
    onClick: () => {
      const url = "https://forms.cloud.microsoft/pages/responsepage.aspx?id=07KaWlh7JUWYUdFycma616fCV2xjqwdEqzYTwuOkzBJUMU5JTTM1MTdVTVY5OVNKTk1TREtLU0wxUS4u&lang=en";
      const recordId = getRecordIdFromUrl();
      // Everything this scan needs travels with the click: no shared storage slot
      chrome.runtime.sendMessage({
        action: "openForm",
        url,
        mid,
        geo,
        program: getProgramName(),
        recordId,
        recordUrl: recordId ? `${location.origin}/lightning/r/TSE__c/${recordId}/view` : null
      });
    }
  }));

  const digits = (mid || "").replace(/\D/g, "");
  container.appendChild(makeButton("mf-ir", "🔎", "IR", {
    enabled: !!digits,
    title: digits ? "Open the Internal Review tabs for this MID" : noMid,
    onClick: () => chrome.runtime.sendMessage({ action: "createIRTabs", mid: digits })
  }));
  container.appendChild(makeButton("mf-impl", "🚀", "New Implementation", {
    enabled: !!digits,
    title: digits ? "Open the New Implementation tabs for this MID" : noMid,
    onClick: () => chrome.runtime.sendMessage({ action: "createNITabs", mid: digits })
  }));

  cardBody.appendChild(container);
  console.log("✅ Buttons injected");
}

// --- Case page: one IR button, above the "Case Details" card ---
const getCaseIdFromUrl = () =>
  (location.pathname.match(/\/lightning\/r\/Case\/([a-zA-Z0-9]{15,18})\/view/) || [])[1] || null;

// MID = "Awin UI Link" inside the "Program (Signed Product) Details" card
function readCaseMid() {
  const card = Array.from(activeRoot().querySelectorAll("article.slds-card")).find((c) => {
    const t = c.querySelector('div[role="heading"] a.slds-card__header-link, div[role="heading"] span.slds-card__header-title, .slds-card__header-link span');
    return t && t.textContent.trim().toLowerCase() === "program (signed product) details";
  });
  if (!card) return null;
  const label = Array.from(card.querySelectorAll("span.test-id__field-label, .slds-form-element__label"))
    .find((l) => l.textContent.trim().toLowerCase() === "awin ui link");
  const item = label && label.closest(".slds-form-element");
  if (!item) return null;
  const hit = Array.from(item.querySelectorAll("lightning-formatted-rich-text, lightning-formatted-text, lightning-formatted-number, output, a, span.test-id__field-value"))
    .map((e) => e.textContent.trim())
    .find((t) => /^\d+$/.test(t) && t !== "0");
  return hit || null;
}

function ensureCaseButton() {
  const caseId = getCaseIdFromUrl();
  if (!caseId) return;
  const root = activeRoot();
  const mid = readCaseMid() || "";
  const current = root.querySelector("#moonfillCaseSection");
  if (current && current.dataset.caseId === caseId && current.dataset.mid === mid && current.dataset.v === BUILD && isVisible(current)) return;

  const header = Array.from(root.querySelectorAll(".slds-card__header-title"))
    .find((e) => e.textContent.trim().toLowerCase() === "case details" && isVisible(e));
  const card = header && header.closest(".slds-card");
  if (!card || !card.parentElement) return; // page not drawn yet: next tick tries again

  injectStyles();
  root.querySelectorAll("#moonfillCaseSection").forEach((e) => e.remove());
  const section = document.createElement("div");
  section.id = "moonfillCaseSection";
  section.className = "mf-row mf-single";
  section.dataset.caseId = caseId;
  section.dataset.mid = mid;
  section.dataset.v = BUILD;
  section.appendChild(makeButton("mf-ir", "🔎", "IR", {
    enabled: !!mid,
    title: mid ? `Open the Internal Review tabs for MID ${mid}` : "MID not found in Program (Signed Product) Details yet",
    onClick: () => chrome.runtime.sendMessage({ action: "createIRTabs", mid })
  }));
  card.parentElement.insertBefore(section, card);
}

// --- Core record processing ---
const STALE = "record changed while waiting";
let processing = false;
const failedUntil = {}; // recordId -> timestamp: don't retry a failing record before this

async function processRecord() {
  const recordId = getRecordIdFromUrl();
  if (!recordId || processing) return;
  processing = true;
  console.log("🌙 Processing record:", recordId);

  // every wait gives up at once if the user has moved to another record
  const guard = (fn) => () => {
    if (getRecordIdFromUrl() !== recordId) throw STALE;
    return fn();
  };

  try {
    const midLink = await waitForElement(
      guard(() => visibleIn('a[href*="ui.awin.com/dashboard/awin/advertiser/"]')), 100, 200);
    // wait for the country LABEL (the value may be empty), so the form is drawn
    await waitForElement(guard(() =>
      Array.from(activeRoot().querySelectorAll(".test-id__field-label"))
        .find((l) => l.textContent.trim() === "Country of the program" && isVisible(l)) || null
    ), 100, 200);
    const cardBody = await waitForElement(
      guard(() => activeRoot().querySelector("div.slds-card__body.slds-card__body_inner")), 100, 200);

    if (getRecordIdFromUrl() !== recordId) return;

    const mid = (midLink.href.match(/advertiser\/(\d+)/) || [])[1] || null;
    const geo = normalizeGeo(
      readField("Country of the program"), readField("Region"), readField("Currency"));
    injectButton(cardBody, mid, geo);
    delete failedUntil[recordId];
  } catch (err) {
    if (err === STALE) return; // moved on: the next tick handles the new record
    console.warn("⚠️ Could not process record:", err);
    failedUntil[recordId] = Date.now() + 30000; // back off 30 s on this record
  } finally {
    processing = false;
  }
}

// ============================================================
// 🌙 Post a result to this record's Chatter feed.
// Called by background.js when a scan's result file is ready.
// Errors flagged retry:true happened before anything was shared,
// so background may safely try again; retry:false never repeats.
// ============================================================
// hidden = the page is not visible, which is why Lightning may not have drawn the Chatter box
const fail = (error, retry = true) => ({ ok: false, retry, hidden: document.visibilityState !== "visible", error });

// Replaces the editor content with the text (Quill picks up normal editing commands)
function insertText(editor, text) {
  editor.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor); // select all, so typing replaces any old draft
  sel.removeAllRanges();
  sel.addRange(range);

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line, i) => {
    if (i > 0) document.execCommand("insertParagraph");
    if (line) document.execCommand("insertText", false, line);
  });
  if (editor.textContent.trim()) return true;

  // Fallback: write the paragraphs directly; Quill's mutation observer picks them up
  editor.innerHTML = lines.map((l) => `<p>${l ? escapeHtml(l) : "<br>"}</p>`).join("");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return !!editor.textContent.trim();
}

async function postToChatter(text, recordId, share, opts = {}) {
  if (getRecordIdFromUrl() !== recordId) return fail("the page is not on the expected record", false);

  // fast = quick attempts (background tab); otherwise be patient (Force paste)
  const t = opts.fast ? { tab: 10000, box: 10000, editor: 8000 } : { tab: 30000, box: 20000, editor: 10000 };

  // After the tab was brought forward: if the page is still not visible, the browser
  // window itself is hidden (covered by another app or minimized). Report it at once.
  if (opts.activated) {
    await waitFor(() => document.visibilityState === "visible", opts.visibleWaitMs || 2000);
    if (document.visibilityState !== "visible") return fail("the browser window is not visible");
  }

  // Lightning keeps previously opened record pages in the DOM, hidden. A plain
  // document.querySelector can return the Chatter tab of one of those hidden
  // pages (it did on Hempea Global), so every lookup is scoped to the page that
  // is active now, and only visible elements count.
  const root = () => document.querySelector(".oneContent.active") || document;
  const firstVisible = (sel) => Array.from(root().querySelectorAll(sel)).find(isVisible) || null;

  const findChatterTab = () => firstVisible('a[data-tab-value="collaborateTab"]');
  const findEditor = () => firstVisible(".forceChatterMessageBodyInputRichTextEditor .ql-editor");
  const findPlaceholder = () =>
    Array.from(root().querySelectorAll("span.bBody")).find(
      (el) => el.textContent.trim() === "Share an update..." && isVisible(el)
    ) || null;
  const findShare = () =>
    firstVisible("button.cuf-publisherShareButton.qe-textPostDesktop:not([disabled])");

  // 1. Open the Chatter tab if the box isn't showing yet
  let editor = findEditor();
  let placeholder = editor ? null : findPlaceholder();
  if (!editor && !placeholder) {
    const tab = await waitFor(findChatterTab, t.tab);
    if (!tab) return fail("Chatter tab not found on this record");
    if (tab.getAttribute("aria-selected") !== "true") realClick(tab);
    await waitFor(() => (editor = findEditor()) || (placeholder = findPlaceholder()), t.box);
    if (!editor && !placeholder) {
      return fail('Chatter tab opened but the "Share an update..." box did not appear');
    }
  }

  // 2. Click "Share an update..." to expand the editor
  if (!editor) {
    realClick(placeholder.closest("button") || placeholder);
    editor = await waitFor(findEditor, t.editor);
    if (!editor) return fail('clicked "Share an update..." but the editor did not open');
  }
  await sleep(500);

  // 3. Paste the result
  if (!insertText(editor, text)) return fail("could not insert the text into the editor");

  // 4. Click Share once it becomes enabled
  const shareBtn = await waitFor(findShare, 8000);
  if (!shareBtn) return fail("the Share button stayed disabled");
  if (!share) return { ok: true, note: "text inserted, not shared" };

  shareBtn.click();

  // 5. Confirm: the editor empties once the post goes through
  const done = await waitFor(
    () => !document.contains(editor) || !editor.textContent.trim() || shareBtn.disabled,
    15000
  );
  if (!done) return fail("clicked Share but could not confirm the post", false);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== "moonfillPost") return;
  postToChatter(msg.text, msg.recordId, msg.share !== false, { fast: !!msg.fast, activated: !!msg.activated, visibleWaitMs: msg.visibleWaitMs })
    .then(sendResponse)
    .catch((e) => sendResponse(fail(String((e && e.message) || e), false)));
  return true; // async response
});

// ============================================================
// 🌙 Fill Salesforce fields from the Moonpull result.
// Called by background.js right after the result was pasted. Same approach as Techfill:
// open the Details tab, edit mode, set each field, Save. Existing values are OVERRIDDEN.
// ============================================================
const FF_SAVE = 'button[name="SaveEdit"]';
const FF_CANCEL = 'button[name="CancelEdit"]';
let ffFooterOutside = false; // some layouts draw the Save footer outside the Details tab

const ffNorm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\*/g, "").trim().toLowerCase();
const ffVisibleAll = (sel) => Array.from(activeRoot().querySelectorAll(sel)).filter(isVisible);

// The Details tab content: everything we click or fill lives in here, so the
// "Key Fields" box at the top of some records (its own pencil) is never touched.
function ffDetailsPanel() {
  const tab = ffVisibleAll('a[data-tab-value="detailTab"]')[0];
  if (!tab || tab.getAttribute("aria-selected") !== "true") return null;
  const id = tab.getAttribute("aria-controls");
  const byId = id && document.getElementById(id);
  if (byId && isVisible(byId)) return byId;
  return ffVisibleAll('[role="tabpanel"]').find((p) => p.querySelector(".test-id__field-label, .slds-form-element__label")) || null;
}
const ffScope = () => ffDetailsPanel() || activeRoot();
const ffInScope = (sel) => Array.from(ffScope().querySelectorAll(sel)).filter(isVisible);

function ffLabelText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll(".slds-assistive-text, lightning-helptext, abbr, button, svg").forEach((n) => n.remove());
  return ffNorm(c.textContent);
}

function ffFindFieldBox(label) {
  const want = ffNorm(label);
  const labels = ffScope().querySelectorAll(".slds-form-element__label, .slds-form-element__legend, .test-id__field-label");
  for (const l of labels) {
    if (!isVisible(l) || ffLabelText(l) !== want) continue;
    const box = l.closest(".slds-form-element");
    if (box) return box;
  }
  return null;
}

function ffControlOf(box) {
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
  return null;
}

function ffComboOptions(btn) {
  const scopeEl = btn.closest(".slds-combobox") || btn.closest(".slds-form-element") || activeRoot();
  return Array.from(scopeEl.querySelectorAll('[role="option"], lightning-base-combobox-item')).filter(isVisible);
}
function ffOptionText(o) {
  const c = (o.querySelector(".slds-truncate, .slds-media__body") || o).cloneNode(true);
  c.querySelectorAll(".slds-assistive-text, svg, lightning-icon").forEach((n) => n.remove());
  return ffNorm(c.textContent);
}
const ffOptionMatches = (o, want) => {
  const w = ffNorm(want);
  return ffOptionText(o) === w || ffNorm(o.getAttribute("data-value")) === w;
};

// Picklists (Yes / No / list of options). Always overrides.
async function ffSetCombobox(btn, value) {
  if (ffNorm(btn.textContent) === ffNorm(value)) return { status: "same" };
  let opt = null;
  for (let attempt = 0; attempt < 2 && !opt; attempt++) { // the first click can be swallowed
    btn.click();
    opt = await waitFor(() => ffComboOptions(btn).find((o) => ffOptionMatches(o, value)), 2500, 150);
    if (!opt) {
      if (btn.getAttribute("aria-expanded") === "true") btn.click();
      await sleep(250);
    }
  }
  if (!opt) {
    btn.click();
    await sleep(300);
    const seen = ffComboOptions(btn).map(ffOptionText).filter(Boolean);
    if (btn.getAttribute("aria-expanded") === "true") btn.click();
    return {
      status: "problem",
      why: seen.length ? `option "${value}" not in the list (saw: ${seen.slice(0, 8).join(" | ")})` : "the dropdown did not open"
    };
  }
  realClick(opt);
  await sleep(200);
  return { status: "set" };
}

function ffSetSelect(sel, value) {
  const cur = sel.selectedOptions[0] ? ffNorm(sel.selectedOptions[0].text) : "";
  if (cur === ffNorm(value)) return { status: "same" };
  const opt = Array.from(sel.options).find((o) => ffNorm(o.text) === ffNorm(value) || ffNorm(o.value) === ffNorm(value));
  if (!opt) return { status: "problem", why: `option "${value}" not in the list` };
  sel.value = opt.value;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return { status: "set" };
}

function ffSetRadio(radios, value) {
  const textOf = (r) => ffNorm((r.closest(".slds-radio") || r.parentElement).textContent);
  const target = radios.find((r) => textOf(r) === ffNorm(value));
  if (!target) return { status: "problem", why: `option "${value}" not found` };
  if (target.checked) return { status: "same" };
  target.click();
  return { status: "set" };
}

async function ffApplyField({ label, value }) {
  const box = ffFindFieldBox(label);
  if (!box) return { status: "notfound" };
  const c = ffControlOf(box);
  if (!c) return { status: "problem", why: "no editable control (read-only?)" };
  try {
    switch (c.kind) {
      case "combobox": return await ffSetCombobox(c.el, value);
      case "select": return ffSetSelect(c.el, value);
      case "radio": return ffSetRadio(c.els, value);
      default: return { status: "problem", why: "unsupported field type" };
    }
  } catch (e) {
    return { status: "problem", why: String((e && e.message) || e) };
  }
}

const ffSaveButton = () => ffInScope(FF_SAVE)[0] || (ffFooterOutside ? ffVisibleAll(FF_SAVE)[0] : null) || null;
const ffEditTrigger = () => ffInScope("button.test-id__inline-edit-trigger")[0] || null;

async function ffOpenDetailsTab() {
  const tab = ffVisibleAll('a[data-tab-value="detailTab"]')[0];
  if (!tab) return;
  if (tab.getAttribute("aria-selected") !== "true") realClick(tab);
  await waitFor(() => ffDetailsPanel() && (ffEditTrigger() || ffSaveButton()), 8000);
}

function ffExpandSections() {
  ffInScope('button.slds-section__title-action[aria-expanded="false"], button.slds-accordion__summary-action[aria-expanded="false"]')
    .forEach((b) => b.click());
}

async function ffEnsureEditMode() {
  ffFooterOutside = false;
  if (ffSaveButton()) return true;
  const trigger = ffEditTrigger();
  if (!trigger) return false;
  trigger.click();
  const found = await waitFor(() => ffSaveButton() || ffVisibleAll(FF_SAVE)[0], 8000);
  if (found && !ffSaveButton()) ffFooterOutside = true;
  return !!found;
}

// One writer at a time on the record: Techfill takes the same lock (<html data-awin-edit-lock>) while it fills.
// If Techfill left its review form open on this record, the scan fields are filled into it but NOT saved.
async function fillMoonpullFields(recordId, fields, save) {
  const root = document.documentElement;
  const free = await waitFor(() => !root.dataset.awinEditLock || root.dataset.awinEditLock === "moonfill", 30000, 500);
  if (!free) return { ok: false, error: "Techfill is filling this record, so the scan fields were not filled (Force paste retries)" };
  root.dataset.awinEditLock = "moonfill";
  try {
    const reviewForm = root.dataset.techfillOpenEdit === recordId && ffVisibleAll(FF_SAVE).length > 0;
    const rep = await fillMoonpullFieldsInner(recordId, fields, save && !reviewForm);
    if (reviewForm && rep && rep.ok) { rep.reviewForm = true; rep.keepOpen = rep.keepOpen || rep.set.length > 0; }
    return rep;
  } finally {
    if (root.dataset.awinEditLock === "moonfill") delete root.dataset.awinEditLock;
  }
}

async function fillMoonpullFieldsInner(recordId, fields, save) {
  if (getRecordIdFromUrl() !== recordId) return { ok: false, error: "the page is not on the expected record" };
  if (document.visibilityState !== "visible") return { ok: false, error: "the page is not visible" };
  const rep = { ok: true, set: [], same: [], notfound: [], problem: [], saved: false, keepOpen: false, saveFailed: false };

  await ffOpenDetailsTab();
  ffExpandSections();
  await sleep(300);
  if (!(await ffEnsureEditMode())) return { ok: false, error: "could not open edit mode on the Details tab" };
  await sleep(300);

  // Fields lower on the page can still be drawing when the Details tab has just opened:
  // wait for each one (expanding collapsed sections) and give misses a second chance.
  const results = new Map();
  const tryField = async (f) => {
    if (!ffFindFieldBox(f.label)) await waitFor(() => { ffExpandSections(); return ffFindFieldBox(f.label); }, 8000, 300);
    return ffApplyField(f);
  };
  for (const f of fields) {
    if (getRecordIdFromUrl() !== recordId) return { ...rep, ok: false, error: "moved to another record while filling" };
    results.set(f.label, await tryField(f));
    await sleep(250);
  }
  const retry = fields.filter((f) => ["notfound", "problem"].includes(results.get(f.label).status));
  if (retry.length) {
    await sleep(1500);
    for (const f of retry) results.set(f.label, await tryField(f));
  }
  for (const f of fields) {
    const r = results.get(f.label);
    if (r.status === "problem") rep.problem.push(`${f.label}: ${r.why}`);
    else rep[r.status].push(f.label);
  }
  console.log("[Moonfill] field fill:", rep);

  if (!rep.set.length) { // nothing changed: leave edit mode cleanly
    const cancel = ffInScope(FF_CANCEL)[0] || ffVisibleAll(FF_CANCEL)[0];
    if (cancel) cancel.click();
    return rep;
  }
  if (!save) { rep.keepOpen = true; return rep; } // review mode: user clicks Save

  const btn = ffSaveButton() || ffVisibleAll(FF_SAVE)[0];
  if (!btn) { rep.keepOpen = true; rep.saveFailed = true; return rep; }
  btn.click();
  const closed = await waitFor(() => !ffVisibleAll(FF_SAVE).length, 12000);
  rep.saved = !!closed;
  if (!closed) { rep.keepOpen = true; rep.saveFailed = true; }
  return rep;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== "moonfillFill") return;
  fillMoonpullFields(msg.recordId, msg.fields || [], !!msg.save)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async response
});

// --- 🔁 Self-healing loop ---
// No navigation detection: every second, make sure the ACTIVE record page has a
// button tagged with the current record ID, and build it if not. Works whether you
// arrive from the list, Teams, a pasted link or the back button.
function buttonIsCurrent() {
  const b = activeRoot().querySelector("#moonfillSalesforceSection");
  return !!b && b.dataset.recordId === getRecordIdFromUrl() && b.dataset.v === BUILD && isVisible(b);
}

setInterval(() => {
  try { ensureCaseButton(); } catch (e) { /* page mid-redraw: next tick */ }
  const id = getRecordIdFromUrl();
  if (!id || processing || buttonIsCurrent()) return;
  if (failedUntil[id] && Date.now() < failedUntil[id]) return;
  processRecord();
}, 1000);
