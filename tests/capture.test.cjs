const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BV = 'BV1xx411c7mD';
const OTHER_BV = 'BV1GJ411x7h7';
const TRACK = { id: 1, lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/test.json' };
const API = (cid, bvid = BV) => `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`;
const root = path.join(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));

function bus() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      const current = listeners.get(name) || [];
      current.push(callback);
      listeners.set(name, current);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback.call(this, event);
    },
    listenerCount(name) { return (listeners.get(name) || []).length; }
  };
}

function harness({ fetch, state, playinfo, main = true, browserNamespace = false } = {}) {
  let messageHandler;
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  class Event { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  class XHR {
    constructor() { Object.assign(this, bus()); this.status = 200; this.responseType = ''; }
    open(method, url) { this.responseURL = url; return 'opened'; }
    send() { return 'sent'; }
    get responseText() {
      if (this.responseType === 'json') throw new Error('InvalidStateError');
      return this.text;
    }
    complete(data, responseType = 'json') {
      this.responseType = responseType;
      this.response = data;
      this.text = JSON.stringify(data);
      this.dispatchEvent(new Event('load'));
    }
  }
  const window = Object.assign(bus(), { fetch: fetch || (() => Promise.reject(new Error('unexpected request'))), __INITIAL_STATE__: state, __playinfo__: playinfo });
  const document = Object.assign(bus(), { readyState: 'loading' });
  const location = new URL(`https://www.bilibili.com/video/${BV}/`);
  const context = vm.createContext({ window, document, location, URL, Date: Clock, CustomEvent: Event, XMLHttpRequest: XHR, [browserNamespace ? 'browser' : 'chrome']: { runtime: { onMessage: { addListener(fn) { messageHandler = fn; } } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'capture.js'), 'utf8'), context);
  if (main) vm.runInContext(fs.readFileSync(path.join(root, 'capture-main.js'), 'utf8'), context);
  return {
    window, document, location, XHR,
    advance(ms) { now += ms; },
    emit(detail) { window.dispatchEvent(new Event('bse-subtitle-capture', { detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })); },
    get(cid, bvid = BV) {
      let response;
      messageHandler({ action: 'bse:getCapturedSubtitles', bvid, cid }, {}, result => { response = result; });
      return JSON.parse(JSON.stringify(response));
    }
  };
}

function response(data, options = {}) {
  let clones = 0;
  const result = { ok: true, ...options, clone() { clones++; return { json: async () => data }; } };
  return { result, clones: () => clones };
}

function captured(cid, overrides = {}) {
  return { bvid: BV, cid: String(cid), url: API(cid), raw: [TRACK], source: 'fetch', ...overrides };
}

test('isolated bridge also works when only the Safari browser namespace exists', () => {
  const h = harness({ browserNamespace: true, main: false });
  h.emit(captured(123));
  assert.equal(h.get(123).raw.length, 1);
  assert.equal(h.get(123).raw[0].lan, 'zh-CN');
});

test('fetch keeps original promise/response and captures only the exact BV and CID', async () => {
  const data = { code: 0, data: { subtitle: { subtitles: [TRACK] } } };
  const res = response(data);
  const original = Promise.resolve(res.result);
  const h = harness({ fetch: () => original });
  const returned = h.window.fetch(new URL(API(123)));
  assert.equal(returned, original);
  assert.equal(await returned, res.result);
  await flush();
  assert.equal(res.clones(), 1);
  assert.equal(h.get(123).raw[0].subtitle_url, 'https://aisubtitle.hdslb.com/bfs/subtitle/test.json');
  assert.equal(h.get(1234).raw.length, 0);
  assert.equal(h.get(123, OTHER_BV).raw.length, 0);
  assert.equal(h.get(undefined).raw.length, 0);
});

test('aid-based request identity is captured before navigation, never from the response-time URL', async () => {
  let finish;
  const original = new Promise(resolve => { finish = resolve; });
  const h = harness({ fetch: () => original, state: { videoData: { bvid: BV, aid: 99, cid: 123 } } });
  h.window.fetch('https://api.bilibili.com/x/player/v2?aid=99&cid=123');
  h.location.href = `https://www.bilibili.com/video/${OTHER_BV}/`;
  h.window.__INITIAL_STATE__ = { videoData: { bvid: OTHER_BV, aid: 100, cid: 456 } };
  finish(response({ code: 0, data: { subtitle: { subtitles: [TRACK] } } }).result);
  await flush();
  assert.equal(h.get(123, BV).raw.length, 1);
  assert.equal(h.get(123, OTHER_BV).raw.length, 0);
});

test('aid requests with unrelated page state and no response identity are not assigned to the active video', async () => {
  const res = response({ code: 0, data: { subtitle: { subtitles: [TRACK] } } });
  const h = harness({ fetch: () => Promise.resolve(res.result), state: { videoData: { bvid: BV, aid: 99 } } });
  await h.window.fetch('https://api.bilibili.com/x/player/v2?aid=100&cid=123');
  await flush();
  assert.equal(res.clones(), 1);
  assert.equal(h.get(123).raw.length, 0);
});

test('aid-only requests use matching response identity when page state is stale or missing', async () => {
  for (const state of [undefined, { videoData: { bvid: BV, aid: 99, cid: 456 } }]) {
    let finish;
    const original = new Promise(resolve => { finish = resolve; });
    const h = harness({ fetch: () => original, state });
    h.window.fetch('https://api.bilibili.com/x/player/wbi/v2?aid=100&cid=123');
    h.location.href = 'https://www.bilibili.com/video/BV17x411w7KC/';
    h.window.__INITIAL_STATE__ = { videoData: { bvid: 'BV17x411w7KC', aid: 101, cid: 789 } };
    finish(response({ code: 0, data: { aid: 100, cid: 123, bvid: OTHER_BV, subtitle: { subtitles: [TRACK] } } }).result);
    await flush();
    assert.equal(h.get(123, OTHER_BV).raw.length, 1);
    assert.equal(h.get(123, BV).raw.length, 0);
    assert.equal(h.get(123, 'BV17x411w7KC').raw.length, 0);
  }
});

test('aid-only response identity must include matching aid and CID', async () => {
  for (const identity of [
    { aid: 101, cid: 123, bvid: OTHER_BV },
    { aid: 100, cid: 456, bvid: OTHER_BV },
    { cid: 123, bvid: OTHER_BV },
    { aid: 100, bvid: OTHER_BV }
  ]) {
    const h = harness({ fetch: () => Promise.resolve(response({ code: 0, data: { ...identity, subtitle: { subtitles: [TRACK] } } }).result) });
    await h.window.fetch('https://api.bilibili.com/x/player/wbi/v2?aid=100&cid=123');
    await flush();
    assert.equal(h.get(123, OTHER_BV).raw.length, 0);
  }
});

test('mismatched response CID/BV and API errors never become captured subtitles', async () => {
  for (const data of [
    { code: 0, data: { bvid: OTHER_BV, subtitle: { subtitles: [TRACK] } } },
    { code: 0, data: { cid: 456, subtitle: { subtitles: [TRACK] } } },
    { code: -101, data: { subtitle: { subtitles: [TRACK] } } }
  ]) {
    const h = harness({ fetch: () => Promise.resolve(response(data).result) });
    await h.window.fetch(API(123));
    await flush();
    assert.equal(h.get(123).raw.length, 0);
  }
});

test('only recognized player API requests are inspected; network rejection is preserved', async () => {
  const res = response({ code: 0, data: { subtitle: { subtitles: [TRACK] } } });
  const h = harness({ fetch: () => Promise.resolve(res.result) });
  for (const url of ['https://evil.test/x/player/v2?bvid=' + BV + '&cid=123', 'https://api.bilibili.com/not-player?subtitle=1&cid=123']) await h.window.fetch(url);
  await flush();
  assert.equal(res.clones(), 0);
  const failure = new Error('offline');
  const failing = harness({ fetch: () => Promise.reject(failure) });
  await assert.rejects(failing.window.fetch(API(123)), error => error === failure);
  await flush();
});

test('XHR JSON response type is supported, and reused XHR has only one capture listener', () => {
  const h = harness();
  const xhr = new h.XHR();
  assert.equal(xhr.open('GET', API(123)), 'opened');
  assert.equal(xhr.send(), 'sent');
  xhr.complete({ code: 0, data: { subtitle: { subtitles: [TRACK] } } });
  assert.equal(h.get(123).raw.length, 1);
  xhr.open('GET', API(456));
  xhr.send();
  xhr.complete({ code: 0, data: { subtitle: { subtitles: [TRACK] } } }, 'text');
  assert.equal(h.get(456).raw.length, 1);
  assert.equal(xhr.listenerCount('load'), 1);
});

test('bridge rejects malformed events, mismatched CID and unsafe subtitle URLs', () => {
  const h = harness({ main: false });
  h.emit('not JSON');
  h.emit(captured(123, { cid: '1234' }));
  h.emit(captured(123, { url: 'https://evil.test/x/player/v2?cid=123' }));
  for (const subtitle_url of ['javascript:alert(1)', 'https://bilibili.com.evil.test/a', 'https://evil.test/a', 'https://user@aisubtitle.hdslb.com/a', 'http://aisubtitle.hdslb.com/a']) {
    h.emit(captured(123, { raw: [{ ...TRACK, subtitle_url }] }));
  }
  assert.equal(h.get(123).raw.length, 0);
  h.emit(captured(123));
  assert.equal(h.get(123).raw.length, 1);
});

test('capture cache is bounded and expires signed subtitle URLs', () => {
  const h = harness({ main: false });
  for (let cid = 1; cid <= 31; cid++) h.emit(captured(cid));
  assert.equal(h.get(1).raw.length, 0);
  assert.equal(h.get(2).raw.length, 1);
  assert.equal(h.get(31).raw.length, 1);
  h.advance(10 * 60 * 1000 + 1);
  assert.equal(h.get(31).raw.length, 0);
});

test('page state keeps its own CID and rejects globals belonging to another video', () => {
  const h = harness({ state: { videoData: { bvid: BV, cid: 123, subtitle: { subtitles: [TRACK] } } }, playinfo: { data: { bvid: OTHER_BV, cid: 456, subtitle: { subtitles: [TRACK] } } } });
  h.document.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(h.get(123).raw.length, 1);
  assert.equal(h.get(456).raw.length, 0);
  assert.equal(h.get(456, OTHER_BV).raw.length, 0);
});
