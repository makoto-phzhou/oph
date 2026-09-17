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
    root.innerHTML = `<p class="muted">No data yet for this tab. Reload the page and reopen this popup.</p>`;
    return;
  }

  const detected = status.scriptTagFound || status.oaiqPresent;
  const pixelIds = status.pixelIds || [];
  const initCalls = status.initCalls || [];

  root.innerHTML = `
    <div class="status-card">
      <div class="row">
        <span class="label">Pixel detected</span>
        <span class="value ${detected ? "ok" : "bad"}">${detected ? "Yes" : "No"}</span>
      </div>
      <div class="row">
        <span class="label">SDK script tag</span>
        <span class="value ${status.scriptTagFound ? "ok" : "bad"}">${
    status.scriptTagFound ? "Found" : "Not found"
  }</span>
      </div>
      <div class="row">
        <span class="label">window.oaiq</span>
        <span class="value ${status.oaiqPresent ? "ok" : "bad"}">${
    status.oaiqPresent ? "Present" : "Absent"
  }</span>
      </div>
    </div>

    <h2>Pixel IDs (${pixelIds.length})</h2>
    ${
      pixelIds.length === 0
        ? `<p class="muted">No init(...) calls detected yet.</p>`
        : `<ul class="pixel-list">${pixelIds
            .map((id) => {
              const call = initCalls.find((c) => c.pixelId === id);
              return `<li>
                <span class="pixel-id">${escapeHtml(id)}</span>
                <span class="flags">
                  ${call?.debug ? '<span class="chip">debug</span>' : ""}
                  ${call?.hasUser ? '<span class="chip">user data</span>' : ""}
                </span>
              </li>`;
            })
            .join("")}</ul>`
    }
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
