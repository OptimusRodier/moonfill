// background.js - one-click flow: creates the form tab, remembers where the
// user came from, and returns focus there automatically once the tab closes.
chrome.runtime.onInstalled.addListener(() => {
  console.log("Moonfill extension installed");
});

// --- Remember which tab to return to once a given form tab finishes ---
async function rememberOrigin(formTabId, originTabId) {
  if (!formTabId || !originTabId) return;
  await chrome.storage.session.set({ [`moonfillOrigin_${formTabId}`]: originTabId });
}

async function recallAndClearOrigin(formTabId) {
  const key = `moonfillOrigin_${formTabId}`;
  const data = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return data[key];
}

// --- Kick off the whole flow (called from the popup) ---
// Lives entirely in the background so it keeps running even after the popup
// closes (which happens the instant focus moves to the new tab).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.action === "startMoonfill" && msg.url) {
    (async () => {
      // Plan A: storage, read by content.js as soon as it loads
      await chrome.storage.local.set({ advertiserID: msg.advertiserID, geo: msg.geo });
      // The tab must be focused for Microsoft Forms to render its fields —
      // Chrome throttles rendering in background tabs.
      const tab = await chrome.tabs.create({ url: msg.url, active: true });
      await rememberOrigin(tab.id, msg.originTabId);
    })();
    return;
  }

  // --- Kick off the flow from the Salesforce injected button ---
  if (msg && msg.action === "openForm" && msg.url) {
    (async () => {
      const tab = await chrome.tabs.create({ url: msg.url, active: true });
      const originTabId = sender && sender.tab ? sender.tab.id : null;
      await rememberOrigin(tab.id, originTabId);
    })();
    return;
  }
});

// --- Close the form tab once it's done, and return the user to where they were ---
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.action !== "closeTab") return;

  const formTabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  const finishAndClose = async (tabId) => {
    if (!tabId) {
      console.warn("background: no tab id to close.");
      return;
    }
    try {
      const originTabId = await recallAndClearOrigin(tabId);
      if (originTabId) {
        try {
          const originTab = await chrome.tabs.get(originTabId);
          await chrome.tabs.update(originTabId, { active: true });
          if (originTab && originTab.windowId != null) {
            await chrome.windows.update(originTab.windowId, { focused: true });
          }
          console.log("background: refocused origin tab", originTabId);
        } catch (e) {
          console.warn("background: origin tab gone, skipping refocus:", e.message);
        }
      }
    } finally {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          console.warn("background: chrome.tabs.remove error:", chrome.runtime.lastError.message);
        } else {
          console.log("background: tab closed.");
        }
      });
    }
  };

  if (formTabId) {
    finishAndClose(formTabId);
    return;
  }

  // Fallback: no tab id available at all — locate an open forms tab
  chrome.tabs.query({ url: ["*://forms.office.com/*", "*://forms.cloud.microsoft/*"] }, (formTabs) => {
    if (formTabs && formTabs.length > 0) {
      finishAndClose(formTabs[0].id);
    } else {
      console.warn("background: no forms tab found to close.");
    }
  });
});
