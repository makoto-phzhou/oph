# OaiQ Pixel Helper — Chrome Extension Plan

Troubleshooting extension for the [OpenAI Ads Measurement Pixel](https://developers.openai.com/ads/measurement-pixel): detects whether the pixel is installed on a page, and shows every tracked event with its parameters.

## Background: how the pixel works

- SDK loads from `https://bzrcdn.openai.com/sdk/oaiq.min.js`, exposes a global queue function `window.oaiq`.
- Init: `oaiq("init", { pixelId, user, debug, consent })`. Call once per Pixel ID — a page can initialize multiple pixels (e.g. `<PIXEL-ID-A>`, `<PIXEL-ID-B>`).
- Events: `oaiq("measure", eventName, eventDataObj, optionsObj)`.
  - `eventName`: a standard name (e.g. `order_created`, `page_viewed`, `lead_created`, `subscription_created`) or `"custom"`.
  - `eventDataObj.type` selects the data shape: `contents`, `customer_action`, `plan_enrollment`, or `custom`.
  - `optionsObj` may carry `event_id` (dedup), `custom_event_name` (required for custom events), `opt_out`.
  - **`measure` broadcasts the event to every Pixel ID initialized at the time of the call.** A pixel initialized later does not receive earlier events.
- Multi-pixel targeting: `oaiq("measureSingle", pixelId, eventName, eventDataObj, optionsObj)` sends the event to exactly one Pixel ID (same event data/options shape as `measure`, with `pixelId` inserted first). Targeting an uninitialized Pixel ID silently drops the event — the SDK does not send it anywhere.
- Network traffic:
  - `https://bzr.openai.com` — actual event pings (`fetch`/`sendBeacon`, with an `img` fallback).
  - `https://bzrcdn.openai.com` — per-pixel config fetch.
- The SDK auto-adds fields not present in the developer's call: `oppref` (also stored in a first-party `__oppref` cookie), `source_url`, event timestamps, and (if automatic advanced matching is on) SHA-256-hashed customer info.
- Consent: if `oaiq("consent", false)` was called (or a stored denial exists), events are queued but **not sent** until consent becomes `true`; blocked events are not replayed retroactively.

**Implication for the tool**: the call site (what the site's JS invokes) and the wire payload (what actually reaches `bzr.openai.com`) can differ — batching, auto-added fields, and consent blocking all cause divergence. The helper should capture and show both.

**Implication for multi-pixel pages**: a single `measure` call can fan out into multiple network requests (one per initialized pixel), each carrying its own `pixelId`. The wire payload's `pixelId` field is therefore the reliable attribution key — it correctly separates a fan-out `measure` into per-pixel events and naturally handles `measureSingle` (one request, one pixel) without special-casing the call type.

## Architecture (Manifest V3)

Toolbar popup + badge (final choice — mirrors Meta Pixel Helper / TikTok Pixel Helper). No devtools panel, no export.

```
extension/
├── manifest.json
├── background.js       # service worker: webRequest capture, per-tab state, badge
├── content-script.js   # bridges inject.js <-> background.js
├── inject.js            # world:"MAIN", wraps window.oaiq
├── validators.js        # misconfiguration checks, shared by background + popup
├── popup.html
├── popup.js
└── icons/
```

1. **Page-context hook (`inject.js`, `world: "MAIN"`)**
   Wraps `window.oaiq` so every `init` / `measure` / `measureSingle` / `consent` call is captured exactly as invoked by the page (event name, raw data object, options, and — for `measureSingle` — the target `pixelId`). For a plain `measure` call, also snapshot which Pixel IDs were initialized at that moment, to compute the expected fan-out.

2. **Network capture (`background.js`, `chrome.webRequest`)**
   Listens on `bzr.openai.com/*` and `bzrcdn.openai.com/*`. Decodes the actual outgoing payload (query string or request body) per tab, **including its `pixelId`**. This is ground truth — confirms an event actually sent, was batched, or was blocked by consent, and which specific pixel received it.

3. **Content script bridge**
   Relays `inject.js` `postMessage` calls to `background.js` via `chrome.runtime.sendMessage`, keyed by `tabId`.

4. **Per-tab state (in-memory, in the service worker), keyed by Pixel ID**
   ```
   {
     pixelInitOrder: string[],          // order matters: later init misses earlier broadcasts
     pixels: {
       "<pixelId>": {
         initCall: {...},
         consent: bool,
         debug: bool,
         events: [{
           eventName, customEventName, dataShape, params, options,
           autoFields,          // oppref, source_url, timestamps
           source: "measure" | "measureSingle",
           callSite: {...},    // raw args from inject.js, if matched
           wirePayload: {...}, // decoded bzr.openai.com request
           sent: bool,
           timestamp
         }]
       }
     },
     unattributedWireEvents: [...]  // requests whose pixelId matched no known init — flags a misconfigured/unknown Pixel ID
   }
   ```
   Cleared on navigation / tab close.

5. **Popup UI (`popup.html`/`popup.js`)**
   - **Status card**: one row/chip per detected Pixel ID (supports multiple), each with its own consent state, debug flag, and init order; plus whether the SDK `<script>` tag was found in `<head>`.
   - **Event timeline**: a Pixel ID filter (All / specific ID) above a chronological list. Each row shows event name (or `custom_event_name`), data shape, all parameters (`amount`, `currency`, `contents[]`, `plan_id`, etc.), options (`event_id`, `opt_out`), auto-added fields (`oppref`, `source_url`), which Pixel ID(s) it targeted, and a sent/queued/blocked badge.
   - Expandable raw JSON per event, showing call-site vs. wire-payload side by side.

6. **Validation layer (`validators.js`)**
   Flags common misconfigurations:
   - Missing `pixelId`.
   - Non-integer `amount` / `quantity`.
   - Invalid custom event name (must be 1–64 chars, letters/numbers/underscore/dash, start/end alphanumeric).
   - Custom event name colliding with a standard event name.
   - `contents[]` entries with undocumented fields.
   - Event fired while consent is `false` (won't be sent).
   - Duplicate `event_id` reused across unrelated events (checked per Pixel ID).
   - `measureSingle` targeting a Pixel ID with no matching `init` call (silently dropped by the SDK).
   - `measure` call whose expected fan-out (Pixel IDs initialized at call time) doesn't match the Pixel IDs actually seen on the wire (dropped/blocked broadcast).

7. **Toolbar badge**
   The current detection build uses a muted icon by default, switches to a green icon when the SDK or pixel is detected, and shows the count of distinct initialized Pixel IDs on the current tab. Event counts and validation warnings remain planned for the later event-capture work.

**Current event display:** The popup lists captured `measure` and `measureSingle` calls with their target Pixel IDs, event data, and options. It keeps the latest 100 calls per tab in memory. These are calls made by the page, not confirmed network deliveries; wire-payload capture and sent/blocked status remain future work.

## Manifest permissions

- `activeTab`, `scripting`, `storage`, `webRequest`
- Host permissions: `https://bzr.openai.com/*`, `https://bzrcdn.openai.com/*`
- Content script injected at `document_start` on `<all_urls>` for detection

## Local development (no Chrome Web Store needed)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**, select the `extension/` folder (the one containing `manifest.json`).
4. After code changes: click the refresh icon on the extension's card (or reload the whole extensions page); reload any open tab for content-script changes to take effect.

## Build order

1. Detection + status card (script tag scan, `window.oaiq` presence, one entry per Pixel ID).
2. Network capture of real events hitting `bzr.openai.com`, attributed by the wire payload's `pixelId`.
3. Page-context hook for call-site fidelity (`inject.js`), including `measureSingle` targeting and `measure` fan-out snapshotting.
4. Validation rules, including the multi-pixel-specific checks (unknown-target `measureSingle`, dropped fan-out).
5. UI polish (timeline with Pixel ID filter, JSON diff view, badge states).

## Explicitly out of scope for v1

- Exporting captured events (JSON/HAR).
- Devtools panel.
