console.log("🌙 Moonfill Salesforce RTP script active.");

// --- GEO Mapping ---
const countryToGeo = {
  "United Kingdom": "GB", "France": "FR", "Germany": "DE",
  "United States of America": "US", "Spain": "ES", "Italy": "IT",
  "Netherlands": "NL", "Belgium": "NL", "Luxembourg": "NL",
  "Brazil": "BR", "Sweden": "SE", "Poland": "PL", "Portugal": "PT",
  "Austria": "AT", "Switzerland": "CH", "Ireland": "IE", "Canada": "US"
};
function normalizeGeo(country) {
  if (countryToGeo[country]) return countryToGeo[country];
  const lower = country.toLowerCase();
  if (["norway", "denmark", "finland"].some(c => lower.includes(c))) return "DE";
  if (["mexico", "colombia", "argentina", "chile", "peru"].some(c => lower.includes(c))) return "BR";
  return "GB";
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
      const el = selectorFunc();
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

// --- Program name (shown in the popup) ---
// Tries a "Program name" field first, then the record title, then the tab title.
function getProgramName() {
  try {
    const label = Array.from(document.querySelectorAll(".test-id__field-label"))
      .find((l) => /^program( name)?$/i.test(l.textContent.trim()));
    if (label) {
      const v = label.closest(".slds-form-element")
        ?.querySelector("lightning-formatted-text, .test-id__field-value");
      if (v && v.textContent.trim()) return v.textContent.trim();
    }
    const title = document.querySelector('[slot="primaryField"], .slds-page-header__title');
    if (title && title.textContent.trim()) return title.textContent.trim();
    const t = document.title.split("|")[0].trim();
    if (t) return t;
  } catch (e) { /* fall through */ }
  return null;
}

// --- Inject button ---
function injectButton(cardBody, mid, geo) {
  const old = document.getElementById("moonfillSalesforceSection");
  if (old) old.remove();

  const container = document.createElement("div");
  container.id = "moonfillSalesforceSection";
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
async function processRecord() {
  const recordId = getRecordIdFromUrl();
  if (!recordId) return;
  console.log("🌙 Processing record:", recordId);

  try {
    const midLink = await waitForElement(() => document.querySelector(`a[href*="ui.awin.com/dashboard/awin/advertiser/"]`));
    const countryLabel = await waitForElement(() => {
      const label = Array.from(document.querySelectorAll(".test-id__field-label"))
        .find(l => l.textContent.trim() === "Country of the program");
      return label ? label.closest(".slds-form-element").querySelector("lightning-formatted-text") : null;
    });

    const midMatch = midLink.href.match(/advertiser\/(\d+)/);
    const mid = midMatch ? midMatch[1] : null;
    const country = countryLabel?.textContent?.trim() || "";
    const geo = normalizeGeo(country);

    const cardBody = await waitForElement(() => document.querySelector("div.slds-card__body.slds-card__body_inner"));
    injectButton(cardBody, mid, geo);

  } catch (err) {
    console.warn("⚠️ Could not process record:", err);
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

// --- 🔥 Bulletproof Navigation Detector ---
let lastUrl = location.href;

// 1️⃣ Patch History API (detect Lightning internal nav)
function hookHistory() {
  ["pushState", "replaceState"].forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      const newUrl = location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        if (newUrl.includes("/r/TSE__c/")) {
          console.log(`⚡ Navigation via ${method} — reprocessing`);
          setTimeout(processRecord, 500);
        }
      }
      return result;
    };
  });
}

// 2️⃣ Mutation Observer fallback
const observer = new MutationObserver(() => {
  const current = location.href;
  if (current !== lastUrl && current.includes("/r/TSE__c/")) {
    lastUrl = current;
    console.log("👀 Route changed (DOM observer)");
    setTimeout(processRecord, 500);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// 3️⃣ Initialize
hookHistory();
processRecord();
