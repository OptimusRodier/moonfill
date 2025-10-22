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

// --- Refresh storage ---
async function refreshStorage(mid, geo) {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ advertiserID: mid, geo });
  console.log("💾 Storage updated:", { mid, geo });
}

// --- Inject button ---
function injectButton(cardBody, mid) {
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
      const url = "https://forms.office.com/pages/responsepage.aspx?id=07KaWlh7JUWYUdFycma616fCV2xjqwdEqzYTwuOkzBJUMU5JTTM1MTdVTVY5OVNKTk1TREtLU0wxUS4u";
      chrome.runtime.sendMessage({ action: "openForm", url });
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

    await refreshStorage(mid, geo);
    const cardBody = await waitForElement(() => document.querySelector("div.slds-card__body.slds-card__body_inner"));
    injectButton(cardBody, mid);

  } catch (err) {
    console.warn("⚠️ Could not process record:", err);
  }
}

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

// 2️⃣ Detect Back-to-List clicks
document.addEventListener("click", e => {
  const target = e.target.closest("a, button");
  if (!target) return;
  const txt = target.textContent?.trim().toLowerCase();
  if (txt.includes("back") || txt.includes("list") || txt.includes("view all")) {
    console.log("↩️ Back/List clicked — resetting context");
    chrome.storage.local.clear();
    setTimeout(() => {
      lastUrl = location.href;
    }, 100);
  }
});

// 3️⃣ Mutation Observer fallback
const observer = new MutationObserver(() => {
  const current = location.href;
  if (current !== lastUrl && current.includes("/r/TSE__c/")) {
    lastUrl = current;
    console.log("👀 Route changed (DOM observer)");
    setTimeout(processRecord, 500);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// 4️⃣ Initialize
hookHistory();
processRecord();
