// Isolated world: bridges inject-detect.js (page world) to background.js,
// and does the DOM-visible parts of detection (the SDK <script> tag).
(function () {
  const SOURCE_TAG = "oaiq-pixel-helper";
  const SCRIPT_SRC_MATCH = "bzrcdn.openai.com/sdk/oaiq";

  const status = {
    scriptTagFound: false,
    scriptSrc: null,
    oaiqPresent: false,
    pixelIds: [],
    initCalls: [],
  };

  function sendToBackground(message) {
    // A Chrome extension reload invalidates content scripts already running in
    // open tabs. Those tabs need a page reload before they can capture again.
    if (!chrome.runtime?.id) return;
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // The context may have been invalidated between the check and send.
    }
  }

  function send() {
    sendToBackground({ type: "PIXEL_STATUS", payload: status });
  }

  function scanScriptTags() {
    const scripts = document.querySelectorAll("script[src]");
    for (const el of scripts) {
      if (el.src && el.src.includes(SCRIPT_SRC_MATCH)) {
        status.scriptTagFound = true;
        status.scriptSrc = el.src;
        return;
      }
    }
  }

  scanScriptTags();
  send();

  // Tag managers etc. can inject the snippet after our first scan.
  const observer = new MutationObserver(() => {
    if (!status.scriptTagFound) {
      scanScriptTags();
      if (status.scriptTagFound) send();
    }
  });
  // document_start can run before <html> exists. The Document itself is
  // always available, so watch it until a dynamically inserted SDK appears.
  observer.observe(document, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== SOURCE_TAG) return;
    if (msg.type === "PIXEL_EVENT") {
      sendToBackground({ type: "PIXEL_EVENT", payload: msg.payload });
      return;
    }
    if (msg.type !== "DETECTION") return;

    status.oaiqPresent = msg.payload.oaiqPresent;
    status.pixelIds = msg.payload.pixelIds;
    status.initCalls = msg.payload.initCalls;
    send();
  });
  window.postMessage({ source: SOURCE_TAG, type: "BRIDGE_READY" }, "*");
})();
