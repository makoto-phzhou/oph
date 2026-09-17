// Per-tab pixel status, kept in memory only (cleared on navigation/close).
const tabStatus = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PIXEL_STATUS" && sender.tab?.id != null) {
    tabStatus.set(sender.tab.id, { ...message.payload, updatedAt: Date.now() });
    return;
  }
  if (message?.type === "GET_STATUS") {
    sendResponse(tabStatus.get(message.tabId) ?? null);
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabStatus.delete(tabId));

// Drop stale status as soon as a top-level navigation starts, so a stale
// pixel/event list from the previous page never lingers in the popup.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    tabStatus.delete(details.tabId);
  }
});
