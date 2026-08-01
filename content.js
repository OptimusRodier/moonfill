console.log("Moonfill content script loaded");

// === Diagnostic banner: shows on-page the moment matching fails, instead
// of silently doing nothing (so a future break is visible in seconds) ===
function showMoonfillWarning(missingList) {
  if (document.getElementById("moonfill-warning-banner")) return;
  const banner = document.createElement("div");
  banner.id = "moonfill-warning-banner";
  banner.style.cssText = `
    position:fixed; top:0; left:0; right:0; z-index:999999;
    background:#bc2f32; color:#fff; font-family:sans-serif; font-size:14px;
    padding:10px 16px; text-align:center; box-shadow:0 2px 6px rgba(0,0,0,0.3);
  `;
  banner.textContent =
    "🌙 Moonfill couldn't find: " + missingList.join(", ") +
    ". The form's layout likely changed again — this needs a script update.";
  document.body.prepend(banner);
}

// === Robust helpers: try the known Microsoft Forms attributes first, then
// fall back to looser text/role-based matching so a future minor markup
// tweak doesn't break everything at once ===

function findQuestionByTitleContains(phrase) {
  // Strategy 1: known Microsoft Forms structure
  let items = document.querySelectorAll('div[data-automation-id="questionItem"]');
  for (const item of items) {
    const titleEl = item.querySelector('[data-automation-id="questionTitle"] .text-format-content, [data-automation-id="questionTitle"]');
    if (titleEl && titleEl.textContent.toLowerCase().includes(phrase.toLowerCase())) {
      return item;
    }
  }
  // Strategy 2 (fallback): any element that looks like a question block
  const all = document.querySelectorAll("div, li, section");
  for (const el of all) {
    if (el.children.length > 0 && el.children.length < 15 &&
        el.textContent.toLowerCase().includes(phrase.toLowerCase()) &&
        (el.querySelector("input") || el.querySelector('[role="radio"]'))) {
      return el;
    }
  }
  return null;
}

function getTextInputByTitle(phrase) {
  const item = findQuestionByTitleContains(phrase);
  if (!item) return null;
  return item.querySelector('input[data-automation-id="textInput"]') ||
    item.querySelector('input[type="text"], input:not([type]), textarea') ||
    item.querySelector('input[placeholder="Enter your answer"]');
}

function getRadioByTitleAndOption(titlePhrase, optionText) {
  const item = findQuestionByTitleContains(titlePhrase);
  if (!item) return null;

  // Strategy 1: known liker option structure
  const options = item.querySelectorAll('div[data-automation-id="likerOption"]');
  for (const opt of options) {
    const label = opt.querySelector('span.text-format-content, span');
    if (label && label.textContent.trim().toLowerCase() === optionText.toLowerCase()) {
      const input = opt.querySelector('input[type="radio"], [role="radio"]');
      if (input) return input;
    }
  }

  // Strategy 2 (fallback): any radio-like control whose nearby text matches
  const candidates = item.querySelectorAll('input[type="radio"], [role="radio"]');
  for (const c of candidates) {
    const container = c.closest("div, label, li") || c.parentElement;
    if (container && container.textContent.trim().toLowerCase().includes(optionText.toLowerCase())) {
      return c;
    }
  }

  // Strategy 3: aria-label match anywhere on the page
  return document.querySelector(`input[aria-label*="${optionText}"]`);
}

function getSubmitButton() {
  return document.querySelector('button[data-automation-id="submitButton"]') ||
    document.querySelector('button[type="submit"]:not([disabled])') ||
    Array.from(document.querySelectorAll("button")).find(b => /submit/i.test(b.textContent));
}

// === Wait for fields, with an activity-triggered recheck for lazy-rendered
// content (some MS Forms question types don't paint until the user interacts
// with the page — this restarts the retry budget on real user activity,
// scoped correctly so it doesn't throw on every click like the old version) ===
let moonfillActiveCallback = null;
let moonfillRetriesLeft = 0;

function waitForFormFields(callback, retries = 45) {
  const field1 = getTextInputByTitle("Affiliate Link");
  const field2 = getTextInputByTitle("advertiser ID");
  const field3 = getTextInputByTitle("geo location");
  const radio = getRadioByTitleAndOption("How do you want to receive the results", "Teams");
  const submitBtn = getSubmitButton();

  moonfillActiveCallback = callback;
  moonfillRetriesLeft = retries;

  if (field1 && field2 && field3 && radio && submitBtn) {
    console.log("✅ All fields detected");
    moonfillActiveCallback = null;
    callback(field1, field2, field3, radio, submitBtn);
  } else if (retries > 0) {
    console.log(`⏳ Waiting... (${retries} left)`);
    setTimeout(() => waitForFormFields(callback, retries - 1), 1000);
  } else {
    const missing = [];
    if (!field1) missing.push("Affiliate Link field");
    if (!field2) missing.push("advertiser ID field");
    if (!field3) missing.push("geo location field");
    if (!radio) missing.push('"Teams" radio option');
    if (!submitBtn) missing.push("submit button");
    console.warn("❌ Fields not found:", missing);
    showMoonfillWarning(missing);
    moonfillActiveCallback = null;
  }
}

// If the page only finishes rendering after some interaction (lazy load),
// give the search one fresh burst of retries the first time real activity
// happens — properly scoped this time, and only fires once.
let moonfillActivityBoostUsed = false;
["click", "scroll", "keydown", "mousemove"].forEach((ev) => {
  document.addEventListener(ev, () => {
    if (moonfillActiveCallback && moonfillRetriesLeft <= 5 && !moonfillActivityBoostUsed) {
      moonfillActivityBoostUsed = true;
      console.log(`Activity (${ev}) → giving field search a fresh burst`);
      waitForFormFields(moonfillActiveCallback, 15);
    }
  }, { passive: true });
});

function fillForm(advertiserID, geo) {
  console.log("Filling form with:", advertiserID, geo);

  waitForFormFields((field1, field2, field3, radio, submitBtn) => {
    try {
      field1.value = `https://www.awin1.com/cread.php?awinmid=${advertiserID}&id=45628`;
      field2.value = advertiserID;
      field3.value = geo;

      [field1, field2, field3].forEach((field) => {
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });

      radio.click();
      radio.dispatchEvent(new Event("change", { bubbles: true }));

      console.log("✅ Fields and radio filled. Waiting before submitting...");

      setTimeout(() => {
        submitBtn.click();
        console.log("✅ Form submitted.");

        const observer = new MutationObserver(() => {
          const thankYou =
            document.querySelector('div[data-automation-id="thankYouMessage"] span.text-format-content') ||
            (document.body.textContent.includes("Thank you") ? document.body : null);
          if (thankYou) {
            console.log("🎉 Thank-you message detected — waiting 3s before closing tab...");
            observer.disconnect();
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: "closeTab" });
            }, 3000);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, 2000);
    } catch (err) {
      console.error("❌ Error filling the form:", err);
    }
  });
}

// Plan A: retrieve from storage
chrome.storage.local.get(["advertiserID", "geo"], ({ advertiserID, geo }) => {
  if (advertiserID && geo) {
    console.log("Retrieved from storage:", advertiserID, geo);
    fillForm(advertiserID, geo);
  } else {
    console.log("Storage empty, waiting for Plan B message...");
  }
});

// Plan B: message from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.advertiserID && msg.geo) {
    console.log("Received from message:", msg.advertiserID, msg.geo);
    fillForm(msg.advertiserID, msg.geo);
  }
});

// 🌙 Inject Moonfill button with popup-style design (Salesforce page)
(function injectMoonfillButton() {
  const target = document.querySelector("div.slds-card__body, div.slds-page-header__col-title");
  if (!target || document.querySelector(".moonfill-btn")) return;

  const moonfillButton = document.createElement("button");
  moonfillButton.innerText = "🌙 Moonfill";
  moonfillButton.className = "moonfill-btn";

  target.appendChild(moonfillButton);
  console.log("🌙 Moonfill styled button added.");
})();
