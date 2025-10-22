console.log("🌙 Moonfill Salesforce script active.");

// Country → GEO mapping
const countryToGeo = {
  "United Kingdom": "GB",
  "France": "FR",
  "Germany": "DE",
  "United States": "US",
  "Spain": "ES",
  "Italy": "IT",
  "Netherlands": "NL",
  "Belgium": "NL",
  "Luxembourg": "NL",
  "Brazil": "BR",
  "Sweden": "SE",
  "Poland": "PL",
  "Portugal": "PT",
  "Austria": "AT",
  "Switzerland": "CH",
  "Ireland": "IE",
  "Canada": "US"
};

// Normalize GEO fallback
function normalizeGeo(country) {
  if (countryToGeo[country]) return countryToGeo[country];
  const lower = country.toLowerCase();
  if (["norway", "denmark", "finland"].some(c => lower.includes(c))) return "DE";
  if (["mexico", "colombia", "argentina", "chile", "peru"].some(c => lower.includes(c))) return "BR";
  return "GB";
}

// Wait for page load and target elements
function waitForSalesforceElements(retries = 15) {
  const midLink = document.querySelector('a[href*="ui.awin.com/dashboard/awin/advertiser/"]');

  // Find "Country of the program"
  const countryField = Array.from(document.querySelectorAll(".test-id__field-label"))
    .find(label => label.textContent.trim() === "Country of the program");
  const countryNode = countryField
    ? countryField.closest(".slds-form-element").querySelector("lightning-formatted-text[data-output-element-id='output-field']")
    : null;

  if (midLink && countryNode) {
    injectMoonfillSection(midLink, countryNode);
  } else if (retries > 0) {
    console.log(`⏳ Waiting for Salesforce elements... (${retries} retries left)`);
    setTimeout(() => waitForSalesforceElements(retries - 1), 1000);
  } else {
    console.warn("⚠️ Could not find MID or country field on Salesforce page.");
  }
}

function injectMoonfillSection(midLink, countryNode) {
  const midMatch = midLink.href.match(/advertiser\/(\d+)/);
  const mid = midMatch ? midMatch[1] : null;
  const country = countryNode?.textContent?.trim() || "";
  const geo = normalizeGeo(country);

  // Reject invalid or too-short MID
  if (!mid || mid.length < 3) {
    console.warn("⚠️ Invalid or too short MID detected:", mid);
    return;
  }

  if (!geo) {
    console.warn("⚠️ Could not detect GEO for country:", country);
    return;
  }

  console.log("✅ Detected MID:", mid, "Country:", country, "→ GEO:", geo);

  chrome.storage.local.set({ advertiserID: mid, geo }, () => {
    console.log("💾 Stored MID + GEO in local storage for Moonfill popup.");
  });

  const cardBody = document.querySelector("div.slds-card__body.slds-card__body_inner");
  if (!cardBody) {
    console.warn("⚠️ No card body container found for injection.");
    return;
  }

  if (document.getElementById("moonfillSalesforceSection")) return;

  console.log("✅ Found Salesforce card body, injecting Moonfill section…");

  const container = document.createElement("div");
  container.id = "moonfillSalesforceSection";
  container.className = "moonfill-content";
  container.innerHTML = `
    <ul style="list-style:none;padding-left:0;margin-top:10px;">
      <li>
        <div style="
          display:inline-flex;
          align-items:center;
          background-color:#015475;
          color:white;
          font-weight:600;
          padding:6px 12px;
          border-radius:8px;
          cursor:pointer;
          box-shadow:0 2px 6px rgba(0,0,0,0.2);
        ">
          🌙 Submit Moonpull form
        </div>
      </li>
    </ul>
  `;

  const moonBtn = container.querySelector("div");
  moonBtn.addEventListener("click", () => {
    const officeFormURL =
      "https://forms.office.com/pages/responsepage.aspx?id=07KaWlh7JUWYUdFycma616fCV2xjqwdEqzYTwuOkzBJUMU5JTTM1MTdVTVY5OVNKTk1TREtLU0wxUS4u";

    chrome.storage.local.set({ advertiserID: mid, geo }, () => {
      console.log("✅ Values set, opening Moonpull form...");
      chrome.runtime.sendMessage({ action: "openForm", url: officeFormURL });
    });
  });

  cardBody.appendChild(container);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "openForm" && msg.url) {
    chrome.tabs.create({ url: msg.url });
  }
});

waitForSalesforceElements();
