// web-vitals.js: send real-user Core Web Vitals (plus FCP and TTFB) to your own endpoint.
// Uses the `web-vitals` library (checked with v6.2.3; onFID was removed in v5). Install it:
//   npm install web-vitals
// The attribution build adds the element, script, or phase behind each value.
// Replace '/rum' with your collector. Keep the payload small: a beacon has a size limit.

import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals/attribution';

const ENDPOINT = '/rum';
const queue = new Set();

function addToQueue(metric) {
  queue.add({
    name: metric.name,            // LCP, INP, CLS, FCP, TTFB
    value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value), // CLS x1000
    rating: metric.rating,        // good | needs-improvement | poor
    id: metric.id,                // unique per page load; dedupe on this
    navigationType: metric.navigationType, // navigate, reload, back-forward-cache, prerender...
    page: location.pathname,      // group by route template on the server, not raw URL
    // One short hint about the cause, from the attribution build:
    target:
      metric.attribution?.target ||                 // LCP element / INP interaction target
      metric.attribution?.largestShiftTarget ||     // CLS
      metric.attribution?.interactionTarget ||
      undefined,
    connection: navigator.connection?.effectiveType, // Chromium only
  });
}

function flush() {
  if (queue.size === 0) return;
  const body = JSON.stringify([...queue]);
  queue.clear();
  // sendBeacon survives page unload; fall back to keepalive fetch.
  if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body))) {
    fetch(ENDPOINT, { body, method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' } });
  }
}

onCLS(addToQueue);
onINP(addToQueue);
onLCP(addToQueue);
onFCP(addToQueue);
onTTFB(addToQueue);

// Report when the page is hidden (tab switch, navigation, app background).
// Do not use `unload`: it blocks the back/forward cache and no longer fires in Chrome.
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

// Product metric: mark when the thing users wait for is on screen, then report it
// with the same pipeline. Call markFirstContent() from the component that renders
// the first post / product / article body.
export function markFirstContent(name = 'first-content') {
  if (performance.getEntriesByName(name, 'mark').length) return; // once per page
  performance.mark(name);
  const [entry] = performance.getEntriesByName(name, 'mark');
  queue.add({ name, value: Math.round(entry.startTime), id: `${name}-${performance.timeOrigin}`, page: location.pathname });
}
