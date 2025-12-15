console.log("Moonfill content script loaded");
// === Robust helpers (best of both) ===
function findQuestionByTitleContains(phrase) {
  const items = document.querySelectorAll('div[data-automation-id="questionItem"]');
  for (const item of items) {
    const titleEl = item.querySelector('span[data-automation-id="questionTitle"] .text-format-content');
    if (titleEl && titleEl.textContent.toLowerCase().includes(phrase.toLowerCase())) {
      return item;
    }
  }
  return null;
}

function getTextInputByTitle(phrase) {
  const item = findQuestionByTitleContains(phrase);
  return item ? item.querySelector('input[data-automation-id="textInput"]') : null;
}

function getRadioByTitleAndOption(titlePhrase, optionText) {
  const item = findQuestionByTitleContains(titlePhrase);
  if (!item) return null;
  const options = item.querySelectorAll('div[data-automation-id="likerOption"]');
  for (const opt of options) {
    const label = opt.querySelector('span.text-format-content');
    if (label && label.textContent.trim().toLowerCase() === optionText.toLowerCase()) {
      return opt.querySelector('input[type="radio"]');
    }
  }
  return null;
}

function waitForFormFields(callback, retries = 25) {
  const field1 = getTextInputByTitle("Affiliate Link");
  const field2 = getTextInputByTitle("advertiser ID");
  const field3 = getTextInputByTitle("geo location");

  const radio = getRadioByTitleAndOption(
    "How do you want to receive the results",
    "Teams"
  );

  const submitBtn = document.querySelector(
    'button[data-automation-id="submitButton"]'
  );

  if (field1 && field2 && field3 && radio && submitBtn) {
    console.log("✅ All fields detected (final robust mapping)");
    callback(field1, field2, field3, radio, submitBtn);
  } else if (retries > 0) {
    console.log(`⏳ Waiting... (${retries} left)`);
    setTimeout(() => waitForFormFields(callback, retries - 1), 1000);
  } else {
    console.warn("❌ Fields not found");
  }
}


function fillForm(advertiserID, geo) {
  console.log("Filling form with:", advertiserID, geo);

  waitForFormFields((field1, field2, field3, radio, submitBtn) => {
    try {
      // Fill all fields
      field1.value = `https://www.awin1.com/cread.php?awinmid=${advertiserID}&id=45628`;
      field2.value = advertiserID;
      field3.value = geo;

      // Trigger input events so Microsoft Forms registers the values
      [field1, field2, field3].forEach((field) => {
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });

      // Check the radio
      radio.click();
      radio.dispatchEvent(new Event("change", { bubbles: true }));


      console.log("✅ Fields and radio filled. Waiting before submitting...");

      // Give it 2 seconds to register before submitting
      setTimeout(() => {
        submitBtn.click();
        console.log("✅ Form submitted.");

        // 🔹 Watch for "Thank you" message
        const observer = new MutationObserver(() => {
          const thankYou = document.querySelector(
            'div[data-automation-id="thankYouMessage"] span.text-format-content'
          );
          if (thankYou && thankYou.textContent.includes("Thank you")) {
            console.log("🎉 Thank-you message detected — waiting 3s before closing tab...");
            observer.disconnect();
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: "closeTab" });
            }, 3000); // 3-second delay before closing
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
// 🌙 Inject Moonfill button with popup-style design (no logic changes)
(function injectMoonfillButton() {
  const target = document.querySelector("div.slds-card__body, div.slds-page-header__col-title"); 
  if (!target || document.querySelector(".moonfill-btn")) return;

  const moonfillButton = document.createElement("button");
  moonfillButton.innerText = "🌙 Moonfill";
  moonfillButton.className = "moonfill-btn";

  // Append neatly within Salesforce header
  target.appendChild(moonfillButton);
  console.log("🌙 Moonfill styled button added.");
})();
