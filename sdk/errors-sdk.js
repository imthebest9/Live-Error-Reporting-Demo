/*
 * Pulse error SDK. Captures uncaught errors, unhandled promise rejections and failed fetch calls,
 * and ships them in batches to the Pulse ingest API.
 *
 *   Pulse.init({ endpoint: 'http://localhost:5080/api/events', release: '1.0.3', getContext: () => ({ level }) });
 */
(function () {
  'use strict';

  var FLUSH_MS = 2000;   // send whatever is queued every 2 s...
  var MAX_BATCH = 20;    // ...or as soon as 20 events are waiting (the first error after a quiet spell goes at once)
  var DEDUPE_MS = 5000;  // the same error again within 5 s is counted, not sent
  var MAX_QUEUE = 500;   // if the API is unreachable, keep the newest 500 and drop the rest

  var cfg = null;
  var queue = [];
  var lastSent = 0;
  var sendTimer = null;
  var recent = new Map(); // dedupe key -> { event, until, repeats }
  var realFetch = window.fetch.bind(window); // the SDK sends with this, so it never reports its own requests
  var stats = { captured: 0, deduped: 0, sent: 0, rateLimited: 0, dropped: 0 };
  var sessionId = newSessionId();

  function init(options) {
    if (cfg) return;
    cfg = Object.assign({ release: 'dev', dedupe: true, getContext: null }, options);
    // addEventListener instead of assigning window.onerror, so a handler the page already has keeps working.
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.fetch = trackedFetch;
    window.addEventListener('pagehide', function () { flush(true); });
    setInterval(function () { flush(false); }, FLUSH_MS);
  }

  function onError(e) {
    var err = e.error instanceof Error ? e.error : null; // `throw "text"` arrives as a plain string
    var where = e.filename ? 'at ' + e.filename + ':' + e.lineno + ':' + e.colno : '';
    capture(err ? err.name : 'Error', err ? err.message : e.message, (err && err.stack) || where, 'onerror');
  }

  function onRejection(e) {
    var r = e.reason;
    if (r instanceof Error) capture(r.name, r.message, r.stack, 'unhandledrejection');
    else capture('UnhandledRejection', typeof r === 'string' ? r : safeJson(r), '', 'unhandledrejection');
  }

  // Reports network failures and non-2xx responses, then hands the result back untouched.
  function trackedFetch(input, init) {
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var callSite = callerStack();
    return realFetch(input, init).then(function (res) {
      if (!res.ok) capture('FetchError', method + ' ' + url + ' failed with status ' + res.status, callSite, 'fetch', { status: res.status });
      return res;
    }, function (err) {
      capture('FetchError', method + ' ' + url + ' failed: ' + err.message, callSite, 'fetch');
      throw err;
    });
  }

  function capture(type, message, stack, mechanism, extra) {
    try {
      stats.captured++;
      var event = {
        type: String(type || 'Error'),
        message: String(message == null ? '' : message).slice(0, 1000),
        stack: String(stack || '').slice(0, 8000),
        url: location.pathname,
        release: cfg.release,
        sessionId: sessionId,
        timestamp: new Date().toISOString(),
        context: Object.assign({ mechanism: mechanism }, cfg.getContext ? cfg.getContext() : null, extra),
      };
      if (cfg.dedupe && isDuplicate(event)) return;
      push(event);
      if (queue.length >= MAX_BATCH) sendQueued(false);
      else if (Date.now() - lastSent >= FLUSH_MS) sendSoon(); // quiet until now: don't make this one wait for the timer
    } catch (_) {
      // An error reporter must never throw into the page it is watching.
    }
  }

  // Same error again within 5 s? Count it instead of sending it. When its window closes, one event goes out
  // carrying the repeat count, so the server's totals stay exact while the network stays quiet.
  // The key is a cheap stand-in for the server's fingerprint: type + normalised message + top of the stack.
  function isDuplicate(event) {
    var key = event.type + '|' + normalize(event.message) + '|' + normalize(event.stack.split('\n').slice(0, 4).join(' '));
    var seen = recent.get(key);
    var now = Date.now();
    if (seen) {
      if (now < seen.until) { seen.repeats++; stats.deduped++; return true; }
      releaseRepeats(key, seen);
    }
    recent.set(key, { event: event, until: now + DEDUPE_MS, repeats: 0 });
    return false;
  }

  function releaseRepeats(key, seen) {
    recent.delete(key);
    if (seen.repeats > 0) push(Object.assign({}, seen.event, { count: seen.repeats, timestamp: new Date().toISOString() }));
  }

  function push(event) {
    if (queue.length >= MAX_QUEUE) { queue.shift(); stats.dropped++; }
    queue.push(event);
  }

  function flush(pageIsClosing) {
    recent.forEach(function (seen, key) {
      if (pageIsClosing || Date.now() >= seen.until) releaseRepeats(key, seen);
    });
    sendQueued(pageIsClosing);
  }

  // Waits 50 ms so errors thrown together (one bug often throws several) still share a request.
  function sendSoon() {
    if (sendTimer) return;
    sendTimer = setTimeout(function () { sendTimer = null; sendQueued(false); }, 50);
  }

  function sendQueued(pageIsClosing) {
    if (queue.length) lastSent = Date.now();
    while (queue.length) send(queue.splice(0, MAX_BATCH), pageIsClosing);
  }

  function send(batch, pageIsClosing) {
    // The session id rides in the query string so the server's rate limiter can read it without parsing the body.
    var url = cfg.endpoint + (cfg.endpoint.indexOf('?') < 0 ? '?' : '&') + 'sessionId=' + encodeURIComponent(sessionId);
    var body = JSON.stringify(batch);
    // A normal request can be cancelled while the page unloads; a beacon is handed to the browser and survives it.
    if (pageIsClosing && navigator.sendBeacon && navigator.sendBeacon(url, body)) {
      stats.sent += batch.length;
      return;
    }
    // text/plain keeps this a "simple" CORS request, so there is no preflight round trip before every batch.
    realFetch(url, { method: 'POST', body: body, keepalive: pageIsClosing, headers: { 'Content-Type': 'text/plain' } })
      .then(function (res) {
        if (res.ok) stats.sent += batch.length;
        else if (res.status === 429) stats.rateLimited += batch.length; // don't retry straight back into the limit
        else stats.dropped += batch.length;
      })
      .catch(function () { stats.dropped += batch.length; });
  }

  // Mirrors the server's message normalisation: URLs, GUIDs and numbers become placeholders.
  function normalize(text) {
    return String(text)
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<guid>')
      .replace(/\d+(?:\.\d+)?/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Where a failing fetch was called from, without the SDK's own frames on top.
  function callerStack() {
    return (new Error().stack || '').split('\n').filter(function (line) {
      return line.indexOf('errors-sdk') < 0;
    }).join('\n');
  }

  function newSessionId() {
    var id = Math.random().toString(36).slice(2, 10);
    try {
      var saved = sessionStorage.getItem('pulse.sessionId');
      if (saved) return saved;
      sessionStorage.setItem('pulse.sessionId', id);
    } catch (_) { /* storage blocked: a per-page-load id is fine */ }
    return id;
  }

  function safeJson(value) {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  window.Pulse = {
    init: init,
    captureException: function (err, context) {
      capture(err && err.name, err && err.message !== undefined ? err.message : err, err && err.stack, 'manual', context);
    },
    setDedupe: function (on) { cfg.dedupe = !!on; },
    flush: function () { flush(false); },
    stats: stats,
    sessionId: sessionId,
  };
})();
