const PREFIX = "moonfillJob_";
const DONE_VISIBLE_MS = 60 * 1000;        // "complete" disappears after one minute
const FAILED_VISIBLE_MS = 10 * 60 * 1000; // failures stay until dismissed (or 10 min)

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

function statusOf(job, now) {
  const since = fmt(now - (job.submittedAt || job.startedAt));
  switch (job.state) {
    case "submitting": return { text: "Submitting form…", cls: "busy" };
    case "waiting":    return { text: `In progress (${since})`, cls: "busy" };
    case "posting":    return { text: "Posting to Salesforce…", cls: "busy" };
    case "done":       return { text: job.note ? "Complete · pasted in Salesforce (not shared yet)" : "Complete · pasted in Salesforce", cls: "ok" };
    case "failed":     return { text: "Failed: " + (job.error || "unknown error"), cls: "bad" };
    default:           return { text: job.state, cls: "busy" };
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
  return div;
}

let copied = { id: null, until: 0 };

function card(job, now) {
  const st = statusOf(job, now);
  const el = document.createElement("div");
  el.className = "job " + st.cls;
  el.append(row("Program:", job.program || "—"), row("MID:", job.mid), row("Status:", st.text, "status"));
  if (job.state === "failed" && job.resultText) {
    const c = document.createElement("button");
    c.className = "copy";
    c.textContent = copied.id === job.id && now < copied.until ? "Copied ✓" : "Copy result";
    c.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(job.resultText);
        copied = { id: job.id, until: Date.now() + 3000 };
      } catch (e) {
        c.textContent = "Copy failed";
      }
      render();
    });
    el.appendChild(c);
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
  const jobs = Object.keys(all)
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => all[k])
    .filter((j) => {
      if (j.state === "done") return now - j.finishedAt < DONE_VISIBLE_MS;
      if (j.state === "failed") return now - j.finishedAt < FAILED_VISIBLE_MS;
      return true;
    })
    .sort((a, b) => b.startedAt - a.startedAt);

  const list = document.getElementById("jobs");
  list.textContent = "";
  jobs.forEach((j) => list.appendChild(card(j, now)));
  document.getElementById("empty").style.display = jobs.length ? "none" : "block";
}

document.addEventListener("DOMContentLoaded", () => {
  render();
  setInterval(render, 1000); // keeps timers moving and hides finished jobs on time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") render();
  });

  document.getElementById("portfolioBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://rodiersangibala.chezyo.com/" });
  });
  document.getElementById("githubBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/OptimusRodier/moonfill" });
  });
});
