// background.js
// One scan = one job, visible in the popup from the click until it is pasted.
// Each form tab carries its own MID/geo/record, the Forms response ID read on
// submit links the job to its result file, and the finished result is posted
// to the record's Chatter feed.

// Folder where the flow saves "<ResponseId>.txt" (must end with "/")
const RESULT_FOLDER_URL =
  "https://zanox.sharepoint.com/teams/Global-MoonpullI-Integration/Shared%20Documents/General/batch%20results%20use%20cases/Integartion%20Tests/Moonpull%20Integration%20dataCenter/";

const POLL_MS = 5000;                    // check every 5 seconds
const JOB_TIMEOUT_MS = 20 * 60 * 1000;   // give up 20 minutes after the form was submitted
const AUTO_SHARE = true;                 // false = paste into Chatter but don't click Share (tab stays open for review)
const ACTIVE = ["submitting", "waiting", "posting"];
const DONE_KEEP_MS = 2 * 60 * 1000;      // finished jobs are cleaned up after 2 min (popup hides them after 1)
const FAILED_KEEP_MS = 10 * 60 * 1000;   // failed jobs stay visible for 10 min

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabKey = (tabId) => `moonfillTab_${tabId}`;
const jobKey = (id) => `moonfillJob_${id}`;

chrome.runtime.onInstalled.addListener(() => console.log("Moonfill extension installed"));
chrome.runtime.onStartup.addListener(() => ensurePolling());

function notify(title, message) {
  chrome.notifications.create(
    { type: "basic", iconUrl: "assets/icon128.png", title, message },
    () => void chrome.runtime.lastError
  );
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
  const failed = jobs.some((j) => j.state === "failed");
  chrome.action.setBadgeText({ text: n ? String(n) : failed ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: n ? "#015475" : "#bc2f32" });
}

async function pruneFinished() {
  const now = Date.now();
  for (const j of await getJobs()) {
    const age = j.finishedAt ? now - j.finishedAt : 0;
    if ((j.state === "done" && age > DONE_KEEP_MS) || (j.state === "failed" && age > FAILED_KEEP_MS)) {
      await removeJob(j.id);
    }
  }
  await refreshBadge();
}

async function finishJob(job, state, error, note) {
  job.state = state;
  job.finishedAt = Date.now();
  job.error = error || null;
  job.note = note || null;
  await saveJob(job);
  chrome.alarms.create("moonfillPrune", { delayInMinutes: 11 });
  if (state === "failed") {
    notify("Moonfill: scan failed", `${job.program || "MID " + job.mid}: ${error}. The result is still in Teams/email.`);
  }
  await refreshBadge();
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
      const jobs = await getJobs();
      let active = jobs.filter((j) => ACTIVE.includes(j.state));

      // Stuck jobs
      for (const j of active) {
        if (j.state === "submitting" && Date.now() - j.startedAt > 3 * 60 * 1000) {
          await finishJob(j, "failed", "the form was not submitted");
        } else if (j.state === "posting" && Date.now() - (j.postingAt || 0) > 3 * 60 * 1000) {
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
      for (const job of active.filter((j) => j.state === "waiting")) {
        await processJob(job);
      }
      await sleep(POLL_MS);
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
async function readResultFile(responseId) {
  try {
    const url = RESULT_FOLDER_URL + encodeURIComponent(responseId) + ".txt";
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    if (res.status === 404) return { status: "notfound" };
    if (!res.ok) return { status: "error", code: res.status };
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) return { status: "auth" }; // login page instead of the file
    return { status: "ok", text: text.replace(/^\uFEFF/, "") };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

async function processJob(job) {
  if (Date.now() - (job.submittedAt || job.startedAt) > JOB_TIMEOUT_MS) {
    await finishJob(job, "failed", "no result after 20 minutes");
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
      notify("Moonfill: can't read the result folder", "Sign in to Microsoft 365 in this browser. Still trying.");
    }
    await saveJob(job);
    return;
  }
  const text = r.text;
  if (!text.trim()) return;

  // Safety: the MID inside the result must be the MID we submitted
  const m = /Advertiser ID:\s*(\d+)/i.exec(text);
  if (m && m[1] !== String(job.mid)) {
    await finishJob(job, "failed", `result is for MID ${m[1]}, expected ${job.mid}. Nothing was posted`);
    return;
  }

  job.state = "posting";
  job.postingAt = Date.now();
  await saveJob(job);
  await refreshBadge();
  const res = await postResultToRecord(job, text);
  if (res.ok) await finishJob(job, "done", null, res.note);
  else await finishJob(job, "failed", `could not post to Chatter (${res.error})`);
}

// ---------- post to the record's Chatter feed ----------
async function sendPost(tabId, job, text) {
  // A freshly opened tab needs a moment before its content script answers
  for (let i = 0; i < 40; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        action: "moonfillPost",
        text,
        recordId: job.recordId,
        share: AUTO_SHARE
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

async function postResultToRecord(job, text) {
  // Reuse a tab that already shows this record, else open it in the background
  const origin = new URL(job.recordUrl).origin;
  const existing = await chrome.tabs.query({ url: `${origin}/lightning/r/TSE__c/${job.recordId}/*` });
  let tab = existing[0];
  let opened = false;
  let previousActive = null;
  if (!tab) {
    tab = await chrome.tabs.create({ url: job.recordUrl, active: false });
    opened = true;
  }
  try {
    let res = await sendPost(tab.id, job, text);
    if (!res.ok && res.retry && opened) {
      // Lightning may not render in a background tab: bring it forward and retry once
      const [prev] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      previousActive = prev && prev.id !== tab.id ? prev.id : null;
      await chrome.tabs.update(tab.id, { active: true });
      res = await sendPost(tab.id, job, text);
    }
    return res;
  } finally {
    if (opened) {
      if (AUTO_SHARE) {
        await sleep(1500);
        try { await chrome.tabs.remove(tab.id); } catch (e) { /* already closed */ }
      } else {
        await chrome.tabs.update(tab.id, { active: true }); // leave it open for review
      }
    }
    if (previousActive && AUTO_SHARE) {
      try { await chrome.tabs.update(previousActive, { active: true }); } catch (e) { /* gone */ }
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
