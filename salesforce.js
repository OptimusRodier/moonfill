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

// --- Inject button ---
function injectButton(cardBody, mid, geo) {
  activeRoot().querySelectorAll("#moonfillSalesforceSection").forEach((e) => e.remove());

  const container = document.createElement("div");
  container.id = "moonfillSalesforceSection";
  container.dataset.recordId = getRecordIdFromUrl() || "";
  container.style.marginTop = "10px";

  const button = document.createElement("button");
  button.textContent = "🌙 Submit Moonpull form";
  button.style.cssText = `
    display:inline-flex;align-items:center;background-color:${mid && mid.length >=3 ? "#015475":"#ccc"};
    color:white;font-weight:600;padding:6px 12px;border:none;border-radius:8px;
    cursor:${mid && mid.length >=3 ? "pointer":"not-allowed"};
    box-shadow:0 2px 6px rgba(0,0,0,0.2);
  `;

  if (mid && mid.length >=3) {
    button.addEventListener("click", () => {
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
    });
  }

  container.appendChild(button);
  cardBody.appendChild(container);
  console.log("✅ Button injected");
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
    await waitFor(() => document.visibilityState === "visible", 2000);
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
  postToChatter(msg.text, msg.recordId, msg.share !== false, { fast: !!msg.fast, activated: !!msg.activated })
    .then(sendResponse)
    .catch((e) => sendResponse(fail(String((e && e.message) || e), false)));
  return true; // async response
});

// --- 🔁 Self-healing loop ---
// No navigation detection: every second, make sure the ACTIVE record page has a
// button tagged with the current record ID, and build it if not. Works whether you
// arrive from the list, Teams, a pasted link or the back button.
function buttonIsCurrent() {
  const b = activeRoot().querySelector("#moonfillSalesforceSection");
  return !!b && b.dataset.recordId === getRecordIdFromUrl() && isVisible(b);
}

setInterval(() => {
  const id = getRecordIdFromUrl();
  if (!id || processing || buttonIsCurrent()) return;
  if (failedUntil[id] && Date.now() < failedUntil[id]) return;
  processRecord();
}, 1000);
