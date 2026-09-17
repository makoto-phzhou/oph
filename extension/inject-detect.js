// Runs in the page's own ("MAIN") JS world, so it can see window.oaiq the
// same way the page's own scripts do. Isolated-world content scripts cannot
// see page-defined globals directly, which is why this file is separate.
(function () {
  const SOURCE_TAG = "oaiq-pixel-helper";

  function extractInitCalls(queue) {
    const initCalls = [];
    // Before the real SDK loads, window.oaiq is the snippet's stub queue
    // function and window.oaiq.q is a real array of `arguments` objects
    // (from `q.q.push(arguments)`) — array-like, not Array instances.
    if (!queue || typeof queue.length !== "number") return initCalls;
    for (let i = 0; i < queue.length; i++) {
      const args = queue[i];
      if (!args || typeof args.length !== "number") continue;
      const command = args[0];
      const data = args[1];
      if (command === "init" && data && typeof data === "object") {
        initCalls.push({
          pixelId: data.pixelId ?? null,
          debug: !!data.debug,
          hasUser: !!data.user,
        });
      }
    }
    return initCalls;
  }

  function report() {
    const oaiq = window.oaiq;
    const present = typeof oaiq === "function" || typeof oaiq === "object";
    const initCalls = extractInitCalls(present ? oaiq.q : undefined);
    const seen = new Set();
    const pixelIds = [];
    for (const call of initCalls) {
      if (call.pixelId && !seen.has(call.pixelId)) {
        seen.add(call.pixelId);
        pixelIds.push(call.pixelId);
      }
    }

    window.postMessage(
      {
        source: SOURCE_TAG,
        type: "DETECTION",
        payload: { oaiqPresent: present, pixelIds, initCalls },
      },
      "*"
    );
  }

  report();
  // The SDK script loads async and may replace window.oaiq once it arrives,
  // so keep checking for a while after initial page load.
  const retryDelays = [250, 1000, 3000, 6000];
  retryDelays.forEach((ms) => setTimeout(report, ms));

  let lastOaiq = window.oaiq;
  const interval = setInterval(() => {
    if (window.oaiq !== lastOaiq) {
      lastOaiq = window.oaiq;
      report();
    }
  }, 500);
  setTimeout(() => clearInterval(interval), 15000);
})();
