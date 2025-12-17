console.log("Moonfill content script loaded");

// === Ultra-robust field finders based on real DOM ===
function getAffiliateLinkInput() {
  // Primary: title contains "AWIN Affiliate Link"
  const item = [...document.querySelectorAll('div[data-automation-id="questionItem"]')]
    .find(item => item.textContent.includes("AWIN Affiliate Link"));
  if (item) return item.querySelector('input[data-automation-id="textInput"]');

  // Fallback: placeholder "Enter your answer" + first question
  return document.querySelector('div[data-automation-id="questionItem"]:nth-of-type(1) input[placeholder="Enter your answer"]');
}

function getAdvertiserIdInput() {
  // Primary: title contains "advertiser ID"
  const item = [...document.querySelectorAll('div[data-automation-id="questionItem"]')]
    .find(item => item.textContent.includes("advertiser ID"));
  if (item) return item.querySelector('input[data-automation-id="textInput"]');

  // Fallback: placeholder "The value must be a number"
  return document.querySelector('input[placeholder="The value must be a number"]');
}

function getGeoInput() {
  // Primary: title contains "geo location"
  const item = [...document.querySelectorAll('div[data-automation-id="questionItem"]')]
    .find(item => item.textContent.includes("geo location"));
  if (item) return item.querySelector('input[data-automation-id="textInput"]');

  // Fallback: third question
  return document.querySelector('div[data-automation-id="questionItem"]:nth-of-type(3) input[placeholder="Enter your answer"]');
}

function getTeamsRadio() {
  // Find the Teams option by visible text
  return [...document.querySelectorAll('span.text-format-content')]
    .find(span => span.textContent.trim() === "Teams")
    ?.closest('div[data-automation-id="likerOption"]')
    ?.querySelector('input[type="radio"]') 

  || document.querySelector('input[aria-label*="Teams"]');
}

function getSubmitButton() {
  return document.querySelector('button[data-automation-id="submitButton"]') ||
         document.querySelector('button[type="submit"]:not([disabled])');
}

// === Patient waiting with activity boost ===
function waitForFormFields(callback, retries = 90) {
  const field1 = getAffiliateLinkInput();
  const field2 = getAdvertiserIdInput();
  const field3 = getGeoInput();
  const radio = getTeamsRadio();
  const submitBtn = getSubmitButton();

  console.log(`Check: Link=${!!field1}, ID=${!!field2}, Geo=${!!field3}, Teams=${!!radio}, Submit=${!!submitBtn} (${retries} left)`);

  if (field1 && field2 && field3 && radio && submitBtn) {
    console.log("✅ ALL FIELDS DETECTED — proceeding!");
    callback(field1, field2, field3, radio, submitBtn);
  } else if (retries > 0) {
    setTimeout(() => waitForFormFields(callback, retries - 1), 1000);
  } else {
    console.warn("❌ Timed out — final status:", { field1:!!field1, field2:!!field2, field3:!!field3, radio:!!radio, submitBtn:!!submitBtn });
  }
}

// Trigger recheck on any user activity (fixes lazy loading)
["click", "scroll", "keydown", "mousemove"].forEach(ev => {
  document.addEventListener(ev, () => {
    if (retries > 0) {
      console.log(`Activity (${ev}) → resetting timer`);
      waitForFormFields(callback, 90); // restart with full time
    }
  }, { passive: true });
});

// === Fill form ===
function fillForm(advertiserID, geo) {
  console.log("Starting fill with:", advertiserID, geo);

  waitForFormFields((field1, field2, field3, radio, submitBtn) => {
    try {
      field1.value = `https://www.awin1.com/cread.php?awinmid=${advertiserID}&id=45628`;
      field2.value = advertiserID;
      field3.value = geo.toUpperCase(); // ensure uppercase like DE, GB

      [field1, field2, field3].forEach(f => {
        f.dispatchEvent(new Event("input", { bubbles: true }));
        f.dispatchEvent(new Event("change", { bubbles: true }));
      });

      radio.click();
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));

      console.log("✅ All filled — submitting in 2s");

      setTimeout(() => {
        submitBtn.click();
        console.log("✅ Submitted!");

        // Watch for thank you
        const observer = new MutationObserver(() => {
          if (document.body.textContent.includes("Thank you") || 
              document.querySelector('[data-automation-id="thankYouMessage"]')) {
            console.log("🎉 Thank you detected — closing tab in 3s");
            observer.disconnect();
            setTimeout(() => chrome.runtime.sendMessage({ action: "closeTab" }), 3000);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, 2000);

    } catch (err) {
      console.error("❌ Fill error:", err);
    }
  });
}

// === Storage + Message ===
chrome.storage.local.get(["advertiserID", "geo"], (data) => {
  if (data.advertiserID && data.geo) {
    console.log("From storage:", data.advertiserID, data.geo);
    fillForm(data.advertiserID, data.geo);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.advertiserID && msg.geo) {
    console.log("From message:", msg.advertiserID, msg.geo);
    fillForm(msg.advertiserID, msg.geo);
  }
});

// === Button (optional) ===
(function() {
  const target = document.querySelector("div.slds-card__body, div.slds-page-header__col-title");
  if (!target || document.querySelector(".moonfill-btn")) return;

  const btn = document.createElement("button");
  btn.innerText = "🌙 Moonfill";
  btn.style.cssText = "margin:10px; padding:8px 16px; background:#6366f1; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;";
  target.appendChild(btn);
  console.log("🌙 Button injected");
})();