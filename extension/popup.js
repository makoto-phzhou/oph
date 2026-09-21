async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function render(status) {
  const root = document.getElementById("root");
  if (!status) {
    root.innerHTML = `<p class="muted">No data yet for this tab. A page reload is needed after reloading the extension.</p><button class="reload-button" id="reload-page">Reload page</button>`;
    return;
  }

  const events = status.events || [];
  const pixelIds = [...new Set([
    ...(status.pixelIds || []),
    ...events.flatMap((event) => event.pixelIds || []),
  ])];
  const initCalls = status.initCalls || [];
  const detected = !!(status.scriptTagFound || status.oaiqPresent || events.length || pixelIds.length);
  const openEvents = new Set([...root.querySelectorAll("details.event[open]")].map((el) => el.dataset.index));

  root.innerHTML = `
    <div class="status-card">
      <div class="row">
        <span class="label">Pixel activity detected</span>
        <span class="value ${detected ? "ok" : "bad"}">${detected ? "Yes" : "No"}</span>
      </div>
      <div class="row">
        <span class="label">SDK script tag</span>
        <span class="value ${status.scriptTagFound ? "ok" : "bad"}">${
    status.scriptTagFound ? "Observed" : "Not observed"
  }</span>
      </div>
      <div class="row">
        <span class="label">window.oaiq</span>
        <span class="value ${status.oaiqPresent ? "ok" : "bad"}">${
    status.oaiqPresent ? "Present" : "Not present now"
  }</span>
      </div>
    </div>

    <h2>Pixel IDs (${pixelIds.length})</h2>
    ${
      pixelIds.length === 0
        ? `<p class="muted">No Pixel IDs observed yet.</p>`
        : `<ul class="pixel-list">${pixelIds
            .map((id) => {
              const call = initCalls.find((c) => c.pixelId === id);
              return `<li>
                <span class="pixel-id">${escapeHtml(id)}</span>
                <span class="flags">
                  ${call?.debug ? '<span class="chip">debug</span>' : ""}
                  ${call?.hasUser ? '<span class="chip">user data</span>' : ""}
                  ${!call ? '<span class="chip">from event</span>' : ""}
                </span>
              </li>`;
            })
            .join("")}</ul>`
    }
    <div class="section-heading"><h2>Events (${events.length})</h2><button class="reload-button" id="reload-page" title="Reload the page to restart capture">Reload page</button></div>
    ${events.length === 0
      ? '<p class="muted">No measure calls captured yet. Trigger an event on this page.</p>'
      : events.map((event, index) => `
        <details class="event" data-index="${index}" ${openEvents.has(String(index)) ? "open" : ""}>
          <summary>${escapeHtml(event.eventName || "Unknown event")}</summary>
          <div class="event-meta">Pixel ID: ${escapeHtml((event.pixelIds || []).join(", ") || "Unknown (init call not captured)")} · ${escapeHtml(event.command || "measure")} · ${new Date(event.timestamp).toLocaleTimeString()}</div>
          <div class="event-meta">Captured call; delivery is not verified</div>
          <strong>Event payload</strong><pre>${escapeHtml(JSON.stringify(event.data ?? null, null, 2))}</pre>
          <strong>Options</strong><pre>${event.options == null ? "No options supplied" : escapeHtml(JSON.stringify(event.options, null, 2))}</pre>
        </details>`).reverse().join("")}
  `;
}

async function refresh() {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    render(null);
    return;
  }
  chrome.runtime.sendMessage({ type: "GET_STATUS", tabId }, (status) => {
    render(status);
  });
}

document.addEventListener("DOMContentLoaded", refresh);
document.addEventListener("click", async (event) => {
  if (event.target?.id !== "reload-page") return;
  const tabId = await getActiveTabId();
  if (tabId != null) await chrome.tabs.reload(tabId);
  window.close();
});
setInterval(refresh, 1500);
