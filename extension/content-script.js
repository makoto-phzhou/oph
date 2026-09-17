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

  function send() {
    chrome.runtime.sendMessage({ type: "PIXEL_STATUS", payload: status }).catch(() => {});
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
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== SOURCE_TAG || msg.type !== "DETECTION") return;

    status.oaiqPresent = msg.payload.oaiqPresent;
    status.pixelIds = msg.payload.pixelIds;
    status.initCalls = msg.payload.initCalls;
    send();
  });
})();
