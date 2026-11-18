importScripts("detect-platform.js"); // platform detection (PlatformDetect)
// background.js
// One scan = one job, visible in the popup from the click until it is pasted.
// Each form tab carries its own MID/geo/record, the Forms response ID read on
// submit links the job to its result file, and the finished result is posted
// to the record's Chatter feed. If the browser window is hidden when the result
// arrives, the job waits ("waiting_browser") instead of failing, and posts as
// soon as a browser window is in front. "Force paste" does it on demand.

// Folder where the flow saves "<ResponseId>.txt" (must end with "/")
const RESULT_FOLDER_URL =
  "https://zanox.sharepoint.com/teams/Global-MoonpullI-Integration/Shared%20Documents/General/batch%20results%20use%20cases/Integartion%20Tests/Moonpull%20Integration%20dataCenter/";

const POLL_FAST_MS = 2000;                 // from 2:30 on, when the result is due (3-5 min), look every 2 s
const FAST_AFTER_MS = 150 * 1000;
const POLL_MS = 10 * 1000;                 // before that, check every 10 s from the moment the form is submitted
                                           // (the result file lives ~30 s, so never poll slower than ~15 s)
const JOB_TIMEOUT_MS = 6.5 * 60 * 1000;    // result appears ~5:00 and is deleted ~30 s later, stop at 6:30
const PARKED_TIMEOUT_MS = 8 * 60 * 60 * 1000; // a waiting result is kept for 8 hours
const PARK_RETRY_MS = 15000;               // retry a waiting result every 15 s while a browser window is focused
const AUTO_SHARE = true;                   // false = paste into Chatter but don't click Share (tab stays open for review)
const AUTO_WINDOW = true;                   // browser hidden/behind other apps: open a temporary window, paste, close it
const ACTIVE = ["submitting", "waiting", "posting", "waiting_browser"];
const HISTORY_MAX = 50;                    // finished jobs kept for the History view
const FAILED_BADGE_MS = 10 * 60 * 1000;    // "!" on the icon for 10 minutes after a failure

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabKey = (tabId) => `moonfillTab_${tabId}`;
const jobKey = (id) => `moonfillJob_${id}`;
const label = (job) => job.program || `MID ${job.mid}`;

chrome.runtime.onInstalled.addListener(() => console.log("Moonfill extension installed"));
chrome.runtime.onStartup.addListener(() => ensurePolling());

// kind: "done" | "failed" | "parked" | "folder". The id carries the job, so a click
// still works after the service worker has been restarted.
// buttons: up to 2 labels; what they do is decided in onButtonClicked below.
function notify(title, message, { jobId, kind, buttons, sticky } = {}) {
  const id = kind ? `moonfill|${kind}|${jobId || ""}|${Date.now()}` : "";
  const options = { type: "basic", iconUrl: "assets/icon128.png", title, message };
  if (buttons && buttons.length) options.buttons = buttons.map((t) => ({ title: t }));
  if (sticky) options.requireInteraction = true; // stays until clicked or closed
  chrome.notifications.create(id, options, () => void chrome.runtime.lastError);
}

async function getJob(id) {
  const k = jobKey(id);
  return (await chrome.storage.local.get(k))[k];
}

// Open the toolbar popup; if the browser refuses (not focused, older version), open it as a small window
async function openMoonfill() {
  try { await chrome.action.openPopup(); return; } catch (e) { /* fall through */ }
  const url = chrome.runtime.getURL("popup.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: "popup", width: 380, height: 560 });
}

// Go to the record where the result was pasted (reuse the tab if it is already open)
async function openRecord(job) {
  const origin = new URL(job.recordUrl).origin;
  const [existing] = await chrome.tabs.query({ url: `${origin}/lightning/r/TSE__c/${job.recordId}/*` });
  const tab = existing
    ? await chrome.tabs.update(existing.id, { active: true })
    : await chrome.tabs.create({ url: job.recordUrl, active: true });
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) { /* ignore */ }
}

chrome.notifications.onClicked.addListener(async (nid) => {
  const [tag, kind, jobId] = nid.split("|");
  if (tag !== "moonfill") return;
  chrome.notifications.clear(nid);
  const job = jobId ? await getJob(jobId) : null;
  if (kind === "done" && job) return openRecord(job);
  if (kind === "folder") return void chrome.tabs.create({ url: SP_SITE });
  return openMoonfill(); // failed / parked: the card with Force paste is there
});

chrome.notifications.onButtonClicked.addListener(async (nid, idx) => {
  const [tag, kind, jobId] = nid.split("|");
  if (tag !== "moonfill") return;
  chrome.notifications.clear(nid);
  const job = jobId ? await getJob(jobId) : null;
  if (kind === "done" && job) return openRecord(job);
  if ((kind === "failed" || kind === "parked") && job && job.resultText && idx === 0) return forcePost(jobId);
  return openMoonfill();
});

// ---------- result text: drop the requester's name and job title ----------
// The flow writes "Your ... scan is complete for:" followed by the requester's
// name and title. Neither is needed in the Chatter post.
// ---------- Moonpull result -> Salesforce field values ----------
// Parsed from the raw result and stored on the job, so Force paste can still fill them
// after the result file has been deleted.
const CMP_OPTIONS = ["Cookiebot", "Iubenda", "OneTrust", "Osano", "Sourcepoint", "Google Consent Mode"];
const flat = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function resultLine(text, key) {
  // tolerant: bullets / bold markers before the key, the key anywhere on its line
  const m = new RegExp("(?<![A-Za-z0-9_])" + key + "[*_ \\t]*:[ \\t]*(.*)$", "im").exec(text);
  return m ? m[1].replace(/^[*_\s]+|[*_\s]+$/g, "") : null; // null = the line is not in the result
}

function parseMoonpullFields(raw) {
  const out = [];
  const add = (label, value) => out.push({ label, value });

  // Moonpull Status <- Enhanced Memory Cookie Status
  const mem = resultLine(raw, "Enhanced Memory Cookie Status");
  if (mem !== null) {
    const k = mem.toLowerCase();
    let v = "Review in platform"; // anything else
    if (k.includes("on user consent")) v = "Memory on user consent";
    else if (k.includes("not found")) v = "Critical";
    else if (k.includes("appears immediately")) v = "Healthy";
    else if (k.includes("closed advertiser")) v = "Warning";
    add("Moonpull Status", v);
  }

  const yesNo = (s) => (/^true$/i.test(s || "") ? "Yes" : /^false$/i.test(s || "") ? "No" : null);
  // Yes/No fields: anything that is not an explicit true (missing line included) is No
  add("Consent Signals", yesNo(resultLine(raw, "EnhancedCustomVariable_AfterConsent")) || "No");
  add("Transparency & Consent Framework Plugin", yesNo(resultLine(raw, "EnhancedCustomVariable_AfterConsentAndRefresh")) || "No");

  // AASAF: Yes only when every association line that is in the result says 1
  const flags = ["Apple Site App Association", "Android Site App Association"]
    .map((k) => resultLine(raw, k))
    .filter((v) => v !== null)
    .map((v) => v === "1");
  add("AASAF", flags.length && flags.every(Boolean) ? "Yes" : "No");

  // Consent Management Platform: a listed CMP, otherwise Other
  const cmp = resultLine(raw, "Enhanced CMP Details");
  const hit = cmp !== null && CMP_OPTIONS.find((o) => flat(cmp).includes(flat(o)));
  add("Consent Management Platform", hit || "Other"); // no matching option (or no line) = Other
  return out;
}

// After the result is pasted the Salesforce fields are always filled and saved (no setting)
const FILL_FIELDS = true;

function cleanResult(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^(.*scan is complete)[ \t]*for:[ \t]*\n[\s\S]*?\n(?=\s*Input:)/im, "$1\n");
}

// ---------- first line of every post: "Pasted via Moonfill v<version>" ----------
// The version is read from manifest.json, so bumping it there updates every post.
function withPromo(text) {
  if (/^\s*Pasted via Moonfill/i.test(text)) return text; // never twice
  return `Pasted via Moonfill v${chrome.runtime.getManifest().version}\n${text}`;
}

// ---------- job storage (one key per job, so jobs never overwrite each other) ----------
async function getJobs() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith("moonfillJob_")).map((k) => all[k]);
}
const saveJob = (job) => chrome.storage.local.set({ [jobKey(job.id)]: job });
const removeJob = (id) => chrome.storage.local.remove(jobKey(id));

async function refreshBadge() {
  const jobs = await getJobs();
  const n = jobs.filter((j) => ACTIVE.includes(j.state)).length;
  const parked = jobs.some((j) => j.state === "waiting_browser");
  const failed = jobs.some((j) => j.state === "failed" && Date.now() - j.finishedAt < FAILED_BADGE_MS);
  chrome.action.setBadgeText({ text: n ? String(n) : failed ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: parked ? "#d97706" : n ? "#015475" : "#bc2f32" });
}

// Keep the newest HISTORY_MAX finished jobs for the History view
async function pruneFinished() {
  const finished = (await getJobs())
    .filter((j) => j.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt);
  for (const j of finished.slice(HISTORY_MAX)) await removeJob(j.id);
  await refreshBadge();
}

async function finishJob(job, state, error, note) {
  job.state = state;
  job.finishedAt = Date.now();
  job.error = error || null;
  job.note = note || null;
  if (state === "done") { delete job.resultText; delete job.fields; }
  await saveJob(job);
  chrome.alarms.create("moonfillPrune", { delayInMinutes: 11 }); // clears the "!" badge later
  if (state === "failed") {
    notify(
      "Moonfill: scan failed",
      `${label(job)}: ${error}. ` +
        (job.resultText ? "Click to open Moonfill (Force paste / Copy result)." : "Click to open Moonfill. Check Teams/email for the result."),
      {
        jobId: job.id,
        kind: "failed",
        sticky: true,
        buttons: job.resultText ? ["Force paste", "Open Moonfill"] : ["Open Moonfill"]
      }
    );
  }
  await pruneFinished();
}

// ---------- start a scan: one form tab + one job ----------
async function createFormTab(url, info) {
  const jobId = crypto.randomUUID();
  const tab = await chrome.tabs.create({ url, active: true }); // must be focused so MS Forms renders
  await chrome.storage.session.set({
    [tabKey(tab.id)]: { ...info, jobId, at: Date.now(), submitted: false }
  });
  if (info.recordId) {
    await saveJob({
      id: jobId,
      program: info.program || null,
      mid: info.mid,
      geo: info.geo,
      recordId: info.recordId,
      recordUrl: info.recordUrl,
      startedAt: Date.now(),
      state: "submitting",
      errors: 0
    });
    await refreshBadge();
    ensurePolling();
  }
}

// From the injected button on the Salesforce record
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.action === "openForm" && msg.url) {
    createFormTab(msg.url, {
      mid: msg.mid,
      geo: msg.geo,
      program: msg.program,
      originTabId: sender && sender.tab ? sender.tab.id : null,
      recordId: msg.recordId || null,
      recordUrl: msg.recordUrl || null
    });
  }
});

// content.js asks "is this tab a Moonfill run, and for which MID/geo?"
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== "moonfillShouldFill") return;
  (async () => {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (!tabId) return sendResponse({ fill: false });
    const key = tabKey(tabId);
    const info = (await chrome.storage.session.get(key))[key];
    if (info && !info.submitted && Date.now() - info.at < 5 * 60 * 1000) {
      sendResponse({ fill: true, advertiserID: info.mid, geo: info.geo });
    } else {
      sendResponse({ fill: false });
    }
  })();
  return true;
});

// ---------- read the Forms response ID the moment the form is submitted ----------
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.method !== "POST" || details.statusCode !== 201) return;
    const loc = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === "location");
    const m = loc && /responses\((\d+)\)/.exec(loc.value || "");
    if (m) handleSubmitted(details.tabId, m[1]);
  },
  {
    urls: [
      "https://forms.cloud.microsoft/formapi/api/*",
      "https://forms.office.com/formapi/api/*"
    ],
    types: ["xmlhttprequest"]
  },
  ["responseHeaders"]
);

async function handleSubmitted(formTabId, responseId) {
  const key = tabKey(formTabId);
  const info = (await chrome.storage.session.get(key))[key];
  if (!info) return; // not a Moonfill run
  info.submitted = true;
  await chrome.storage.session.set({ [key]: info });

  const jk = jobKey(info.jobId);
  const job = info.jobId ? (await chrome.storage.local.get(jk))[jk] : null;
  if (!job) return;
  console.log("background: submitted, response ID", responseId, "MID", job.mid);
  job.responseId = responseId;
  job.submittedAt = Date.now();
  job.state = "waiting";
  await saveJob(job);
  await refreshBadge();
  ensurePolling();
}

// ---------- polling loop ----------
let polling = false;
async function ensurePolling() {
  if (polling) return;
  polling = true;
  try {
    let alarmSet = false;
    while (true) {
      await pruneFinished();
      let active = (await getJobs()).filter((j) => ACTIVE.includes(j.state));

      // Stuck jobs
      for (const j of active) {
        if (j.state === "submitting" && Date.now() - j.startedAt > 3 * 60 * 1000) {
          await finishJob(j, "failed", "the form was not submitted");
        } else if (j.state === "posting" && Date.now() - (j.postingAt || 0) > 3 * 60 * 1000 && !busy.has(j.id)) {
          await finishJob(j, "failed", "posting was interrupted, check Chatter");
        }
      }
      active = active.filter((j) => ACTIVE.includes(j.state));

      if (!active.length) {
        chrome.alarms.clear("moonfillPoll");
        break;
      }
      if (!alarmSet) {
        // backup: wakes the worker if Chrome shuts it down while jobs are pending
        chrome.alarms.create("moonfillPoll", { periodInMinutes: 0.5 });
        alarmSet = true;
      }
      for (const job of active) {
        const fresh = (await chrome.storage.local.get(jobKey(job.id)))[jobKey(job.id)];
        if (!fresh || fresh.state !== job.state) continue; // changed meanwhile (e.g. Force paste)
        if (job.state === "waiting") await processJob(job);
        else if (job.state === "waiting_browser") await retryParked(job);
      }
      const due = active.some((j) => j.state === "waiting" && Date.now() - (j.submittedAt || j.startedAt) >= FAST_AFTER_MS);
      await sleep(due ? POLL_FAST_MS : POLL_MS);
    }
  } finally {
    polling = false;
  }
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "moonfillPoll") ensurePolling();
  if (a.name === "moonfillPrune") pruneFinished();
});
ensurePolling(); // also runs whenever the worker wakes up

// ---------- one job: fetch the file, check it, post it ----------
// Same folder, addressed through the SharePoint REST API (fallback if the plain file URL fails)
const SP_SITE = "https://zanox.sharepoint.com/teams/Global-MoonpullI-Integration";
const SP_FOLDER_PATH =
  "/teams/Global-MoonpullI-Integration/Shared Documents/General/batch results use cases/Integartion Tests/Moonpull Integration dataCenter/";

async function tryFetch(url) {
  try {
    const res = await fetch(url, { credentials: "include", cache: "no-store", headers: { Accept: "text/plain,*/*" } });
    if (res.status === 404) return { status: "notfound" };
    if (!res.ok) return { status: "error", code: res.status, detail: `HTTP ${res.status}` };
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) return { status: "auth", detail: "got a login/HTML page instead of the file" };
    return { status: "ok", text: text.replace(/^\uFEFF/, "") };
  } catch (e) {
    // a redirect to login.microsoftonline.com ends up here as "Failed to fetch"
    return { status: "error", message: e.message, detail: `network/redirect error (${e.message})` };
  }
}

async function readResultFile(responseId) {
  const file = responseId + ".txt";
  const direct = RESULT_FOLDER_URL + encodeURIComponent(file);
  const rest =
    SP_SITE + "/_api/web/GetFileByServerRelativePath(decodedurl='" +
    encodeURIComponent(SP_FOLDER_PATH + file) + "')/$value";

  let r = await tryFetch(direct);
  if (r.status === "ok" || r.status === "notfound") return r;
  const first = r.detail;
  const r2 = await tryFetch(rest);
  if (r2.status === "ok" || r2.status === "notfound") return r2;
  r2.detail = `direct: ${first}; REST: ${r2.detail}`;
  console.warn("Moonfill: could not read result file:", r2.detail);
  return r2;
}

async function processJob(job) {
  if (Date.now() - (job.submittedAt || job.startedAt) > JOB_TIMEOUT_MS) {
    await finishJob(job, "failed", "no result after 6.5 minutes");
    return;
  }

  const r = await readResultFile(job.responseId);
  if (r.status === "notfound") {
    if (job.errors) { job.errors = 0; await saveJob(job); }
    return; // normal: scan not finished yet
  }
  if (r.status !== "ok") {
    job.errors = (job.errors || 0) + 1;
    if (job.errors === 6) {
      notify(
        "Moonfill: can't read the result folder",
        `${r.detail || "unknown error"}. Click to open SharePoint and refresh your session. Still trying.`,
        { kind: "folder", sticky: true }
      );
    }
    await saveJob(job);
    return;
  }
  if (!r.text.trim()) return;

  // Safety: the MID inside the result must be the MID we submitted
  const m = /Advertiser ID:\s*(\d+)/i.exec(r.text);
  if (m && m[1] !== String(job.mid)) {
    await finishJob(job, "failed", `result is for MID ${m[1]}, expected ${job.mid}. Nothing was posted`);
    return;
  }

  // Keep the text right away: the file is deleted ~30 s after it appears, so if posting
  // fails or is interrupted, Force paste / Copy result still have something to work with
  const text = withPromo(cleanResult(r.text));
  job.resultText = text;
  job.fields = parseMoonpullFields(r.text);
  await saveJob(job);
  await attemptPost(job, text, false);
}

// A waiting result is retried whenever a browser window is focused (so it is visible)
async function browserFocused() {
  const wins = await chrome.windows.getAll();
  return wins.some((w) => w.focused);
}

async function retryParked(job) {
  if (Date.now() - (job.parkedAt || 0) > PARKED_TIMEOUT_MS) {
    await finishJob(job, "failed", "the browser was not brought to the front for 8 hours");
    return;
  }
  if (Date.now() - (job.lastTry || 0) < PARK_RETRY_MS) return;
  if (!(await browserFocused())) return;
  await attemptPost(job, job.resultText, false);
}

// Posts once and moves the job to its next state: done, waiting_browser or failed
const busy = new Set();
async function attemptPost(job, text, forced) {
  if (busy.has(job.id)) return;
  busy.add(job.id);
  try {
    job.state = "posting";
    job.trace = []; // step log of this attempt, shown in the popup
    job.postingAt = Date.now();
    job.lastTry = Date.now();
    await saveJob(job);
    await refreshBadge();

    const res = await postResultToRecord(job, text, forced);
    console.log("Moonfill post steps:", (job.trace || []).join(" -> "));

    if (res.ok) {
      job.fillNote = fillNoteOf(res.fill, job);
      console.log("Moonfill fields sent:", JSON.stringify(job.fields || []), "->", JSON.stringify(res.fill || null));
      await finishJob(job, "done", null, res.note);
      notify(
        "Moonfill: result pasted",
        `${label(job)}: ` + (res.note ? "text pasted, click Share to post it." : "posted to Chatter.") +
          (job.fillNote ? " " + job.fillNote + "." : "") + " Click to open the record.",
        { jobId: job.id, kind: "done", buttons: ["Check result"] }
      );
    } else if (res.hidden && res.retry && !forced) {
      // The window is hidden, so Lightning won't draw the Chatter box. Not a failure: wait.
      job.state = "waiting_browser";
      job.resultText = text;
      job.parkedAt = job.parkedAt || Date.now();
      await saveJob(job);
      await refreshBadge();
      if (!job.notifiedParked) {
        job.notifiedParked = true;
        await saveJob(job);
        notify(
          "Moonfill: result ready",
          `${label(job)}: it will be pasted as soon as you bring the browser to the front.`,
          { jobId: job.id, kind: "parked", buttons: ["Force paste", "Open Moonfill"] }
        );
      }
    } else {
      job.resultText = text; // so the popup can offer Copy result / Force paste
      await finishJob(job, "failed", res.error);
    }
  } finally {
    busy.delete(job.id);
  }
}

// Force paste (from the popup): bring the record forward and post now
async function forcePost(jobId) {
  const job = await getJob(jobId);
  if (!job || !job.resultText || !["failed", "waiting_browser"].includes(job.state)) return;
  job.error = null;
  job.finishedAt = null;
  ensurePolling();
  await attemptPost(job, job.resultText, true);
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.action !== "forcePost" || !msg.jobId) return;
  forcePost(msg.jobId);
});

// ---------- platform detection (asked by the Techfill orb when a record opens) ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== "detectPlatform") return undefined;
  PlatformDetect.run(msg.url).then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true; // answers asynchronously
});

// ---------- entry points used by the Techfill orb and the popup ----------
async function openPresetsWindow() {
  const url = chrome.runtime.getURL("presets.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: "popup", width: 500, height: 780 });
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.action === "openPresets") openPresetsWindow().catch(() => {});
  else if (msg.action === "openMoonfillPopup") openMoonfill().catch(() => {});
});

// ---------- New Implementation / IR: open the setup tabs for a MID as one tab group ----------
// (URL lists taken from Awin Helper.) Buttons live on the Salesforce record / Case page.
const NI_URLS = (mid) => [
  `https://ui.awin.com/tracking-settings/us/awin/advertiser/${mid}/main-settings`,
  `https://ui.awin.com/awin/merchant/${mid}/settings/invite-user`,
  `https://ui.awin.com/commission-manager/us/awin/merchant/${mid}/commission-groups`,
  `https://ui.awin.com/advertiser-mastertag/us/awin/${mid}/plugins`,
  `https://ui.awin.com/advertiser-mastertag/us/awin/${mid}/trackingtagsettings`,
  `https://ui.awin.com/provider/merchant-settings/${mid}/account-details/network/awin`,
  `https://ui.awin.com/provider/finance/fee-manager/en/${mid}`,
  `https://ui.awin.com/provider/merchant-settings/${mid}/mobile-tracking/network/awin`,
  `https://ui.awin.com/provider/migrated-advertiser-settings/${mid}`,
  `https://ui.awin.com/provider/pre-join-publishers?advertiserId=${mid}`
];
const IR_URLS = (mid) => [
  `https://ui.awin.com/tracking-settings/us/awin/advertiser/${mid}/main-settings`,
  `https://ui.awin.com/commission-manager/us/awin/merchant/${mid}/commission-groups`,
  `https://ui.awin.com/advertiser-mastertag/us/awin/${mid}/plugins`,
  `https://ui.awin.com/awin/merchant/${mid}/validate-pending/network/awin`,
  `https://ui.awin.com/advertiser-integration-tool/trackingwizard/us/awin/merchant/${mid}`,
  `https://ui.awin.com/provider/test-transactions`,
  `https://ui.awin.com/provider/merchant-settings/${mid}/account-details/network/awin`,
  `https://ui.awin.com/provider/merchant-settings/${mid}/mobile-tracking/network/awin`,
  `https://ui.awin.com/provider/finance/fee-manager/en/${mid}`,
  `https://ui.awin.com/provider/pre-join-publishers?advertiserId=${mid}`,
  `https://ui.awin.com/provider/migrated-advertiser-settings/${mid}`
];

async function openTabGroup(urls, title, color) {
  const tabs = [];
  for (const url of urls) tabs.push(await chrome.tabs.create({ url, active: false }));
  const groupId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id) });
  await chrome.tabGroups.update(groupId, { title, color });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || (msg.action !== "createNITabs" && msg.action !== "createIRTabs")) return;
  const mid = String(msg.mid || "").replace(/\D/g, "");
  if (!mid) return;
  const ni = msg.action === "createNITabs";
  openTabGroup(ni ? NI_URLS(mid) : IR_URLS(mid), ni ? mid : `${mid} IR`, ni ? "cyan" : "orange")
    .catch((e) => console.warn("Moonfill: could not open the tabs:", e));
});

// ---------- post to the record's Chatter feed ----------
// ---- step log + field fill ----
function tr(job, msg) {
  job.trace = job.trace || [];
  const sec = Math.round((Date.now() - (job.postingAt || Date.now())) / 1000);
  job.trace.push(`${sec}s ${msg}`);
  if (job.trace.length > 12) job.trace.shift();
}
const describe = (res) =>
  res.ok ? "ok" : (res.error || "failed") + (res.hidden ? " (page hidden)" : "") + (res.retry ? "" : " (no retry)");

const FIELD_LABELS = ["Moonpull Status"]; // the Yes/No fields default to No and the CMP to Other, so only this one can be missing

function fillNoteOf(f, job) {
  const bits = [];
  // fields the result gave no value for (nothing was sent to Salesforce for them)
  const missing = FIELD_LABELS.filter((l) => !(job && job.fields || []).some((x) => x.label === l));
  if (job && missing.length) bits.push("not in the result: " + missing.join(", "));
  if (!f) return bits.join(" · ");
  if (f.ok === false) { bits.push(`Fields not filled: ${f.error || "unknown error"}`); return bits.join(" · "); }
  if (f.problem && f.problem.length) bits.push("fields to check: " + f.problem.join("; "));
  if (f.notfound && f.notfound.length) bits.push("not on the page: " + f.notfound.join(", "));
  if (f.saveFailed) bits.push("fields not saved, check required fields");
  if (f.reviewForm) bits.push("fields filled but not saved: Techfill's review form is open, click Save");
  return bits.join(" · "); // empty = all good, nothing to say
}

// Posts the result, then (if switched on) fills the Salesforce fields on the same tab
async function postAndFill(tabId, job, text, opts) {
  const res = await sendPost(tabId, job, text, opts);
  if (!res.ok) return res;
  if (!FILL_FIELDS || !job.fields || !job.fields.length) return res;
  const payload = { action: "moonfillFill", recordId: job.recordId, fields: job.fields, save: true };
  try {
    res.fill = await chrome.tabs.sendMessage(tabId, payload);
    if (res.fill && res.fill.ok === false && /not visible/i.test(res.fill.error || "")) {
      // the result was posted from a background tab: the form needs a visible page, so bring the tab forward once
      await chrome.tabs.update(tabId, { active: true });
      await sleep(600);
      res.fill = await chrome.tabs.sendMessage(tabId, payload);
    }
  } catch (e) {
    res.fill = { ok: false, error: e.message };
  }
  return res;
}
const keepsTabOpen = (res) => !!(res && res.ok && res.fill && res.fill.keepOpen);

async function sendPost(tabId, job, text, opts) {
  // A freshly opened tab needs a moment before its content script answers
  for (let i = 0; i < 40; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        action: "moonfillPost",
        text,
        recordId: job.recordId,
        share: AUTO_SHARE,
        fast: !!opts.fast,
        activated: !!opts.activated,
        visibleWaitMs: opts.visibleWaitMs
      });
    } catch (e) {
      if (!/Receiving end does not exist|Could not establish connection/.test(e.message)) {
        return { ok: false, retry: false, error: e.message }; // never retry once posting may have started
      }
      await sleep(1000);
    }
  }
  return { ok: false, retry: true, error: "Salesforce page did not respond" };
}

// Opens the record in its own focused window, pastes, and closes it again.
// Closing it normally hands focus back to the app that was in front (Word, Teams...).
async function postInNewWindow(job, text) {
  let win = null;
  let res = null;
  try {
    win = await chrome.windows.create({
      url: job.recordUrl, type: "normal", focused: true, state: "normal", width: 1200, height: 800
    });
    tr(job, "temporary window opened");
    try { await chrome.windows.update(win.id, { focused: true, drawAttention: true }); } catch (e) { /* ignore */ }
    const tabId = win.tabs && win.tabs[0] && win.tabs[0].id;
    if (!tabId) { res = { ok: false, retry: true, hidden: true, error: "could not open a window" }; return res; }
    res = await postAndFill(tabId, job, text, { fast: false, activated: true, visibleWaitMs: 8000 });
    tr(job, "temporary window: " + describe(res));
    if (res.ok && (!AUTO_SHARE || keepsTabOpen(res))) { win = null; return res; } // leave it open for review
    if (res.ok) await sleep(1500); // let Share / Save settle
    return res;
  } catch (e) {
    tr(job, "temporary window error: " + e.message);
    res = { ok: false, retry: true, hidden: true, error: "temporary window: " + e.message };
    return res;
  } finally {
    if (win) { try { await chrome.windows.remove(win.id); } catch (e) { /* already closed */ } }
  }
}

async function postResultToRecord(job, text, forced) {
  const [prev] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  // Reuse a tab that already shows this record, else open it in the background
  const origin = new URL(job.recordUrl).origin;
  const existing = await chrome.tabs.query({ url: `${origin}/lightning/r/TSE__c/${job.recordId}/*` });
  let tab = existing[0];
  let opened = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: job.recordUrl, active: false });
    opened = true;
  }

  let activated = false;
  const bringForward = async () => {
    await chrome.tabs.update(tab.id, { active: true });
    if (forced) await chrome.windows.update(tab.windowId, { focused: true });
    activated = true;
  };

  let res = null;
  try {
    if (forced) {
      await bringForward();
      res = await postAndFill(tab.id, job, text, { fast: false, activated: true });
      tr(job, "force paste: " + describe(res));
      return res;
    }
    // 1. quietly, in a background tab
    res = await postAndFill(tab.id, job, text, { fast: true, activated: false });
    tr(job, "background tab: " + describe(res));
    // 2. make it the active tab of its window (no focus stolen) and try again, patiently
    if (!res.ok && res.retry) {
      await bringForward();
      res = await postAndFill(tab.id, job, text, { fast: false, activated: true });
      tr(job, "active tab: " + describe(res));
    }
    // 3. any retryable failure left (window hidden behind other apps, page too slow...):
    //    a temporary window in front, which pastes and closes itself
    if (!res.ok && res.retry && AUTO_WINDOW) {
      res = await postInNewWindow(job, text);
    }
    return res;
  } finally {
    if (opened) {
      if (AUTO_SHARE && !keepsTabOpen(res)) {
        await sleep(1500);
        try { await chrome.tabs.remove(tab.id); } catch (e) { /* already closed */ }
      } else {
        await chrome.tabs.update(tab.id, { active: true }); // leave it open for review
      }
    }
    if (activated && AUTO_SHARE && prev && prev.id !== tab.id && !keepsTabOpen(res)) {
      try { await chrome.tabs.update(prev.id, { active: true }); } catch (e) { /* gone */ }
    }
  }
}

// ---------- close the form tab once it's done, and return the user to where they were ----------
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.action !== "closeTab") return;
  const formTabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  const finishAndClose = async (tabId) => {
    if (!tabId) {
      console.warn("background: no tab id to close.");
      return;
    }
    try {
      const key = tabKey(tabId);
      const info = (await chrome.storage.session.get(key))[key];
      await chrome.storage.session.remove(key);
      const originTabId = info && info.originTabId;
      if (originTabId) {
        try {
          const originTab = await chrome.tabs.get(originTabId);
          await chrome.tabs.update(originTabId, { active: true });
          if (originTab && originTab.windowId != null) {
            await chrome.windows.update(originTab.windowId, { focused: true });
          }
        } catch (e) {
          console.warn("background: origin tab gone, skipping refocus:", e.message);
        }
      }
    } finally {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          console.warn("background: chrome.tabs.remove error:", chrome.runtime.lastError.message);
        }
      });
    }
  };

  if (formTabId) {
    finishAndClose(formTabId);
    return;
  }
  chrome.tabs.query({ url: ["*://forms.office.com/*", "*://forms.cloud.microsoft/*"] }, (formTabs) => {
    if (formTabs && formTabs.length > 0) finishAndClose(formTabs[0].id);
  });
});
