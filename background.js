// background.js - robust close-tab handler
chrome.runtime.onInstalled.addListener(() => {
  console.log("Moonfill extension installed");
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "openForm" && msg.url) {
    chrome.tabs.create({ url: msg.url, active: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log("background: received message:", message, "from sender:", sender);

  if (message && message.action === "closeTab") {
    // 1) If sender.tab is provided, close it
    if (sender && sender.tab && sender.tab.id) {
      const id = sender.tab.id;
      console.log("background: closing sender.tab.id =", id);
      chrome.tabs.remove(id, () => {
        if (chrome.runtime.lastError) {
          console.warn("background: chrome.tabs.remove error:", chrome.runtime.lastError.message);
        } else {
          console.log("background: tab closed (sender.tab).");
        }
      });
      return; // done
    }

    // 2) If message includes a tabId, use it
    if (message.tabId) {
      console.log("background: closing message.tabId =", message.tabId);
      chrome.tabs.remove(message.tabId, () => {
        if (chrome.runtime.lastError) {
          console.warn("background: chrome.tabs.remove error:", chrome.runtime.lastError.message);
        } else {
          console.log("background: tab closed (message.tabId).");
        }
      });
      return;
    }

    // 3) Fallback: try to find an open forms.office.com tab in the last focused window
    chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn("background: tabs.query error:", chrome.runtime.lastError.message);
        return;
      }

      // Prefer active tab in last focused window
      const active = tabs.find(t => t.active && t.id);
      if (active && active.url && active.url.includes("forms.office.com")) {
        console.log("background: closing active forms.office.com tab:", active.id, active.url);
        chrome.tabs.remove(active.id, () => {
          if (chrome.runtime.lastError) {
            console.warn("background: chrome.tabs.remove error:", chrome.runtime.lastError.message);
          } else {
            console.log("background: tab closed (active forms tab).");
          }
        });
        return;
      }

      // Otherwise find any tab whose URL contains forms.office.com
      chrome.tabs.query({ url: "*://forms.office.com/*" }, (formTabs) => {
        if (chrome.runtime.lastError) {
          console.warn("background: tabs.query(forms) error:", chrome.runtime.lastError.message);
          return;
        }
        if (formTabs && formTabs.length > 0) {
          // prefer the lastFocusedWindow match if possible
          const candidate = formTabs[0];
          console.log("background: closing first forms.office.com tab found:", candidate.id, candidate.url);
          chrome.tabs.remove(candidate.id, () => {
            if (chrome.runtime.lastError) {
              console.warn("background: chrome.tabs.remove error:", chrome.runtime.lastError.message);
            } else {
              console.log("background: tab closed (forms.office.com candidate).");
            }
          });
        } else {
          console.warn("background: no forms.office.com tab found to close.");
        }
      });
    });
  }
});
