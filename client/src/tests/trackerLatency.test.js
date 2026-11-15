// @vitest-environment jsdom
// Latency check for NFR-1.3 (tracking adds <= 50 ms to typing). Real timers, real handlers.
// The tracker's handlers only push to an array, so the cost per keystroke should be tiny.
import { describe, it, expect } from 'vitest';
import { createTracker } from '../tracker/eventTracker.js';

function cost(withTracker) {
  document.body.innerHTML = '<form id="f"><input id="a" data-field-id="33333333-3333-4333-8333-333333333333"></form>';
  const container = document.getElementById('f');
  const input = document.getElementById('a');
  const tracker = createTracker({
    formId: 'F', sessionId: `L${withTracker}${Math.random()}`, endpoint: '/e', container,
    fetchFn: async () => ({ ok: true, status: 202 }), beaconFn: null,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  if (withTracker) tracker.start();
  const N = 5000;
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    input.value = 'x'.repeat(i % 50);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const perEventMs = (performance.now() - start) / N;
  tracker.stop();
  return perEventMs;
}

describe('NFR-1.3 input latency', () => {
  it('adds far less than 50 ms per keystroke', () => {
    cost(false); cost(true); // warm-up
    const off = cost(false);
    const on = cost(true);
    const added = on - off;
    console.log(`NFR-1.3: tracker off ${(off * 1000).toFixed(1)} us/key, on ${(on * 1000).toFixed(1)} us/key, added ${(added * 1000).toFixed(1)} us (limit 50000 us)`);
    expect(added).toBeLessThan(5); // 5 ms: 10x stricter than the 50 ms requirement
  });
});
