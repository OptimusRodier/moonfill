const PREFIX = "moonfillJob_";
const DONE_VISIBLE_MS = 60 * 1000;        // "complete" disappears from the main view after one minute
const FAILED_VISIBLE_MS = 10 * 60 * 1000; // failures stay in the main view for 10 minutes (always in History)

let view = "scans"; // "scans" or "history"
let copied = { id: null, until: 0 };

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

function clock(ts) {
  return new Date(ts).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusOf(job) {
  switch (job.state) {
    case "submitting":      return { text: "Submitting form…", cls: "busy" };
    case "waiting":         return { text: "In progress", cls: "busy", timer: true };
    case "posting":         return { text: "Posting to Salesforce…", cls: "busy" };
    case "waiting_browser": return { text: "Result ready · waiting for the browser to be in front", cls: "warn" };
    case "done":            return { text: job.note ? "Complete · pasted in Salesforce (not shared yet)" : "Complete · pasted in Salesforce", cls: "ok" };
    case "failed":          return { text: "Failed: " + (job.error || "unknown error"), cls: "bad" };
    default:                return { text: job.state, cls: "busy" };
  }
}

function row(label, value, valueClass) {
  const div = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = label + " ";
  const span = document.createElement("span");
  span.textContent = value;
  if (valueClass) span.className = valueClass;
  div.append(b, span);
  return { div, span };
}

function actionButton(text, onClick, primary) {
  const btn = document.createElement("button");
  btn.className = "act" + (primary ? " primary" : "");
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function card(job, now) {
  const st = statusOf(job);
  const el = document.createElement("div");
  el.className = "job " + st.cls;

  const status = row("Status:", st.text, "status");
  el.append(row("Program:", job.program || "—").div, row("MID:", job.mid).div, status.div);
  if (view === "history") el.append(row("Started:", clock(job.startedAt), "when").div);

  // live timer, updated in place every second (no re-render, so buttons stay clickable)
  if (st.timer) {
    status.span.dataset.since = job.submittedAt || job.startedAt;
    status.span.textContent = `In progress (${fmt(now - (job.submittedAt || job.startedAt))})`;
  }
  // in the main view, finished cards fade out on their own
  if (view === "scans" && job.state === "done") el.dataset.hideAt = job.finishedAt + DONE_VISIBLE_MS;
  if (view === "scans" && job.state === "failed") el.dataset.hideAt = job.finishedAt + FAILED_VISIBLE_MS;

  // failed or waiting results can still be posted by hand
  if (job.resultText && (job.state === "failed" || job.state === "waiting_browser")) {
    const isCopied = copied.id === job.id && now < copied.until;
    el.append(
      actionButton("Force paste", () => chrome.runtime.sendMessage({ action: "forcePost", jobId: job.id }), true),
      actionButton(isCopied ? "Copied ✓" : "Copy result", async () => {
        try {
          await navigator.clipboard.writeText(job.resultText);
          copied = { id: job.id, until: Date.now() + 3000 };
        } catch (e) { /* ignore */ }
        render();
      })
    );
  }
  if (job.state === "failed") {
    const x = document.createElement("button");
    x.className = "dismiss";
    x.title = "Dismiss";
    x.textContent = "×";
    x.addEventListener("click", () => chrome.storage.local.remove(PREFIX + job.id));
    el.appendChild(x);
  }
  return el;
}

async function render() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  let jobs = Object.keys(all)
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => all[k])
    .sort((a, b) => b.startedAt - a.startedAt);

  if (view === "scans") {
    jobs = jobs.filter((j) => {
      if (j.state === "done") return now - j.finishedAt < DONE_VISIBLE_MS;
      if (j.state === "failed") return now - j.finishedAt < FAILED_VISIBLE_MS;
      return true; // active scans always show
    });
  }

  document.getElementById("title").textContent = view === "history" ? "Scan history" : "Moonpull scans";
  document.getElementById("historyBtn").textContent = view === "history" ? "← Back" : "History";
  document.getElementById("clearBtn").style.display =
    view === "history" && jobs.some((j) => j.finishedAt) ? "inline-block" : "none";

  const list = document.getElementById("jobs");
  list.textContent = "";
  jobs.forEach((j) => list.appendChild(card(j, now)));

  const empty = document.getElementById("empty");
  empty.style.display = jobs.length ? "none" : "block";
  empty.textContent = view === "history"
    ? "No scans yet."
    : "No scans running. Click “🌙 Submit Moonpull form” on a Salesforce record.";
}

// every second: move the timers and hide finished cards, without rebuilding the list
function tick() {
  const now = Date.now();
  document.querySelectorAll("[data-since]").forEach((el) => {
    el.textContent = `In progress (${fmt(now - Number(el.dataset.since))})`;
  });
  document.querySelectorAll("[data-hide-at]").forEach((el) => {
    if (now > Number(el.dataset.hideAt)) el.remove();
  });
  const list = document.getElementById("jobs");
  if (view === "scans" && !list.children.length) {
    const empty = document.getElementById("empty");
    empty.style.display = "block";
    empty.textContent = "No scans running. Click “🌙 Submit Moonpull form” on a Salesforce record.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const v = document.querySelector(".version");
  if (v) v.textContent = "v" + chrome.runtime.getManifest().version;
  render();
  setInterval(tick, 1000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") render();
  });

  document.getElementById("historyBtn").addEventListener("click", () => {
    view = view === "history" ? "scans" : "history";
    render();
  });
  document.getElementById("clearBtn").addEventListener("click", async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX) && all[k].finishedAt);
    await chrome.storage.local.remove(keys);
  });

  document.getElementById("portfolioBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://rodiersangibala.chezyo.com/" });
  });
  document.getElementById("githubBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/OptimusRodier/moonfill" });
  });
});
