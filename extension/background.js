// Per-tab pixel status, kept in memory only (cleared on navigation/close).
const tabStatus = new Map();
const iconPaths = (state) => ({
  16: `icons/${state}-16.png`,
  32: `icons/${state}-32.png`,
});

function pixelIdsFor(status) {
  return [...new Set([
    ...(status?.pixelIds ?? []),
    ...(status?.events ?? []).flatMap((event) => event.pixelIds ?? []),
  ])];
}

function updateAction(tabId, status) {
  const count = pixelIdsFor(status).length;
  const detected = !!(status?.scriptTagFound || status?.oaiqPresent || status?.events?.length || count);
  chrome.action.setIcon({ tabId, path: iconPaths(detected ? "active" : "inactive") }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#0B7A5B" }).catch(() => {});
  chrome.action.setTitle({
    tabId,
    title: count
      ? `OaiQ Pixel Helper — ${count} pixel ${count === 1 ? "ID" : "IDs"} detected`
      : detected
        ? "OaiQ Pixel Helper — SDK detected; no Pixel ID found"
        : "OaiQ Pixel Helper — no pixel detected",
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PIXEL_STATUS" && sender.tab?.id != null && sender.frameId === 0) {
    const previous = tabStatus.get(sender.tab.id);
    const next = {
      ...message.payload,
      events: previous?.events ?? [],
      updatedAt: Date.now(),
    };
    tabStatus.set(sender.tab.id, next);
    updateAction(sender.tab.id, next);
    return;
  }
  if (message?.type === "PIXEL_EVENT" && sender.tab?.id != null && sender.frameId === 0) {
    const previous = tabStatus.get(sender.tab.id) ?? { events: [] };
    const events = [...(previous.events ?? []), message.payload].slice(-100);
    const next = { ...previous, events, updatedAt: Date.now() };
    tabStatus.set(sender.tab.id, next);
    updateAction(sender.tab.id, next);
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
    updateAction(details.tabId, null);
  }
});
