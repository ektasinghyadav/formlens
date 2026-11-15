// @vitest-environment jsdom
// Event tracker tests with a fake page. Requirements: FR-3.1-3.4, NFR-2.2, NFR-3.2, NFR-5.1. (Sprint 4)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTracker } from '../tracker/eventTracker.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let n = 0;

// A fake page: a form with two text inputs and a submit button, plus fake network and storage.
function setup({ fetchImpl, beacon = true, stored } = {}) {
  document.body.innerHTML = `<form id="f">
    <input id="a" data-field-id="${A}"><input id="b" data-field-id="${B}"><button type="submit">Go</button></form>`;
  const container = document.getElementById('f');
  const fetchFn = vi.fn(fetchImpl || (async () => ({ ok: true, status: 202 })));
  const beaconFn = vi.fn(() => beacon);
  const mem = stored ? { 'dfua:events': JSON.stringify(stored) } : {};
  const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
  const tracker = createTracker({ formId: 'F', sessionId: `S${++n}`, endpoint: '/e', container, fetchFn, beaconFn, storage });
  const sent = () => fetchFn.mock.calls.flatMap((c) => JSON.parse(c[1].body).events);
  const types = () => sent().map((e) => e.event_type);
  const $ = (id) => document.getElementById(id);
  const focus = (el) => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const blur = (el) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const tick = (ms) => vi.advanceTimersByTimeAsync(ms);
  return { tracker, container, fetchFn, beaconFn, mem, sent, types, $, focus, blur, type, tick };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('capturing (FR-3.1-3.3)', () => {
  it('emits form_opened on start, then focus, input, blur, field_completed in order, each with ids and an ISO time', async () => {
    const t = setup();
    t.tracker.start();
    t.focus(t.$('a'));
    t.type(t.$('a'), 'hello');
    t.blur(t.$('a'));
    await t.tick(500);
    expect(t.types()).toEqual(['form_opened', 'focus', 'input', 'blur', 'field_completed']);
    for (const e of t.sent()) {
      expect(e.event_id).toMatch(UUID);
      expect(e.session_id).toMatch(/^S\d+$/);
      expect(e.form_id).toBe('F');
      expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
    }
    const [opened, focus, input] = t.sent();
    expect(opened.field_id).toBeNull(); // session-level event
    expect(focus.field_id).toBe(A);
    expect(input.metadata).toEqual({ chars: 5 });
  });

  it('never puts typed text in any request or in localStorage (NFR-3.2)', async () => {
    const t = setup({ fetchImpl: async () => { throw new Error('offline'); } }); // fails, so events are also stored
    t.tracker.start();
    t.focus(t.$('a'));
    t.type(t.$('a'), 'my-secret-password-123');
    t.blur(t.$('a'));
    await t.tick(500);
    const everything = JSON.stringify(t.fetchFn.mock.calls) + JSON.stringify(t.mem);
    expect(everything).not.toContain('my-secret');
    expect(t.sent().find((e) => e.event_type === 'input').metadata).toEqual({ chars: 22 }); // length is recorded, text is not
  });

  it('records at most one input event per field per 250 ms', async () => {
    const t = setup();
    t.tracker.start();
    for (const v of ['a', 'ab', 'abc', 'abcd', 'abcde']) t.type(t.$('a'), v);
    await t.tick(250);
    t.type(t.$('a'), 'abcdef');
    await t.tick(500);
    expect(t.sent().filter((e) => e.event_type === 'input').map((e) => e.metadata.chars)).toEqual([1, 6]);
  });

  it('ignores elements without a data-field-id (like the Submit button)', async () => {
    const t = setup();
    t.tracker.start();
    t.focus(t.container.querySelector('button'));
    await t.tick(500);
    expect(t.types()).toEqual(['form_opened']);
  });

  it('sends form_opened only once per session even if started twice (React dev mode)', async () => {
    const t = setup();
    t.tracker.start();
    t.tracker.stop();
    t.tracker.start();
    await t.tick(500);
    expect(t.types().filter((x) => x === 'form_opened')).toHaveLength(1);
  });
});

describe('errors, completions and corrections (FR-3.1, SPEC section 10)', () => {
  it('emits "error" each time a field becomes aria-invalid, not while it stays invalid', async () => {
    const t = setup();
    t.tracker.start();
    t.$('a').setAttribute('aria-invalid', 'true');
    t.$('b').setAttribute('aria-invalid', 'true');
    await t.tick(0);
    t.$('a').setAttribute('aria-invalid', 'true'); // still invalid: no new error
    await t.tick(0);
    t.$('a').removeAttribute('aria-invalid');
    await t.tick(0);
    t.$('a').setAttribute('aria-invalid', 'true'); // invalid again: new error
    await t.tick(500);
    const errors = t.sent().filter((e) => e.event_type === 'error');
    expect(errors.map((e) => e.field_id)).toEqual([A, B, A]);
  });

  it('emits field_completed only for a non-empty, valid field, and only once until it is edited', async () => {
    const t = setup();
    t.tracker.start();
    t.focus(t.$('a')); t.blur(t.$('a')); await t.tick(0); // empty -> not completed
    t.type(t.$('b'), 'x'); t.$('b').setAttribute('aria-invalid', 'true'); t.blur(t.$('b')); await t.tick(0); // invalid -> not completed
    t.type(t.$('a'), 'ok'); t.blur(t.$('a')); await t.tick(0);
    t.focus(t.$('a')); t.blur(t.$('a')); await t.tick(0); // visited again, unchanged -> no second completion
    await t.tick(500);
    expect(t.sent().filter((e) => e.event_type === 'field_completed').map((e) => e.field_id)).toEqual([A]);
  });

  it('gives field_completed the time of the blur', async () => {
    const t = setup();
    t.tracker.start();
    t.type(t.$('a'), 'ok');
    t.blur(t.$('a'));
    await t.tick(500);
    const e = t.sent();
    expect(e.find((x) => x.event_type === 'field_completed').timestamp).toBe(e.find((x) => x.event_type === 'blur').timestamp);
  });

  it('emits "correction" when a flagged or completed field is edited, once per edit episode', async () => {
    const t = setup();
    t.tracker.start();
    t.$('a').setAttribute('aria-invalid', 'true'); await t.tick(0); // flagged
    t.type(t.$('a'), 'x'); // correction
    await t.tick(300);
    t.type(t.$('a'), 'xy'); // same episode: no second correction
    t.$('a').removeAttribute('aria-invalid');
    t.blur(t.$('a')); await t.tick(0); // completed
    await t.tick(300);
    t.type(t.$('a'), 'xyz'); // edit after completion: correction again
    await t.tick(500);
    expect(t.sent().filter((e) => e.event_type === 'correction')).toHaveLength(2);
  });

  it('does not call a first-time edit of a fresh field a correction', async () => {
    const t = setup();
    t.tracker.start();
    t.type(t.$('a'), 'first');
    await t.tick(500);
    expect(t.types()).not.toContain('correction');
  });
});

describe('batching (FR-3.4, NFR-1.3)', () => {
  it('sends nothing before 500 ms, then one request; sends nothing when the list is empty', async () => {
    const t = setup();
    t.tracker.start();
    await t.tick(499);
    expect(t.fetchFn).not.toHaveBeenCalled();
    await t.tick(1);
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
    expect(t.fetchFn.mock.calls[0][0]).toBe('/e');
    expect(t.fetchFn.mock.calls[0][1].method).toBe('POST');
    await t.tick(2000); // nothing new -> no more requests
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never sends more than 100 events per request, and keeps the order', async () => {
    const t = setup();
    t.tracker.start();
    for (let i = 0; i < 250; i++) t.focus(i % 2 ? t.$('a') : t.$('b'));
    await t.tick(500);
    const sizes = t.fetchFn.mock.calls.map((c) => JSON.parse(c[1].body).events.length);
    expect(sizes).toEqual([100, 100, 51]); // 250 focus events + form_opened
    expect(t.sent()[0].event_type).toBe('form_opened');
    expect(t.tracker.pending()).toBe(0);
  });

  it('flushes immediately when the form is submitted', async () => {
    const t = setup();
    t.tracker.start();
    t.focus(t.$('a'));
    t.container.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await t.tick(0);
    expect(t.fetchFn).toHaveBeenCalledTimes(1); // no 500 ms wait
  });
});

describe('losing and regaining the network (NFR-2.2, NFR-2.1)', () => {
  it('while offline: sends nothing, keeps events in localStorage, then delivers them when "online" fires', async () => {
    const t = setup();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    t.tracker.start();
    t.focus(t.$('a'));
    await t.tick(1500);
    expect(t.fetchFn).not.toHaveBeenCalled();
    expect(JSON.parse(t.mem['dfua:events'])).toHaveLength(2); // form_opened + focus are safe on disk

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await t.tick(0);
    expect(t.types()).toEqual(['form_opened', 'focus']);
    expect(t.mem['dfua:events']).toBeUndefined(); // nothing left to resend
    expect(t.tracker.pending()).toBe(0);
  });

  it('after a network error: keeps the events, retries on the next tick with the SAME ids, loses none', async () => {
    let calls = 0;
    const t = setup({ fetchImpl: async () => { if (++calls === 1) throw new Error('network down'); return { ok: true, status: 202 }; } });
    t.tracker.start();
    t.focus(t.$('a'));
    await t.tick(500); // first attempt fails
    expect(t.tracker.pending()).toBe(2);
    expect(JSON.parse(t.mem['dfua:events'])).toHaveLength(2);
    await t.tick(500); // retry works
    const [first, second] = t.fetchFn.mock.calls.map((c) => JSON.parse(c[1].body).events.map((e) => e.event_id));
    expect(second).toEqual(first); // same ids, so the server can ignore a duplicate
    expect(t.tracker.pending()).toBe(0);
    expect(t.mem['dfua:events']).toBeUndefined();
  });

  it('keeps events after a server error (500) but drops a batch the server rejects for good (400)', async () => {
    const t500 = setup({ fetchImpl: async () => ({ ok: false, status: 500 }) });
    t500.tracker.start();
    await t500.tick(500);
    expect(t500.tracker.pending()).toBe(1);
    t500.tracker.stop();

    const t400 = setup({ fetchImpl: async () => ({ ok: false, status: 400 }) });
    t400.tracker.start();
    await t400.tick(500);
    expect(t400.tracker.pending()).toBe(0); // would be retried forever otherwise
  });

  it('replays events left in localStorage by an earlier visit, before the new ones', async () => {
    const old = { event_id: 'old-1', session_id: 'OLD', form_id: 'F', field_id: null, event_type: 'focus', timestamp: new Date().toISOString(), metadata: null };
    const t = setup({ stored: [old] });
    t.tracker.start();
    await t.tick(500);
    expect(t.sent()[0].event_id).toBe('old-1');
    expect(t.sent()).toHaveLength(2);
    expect(t.mem['dfua:events']).toBeUndefined();
  });

  it('keeps working when localStorage is unavailable', async () => {
    const t = setup();
    const broken = createTracker({
      formId: 'F', sessionId: `S${++n}`, endpoint: '/e', container: t.container, fetchFn: t.fetchFn, beaconFn: t.beaconFn,
      storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } },
    });
    broken.start();
    await t.tick(500);
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('abandonment (FR-3.2, D-5)', () => {
  // FileReader needs real timers, so switch the fake clock off before reading
  const readBlob = (blob) => new Promise((res) => { vi.useRealTimers(); const r = new FileReader(); r.onload = () => res(JSON.parse(r.result)); r.readAsText(blob); });
  const hide = (state) => { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };

  it('on pagehide: sends pending events plus form_abandoned (with the last field) in one beacon, once only', async () => {
    const t = setup();
    t.tracker.start();
    t.focus(t.$('a')); t.focus(t.$('b'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    expect(t.beaconFn).toHaveBeenCalledTimes(1);
    const body = await readBlob(t.beaconFn.mock.calls[0][1]);
    expect(body.events.map((e) => e.event_type)).toEqual(['form_opened', 'focus', 'focus', 'form_abandoned']);
    expect(body.events.at(-1).field_id).toBe(B);
    expect(t.tracker.pending()).toBe(0);
  });

  it('also on the tab being hidden; coming back lets a later exit be reported again', async () => {
    const t = setup();
    t.tracker.start();
    hide('hidden');
    expect(t.beaconFn).toHaveBeenCalledTimes(1);
    hide('visible');
    hide('hidden');
    expect(t.beaconFn).toHaveBeenCalledTimes(2);
    hide('visible');
  });

  it('keeps the events (in memory and localStorage) if the browser refuses the beacon', () => {
    const t = setup({ beacon: false });
    t.tracker.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(t.tracker.pending()).toBe(2); // form_opened + form_abandoned
    expect(JSON.parse(t.mem['dfua:events'])).toHaveLength(2);
  });

  it('sends no form_abandoned after stop() (a finished form is not an abandoned one)', () => {
    const t = setup();
    t.tracker.start();
    t.tracker.stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(t.beaconFn).not.toHaveBeenCalled();
  });
});

describe('module boundary (NFR-5.1)', () => {
  it('eventTracker.js imports nothing at all, so it cannot depend on React', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/tracker/eventTracker.js'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(|from\s+['"]react/);
  });
});
