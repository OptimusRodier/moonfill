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

    const officeFormURL =
      "https://forms.cloud.microsoft/pages/responsepage.aspx?id=07KaWlh7JUWYUdFycma616fCV2xjqwdEqzYTwuOkzBJUMU5JTTM1MTdVTVY5OVNKTk1TREtLU0wxUS4u&lang=en";

    // Note which tab the user was on, so the background script can return
    // them to it once the form is filled, submitted, and closed.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const originTabId = tabs && tabs[0] ? tabs[0].id : null;

      // Hand everything off to background.js — it keeps running even after
      // this popup closes (which happens the moment focus leaves it), so
      // one click is all that's needed; you don't have to stay on the page.
      chrome.runtime.sendMessage({
        action: "startMoonfill",
        advertiserID,
        geo,
        url: officeFormURL,
        originTabId,
      });
    });
  });

  document.getElementById("portfolioBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://rodiersangibala.chezyo.com/" });
  });

  document.getElementById("githubBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/OptimusRodier/moonfill" });
  });
});
