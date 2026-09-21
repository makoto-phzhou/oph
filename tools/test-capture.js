// Regression check for document_start, the page bridge, and repeated hook scans.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const extension = path.join(__dirname, '..', 'extension');
const callbacks = [];
const window = {
  addEventListener(type, callback) {
    if (type === 'message') callbacks.push(callback);
  },
  postMessage(data) {
    for (const callback of callbacks) callback({ source: window, data });
  },
};
const document = {
  documentElement: null, // Chrome may run content scripts before <html> exists.
  querySelectorAll() { return []; },
};
const received = [];
const chrome = {
  runtime: {
    id: 'test-extension',
    sendMessage(message) { received.push(message); return Promise.resolve(); },
  },
};
let inspect;
function MutationObserver() {}
MutationObserver.prototype.observe = function (target) {
  assert.equal(target, document);
};
MutationObserver.prototype.disconnect = function () {};

function run(file, context) {
  vm.runInNewContext(fs.readFileSync(path.join(extension, file), 'utf8'), context);
}
run('inject-detect.js', { window, setInterval(fn) { inspect = fn; } });
run('content-script.js', { window, document, chrome, MutationObserver, setTimeout() {} });

let sdkCalls = 0;
function stub(...args) { sdkCalls++; stub.q.push(args); }
stub.q = [];
window.oaiq = stub;
window.oaiq('init', { pixelId: 'test-pixel' });
window.oaiq('measure', 'items_added', { amount: 1 });
for (let i = 0; i < 20; i++) inspect();
window.oaiq('measure', 'page_viewed', { type: 'custom' });

const events = received.filter((message) => message.type === 'PIXEL_EVENT');
assert.equal(sdkCalls, 3);
assert.equal(events.length, 2);
assert.equal(events[0].payload.pixelIds[0], 'test-pixel');
assert.equal(events[1].payload.eventName, 'page_viewed');
assert.ok(received.some((message) => message.type === 'PIXEL_STATUS' &&
  message.payload.pixelIds[0] === 'test-pixel'));
console.log('document_start bridge: one captured event per call, with Pixel ID');
