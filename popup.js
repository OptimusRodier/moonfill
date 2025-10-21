document.addEventListener("DOMContentLoaded", () => {
  const digitInput = document.getElementById("digitInput");
  const submitBtn = document.getElementById("submitBtn");
  const regionSelect = document.getElementById("regionSelect");

  // Allow only digits for Advertiser ID
  digitInput.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  // Handle Submit button
  submitBtn.addEventListener("click", () => {
    const advertiserID = digitInput.value.trim();
    const geo = regionSelect.value;

    if (!advertiserID) {
      alert("Please enter a valid Advertiser ID before proceeding.");
      return;
    }

    // Save values to Chrome storage (Plan A)
    chrome.storage.local.set({ advertiserID, geo }, () => {
      console.log("Saved advertiserID and geo to storage:", advertiserID, geo);
    });

    const officeFormURL =
      "https://forms.office.com/pages/responsepage.aspx?id=07KaWlh7JUWYUdFycma616fCV2xjqwdEqzYTwuOkzBJUMU5JTTM1MTdVTVY5OVNKTk1TREtLU0wxUS4u";

    // Open the Office form (active tab)
    chrome.tabs.create({ url: officeFormURL, active: true }, (tab) => {
      console.log("Office form opened:", officeFormURL);

      // Plan B — send message once the page fully loads
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);

          // Send advertiserID and geo to the content script
          chrome.tabs.sendMessage(tab.id, { advertiserID, geo }, () => {
            console.log("Sent advertiserID + geo via Plan B:", advertiserID, geo);
          });
        }
      });
    });
  });

  // 🔹 Add these two buttons
  document.getElementById("portfolioBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://rodiersangibala.chezyo.com/" });
  });

  document.getElementById("githubBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com" });
  });
});
