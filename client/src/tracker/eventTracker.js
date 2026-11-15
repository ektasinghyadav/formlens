// eventTracker.js - records HOW a respondent uses a form, never WHAT they type.
// Requirements: FR-3.1-3.4, NFR-1.3 (no slowdown), NFR-2.2 (offline buffer), NFR-3.2 (no typed
// text), NFR-5.1 (browser DOM only: this file must never import React).
//
// Think of a CCTV that only notes "person stood at desk 3 for 12 seconds, then left",
// and never records what they wrote at the desk.
//
// How it works:
//  * Listeners on the form container (event delegation) see focus, blur and input on any
//    element marked data-field-id. Each handler only builds a small object and pushes it
//    on a list. No network, no waiting: typing stays fast.
//  * Every 500 ms, if the list is not empty, up to 100 events are sent in one request.
//  * If sending fails or the browser is offline, the events stay in the list AND are copied
//    to localStorage, then retried (next tick, when the "online" event fires, or next visit).
//    Each event has its own id, so the server ignores a repeat (nothing counted twice).

const FLUSH_MS = 500;
const MAX_BATCH = 100;
const INPUT_GAP_MS = 250; // at most one "input" event per field per 250 ms
const STORE_KEY = 'dfua:events';
const MAX_STORED = 1000; // keep localStorage small: oldest events are dropped first

const openedSessions = new Set(); // so React dev mode (which starts effects twice) sends form_opened once

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // randomUUID only exists on secure pages (https or localhost); this works everywhere
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// localStorage can be missing or full (private mode); the tracker must keep working.
function safeStorage(storage) {
  return {
    read() {
      try { return JSON.parse(storage.getItem(STORE_KEY)) || []; } catch { return []; }
    },
    write(events) {
      try {
        if (events.length) storage.setItem(STORE_KEY, JSON.stringify(events.slice(-MAX_STORED)));
        else storage.removeItem(STORE_KEY);
      } catch { /* storage unavailable: events still go out by network */ }
    },
  };
}

// Looks at an element only to learn WHETHER it has a value, and how long it is. The value
// itself is never stored or sent.
function hasValue(el) {
  if (el.files) return el.files.length > 0;
  return String(el.value ?? '').trim() !== '';
}
const lengthOf = (el) => (el.files ? el.files.length : String(el.value ?? '').length);

export function createTracker({
  formId,
  sessionId,
  endpoint,
  container,
  fetchFn = (...args) => globalThis.fetch(...args),
  beaconFn = globalThis.navigator?.sendBeacon ? (...a) => globalThis.navigator.sendBeacon(...a) : null,
  storage = globalThis.localStorage,
}) {
  const store = safeStorage(storage);
  let queue = []; // events waiting to be delivered, oldest first
  let sending = false;
  let started = false;
  let abandonSent = false;
  let lastFieldId = null;
  let timer = null;
  let observer = null;
  const fields = new Map(); // field id -> { completed, hadError, lastInput }
  const cleanups = [];

  const fieldState = (id) => {
    if (!fields.has(id)) fields.set(id, { completed: false, hadError: false, lastInput: 0 });
    return fields.get(id);
  };
  const fieldIdOf = (el) => el?.closest?.('[data-field-id]')?.dataset.fieldId ?? null;

  function record(type, fieldId = null, metadata = null, time = Date.now()) {
    queue.push({
      event_id: makeId(),
      session_id: sessionId,
      form_id: formId,
      field_id: fieldId,
      event_type: type,
      timestamp: new Date(time).toISOString(),
      metadata,
    });
  }

  // ---- delivery ----

  // true = done with this batch (delivered, or the server will never accept it)
  // false = keep it and try again later
  async function send(batch) {
    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true, // lets the request finish even if the page is closing
      });
      if (res.ok) return true;
      return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    } catch {
      return false; // network error
    }
  }

  const removeSent = (batch) => { const gone = new Set(batch); queue = queue.filter((e) => !gone.has(e)); };

  async function flush() {
    if (sending || queue.length === 0) return;
    if (globalThis.navigator?.onLine === false) { store.write(queue); return; }
    sending = true;
    try {
      while (queue.length) {
        const batch = queue.slice(0, MAX_BATCH);
        if (!(await send(batch))) { store.write(queue); return; } // keep, retry on a later tick
        removeSent(batch);
        store.write(queue);
      }
    } finally {
      sending = false;
    }
  }

  // Page is closing: only sendBeacon is reliable then. It cannot report success, so if it
  // refuses we keep the events (and they are in localStorage for the next visit).
  function beaconAll() {
    if (!beaconFn || queue.length === 0) { store.write(queue); return; }
    const batch = queue.slice(0, MAX_BATCH);
    const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
    if (beaconFn(endpoint, blob)) removeSent(batch);
    store.write(queue);
  }

  // ---- handlers (each one only pushes onto the list) ----

  const onFocusIn = (e) => {
    const id = fieldIdOf(e.target);
    if (!id) return;
    lastFieldId = id;
    record('focus', id);
  };

  const onFocusOut = (e) => {
    const id = fieldIdOf(e.target);
    if (!id) return;
    const time = Date.now();
    record('blur', id, null, time);
    // The page validates on blur and updates aria-invalid a moment later, so look again
    // just after, to decide whether the field was completed correctly.
    setTimeout(() => {
      const st = fieldState(id);
      if (started && !st.completed && hasValue(e.target) && e.target.getAttribute('aria-invalid') !== 'true') {
        st.completed = true;
        st.hadError = false;
        record('field_completed', id, null, time);
      }
    }, 0);
  };

  const onInput = (e) => {
    const id = fieldIdOf(e.target);
    if (!id) return;
    const st = fieldState(id);
    const now = Date.now();
    // Editing a field that had an error, or was already completed, is a "correction".
    if (st.hadError || st.completed) {
      st.hadError = false;
      st.completed = false;
      record('correction', id, null, now);
    }
    if (now - st.lastInput >= INPUT_GAP_MS) {
      st.lastInput = now;
      record('input', id, { chars: lengthOf(e.target) }, now); // length only, never the text
    }
  };

  // The page marks a field aria-invalid="true" when validation fails; that is our "error".
  function onMutations(list) {
    for (const m of list) {
      const id = fieldIdOf(m.target);
      if (id && m.target.getAttribute('aria-invalid') === 'true' && m.oldValue !== 'true') {
        const st = fieldState(id);
        st.hadError = true;
        st.completed = false;
        record('error', id);
      }
    }
  }

  const onSubmit = () => { flush(); }; // get pending events out before the answers go
  const onOnline = () => { flush(); };

  // D-5: leaving the page, or hiding the tab, ends the visit unless the form was submitted.
  function abandon() {
    if (!started || abandonSent) return;
    abandonSent = true;
    record('form_abandoned', lastFieldId);
    beaconAll();
  }
  const onPageHide = () => abandon();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') abandon();
    else abandonSent = false; // they came back: a later exit can be reported again
  };

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  return {
    start() {
      if (started) return;
      started = true;
      abandonSent = false;
      queue = [...store.read(), ...queue]; // events left over from an offline visit

      listen(container, 'focusin', onFocusIn);
      listen(container, 'focusout', onFocusOut);
      listen(container, 'input', onInput);
      listen(container, 'submit', onSubmit, true);
      listen(globalThis, 'online', onOnline);
      listen(globalThis, 'pagehide', onPageHide);
      listen(document, 'visibilitychange', onVisibility);
      observer = new MutationObserver(onMutations);
      observer.observe(container, { attributes: true, attributeFilter: ['aria-invalid'], attributeOldValue: true, subtree: true });

      if (!openedSessions.has(sessionId)) {
        openedSessions.add(sessionId);
        record('form_opened');
      }
      timer = setInterval(flush, FLUSH_MS);
    },

    flush,

    // Normal end (form submitted, or page component removed). No "abandoned" is sent.
    stop() {
      if (!started) return;
      started = false;
      clearInterval(timer);
      observer?.disconnect();
      cleanups.splice(0).forEach((undo) => undo());
      flush();
    },

    pending: () => queue.length,
  };
}
