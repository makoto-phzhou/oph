// Runs in the page world so calls made to window.oaiq can be observed.
(function () {
  const SOURCE_TAG = "oaiq-pixel-helper";
  const knownInitCalls = new Map();
  const scannedQueues = new WeakMap();
  const wrapped = new WeakMap();
  const ourWrappers = new WeakSet();
  let lastPresence;
  let bridgeReady = false;
  const pendingEvents = [];

  function copy(value) {
    if (value === undefined) return null;
    const seen = new WeakSet();
    try {
      return JSON.parse(JSON.stringify(value, (_key, item) => {
        if (typeof item === "bigint") return String(item);
        if (typeof item === "function") return "[function]";
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[circular]";
          seen.add(item);
        }
        return item;
      }));
    } catch {
      return "[unserializable]";
    }
  }

  function publish(type, payload) {
    if (!bridgeReady) {
      if (type === "PIXEL_EVENT") pendingEvents.push(payload);
      return;
    }
    window.postMessage({ source: SOURCE_TAG, type, payload }, "*");
  }

  function report() {
    const present = !!window.oaiq;
    if (present === lastPresence && !knownInitCalls.size) return;
    lastPresence = present;
    publish("DETECTION", {
      oaiqPresent: present,
      pixelIds: [...knownInitCalls.keys()],
      initCalls: [...knownInitCalls.values()],
    });
  }

  function capture(args) {
    const [command, first, second, third, fourth] = args;
    if (command === "init" && first && typeof first === "object") {
      const pixelId = first.pixelId == null ? null : String(first.pixelId);
      if (pixelId) knownInitCalls.set(pixelId, {
        pixelId, debug: !!first.debug, hasUser: !!first.user,
      });
      report();
      return;
    }
    if (command !== "measure" && command !== "measureSingle") return;
    const targeted = command === "measureSingle";
    publish("PIXEL_EVENT", {
      command,
      pixelIds: targeted ? (first == null ? [] : [String(first)]) : [...knownInitCalls.keys()],
      eventName: String(targeted ? second : first),
      data: copy(targeted ? third : second),
      options: copy(targeted ? fourth : third),
      timestamp: Date.now(),
    });
  }

  function inspect() {
    const current = window.oaiq;
    if (typeof current !== "function") {
      report();
      return;
    }
    const queue = current.q;
    if (Array.isArray(queue)) {
      const start = scannedQueues.get(queue) ?? 0;
      for (let i = start; i < queue.length; i++) capture(Array.from(queue[i] || []));
      scannedQueues.set(queue, queue.length);
    }
    // The polling loop sees our replacement on its next pass. Wrapping it
    // again would make one page call pass through every wrapper and appear
    // many times in the popup.
    if (ourWrappers.has(current)) return;
    if (wrapped.has(current)) {
      window.oaiq = wrapped.get(current);
      return;
    }
    const replacement = function (...args) {
      capture(args);
      const result = current.apply(this, args);
      if (Array.isArray(current.q)) scannedQueues.set(current.q, current.q.length);
      return result;
    };
    // Preserve the snippet queue and any SDK properties used by the page.
    Object.setPrototypeOf(replacement, current);
    wrapped.set(current, replacement);
    ourWrappers.add(replacement);
    window.oaiq = replacement;
    report();
  }

  // Observe assignments immediately. A page can create the stub, queue init,
  // and replace it with the SDK between two polling passes.
  const descriptor = Object.getOwnPropertyDescriptor(window, "oaiq");
  if (!descriptor || (descriptor.configurable && !descriptor.get && !descriptor.set)) {
    let value = window.oaiq;
    Object.defineProperty(window, "oaiq", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return value; },
      set(next) {
        value = next;
        if (!ourWrappers.has(next)) inspect();
      },
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE_TAG || event.data?.type !== "BRIDGE_READY") return;
    bridgeReady = true;
    lastPresence = undefined;
    report();
    for (const payload of pendingEvents.splice(0)) publish("PIXEL_EVENT", payload);
  });

  inspect();
  // The snippet and SDK can each replace window.oaiq. Continue watching for
  // replacements so calls made after the initial page load are captured too.
  setInterval(inspect, 250);
})();
