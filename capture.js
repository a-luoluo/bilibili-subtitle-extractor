// ISOLATED world: keep the cache and extension APIs out of the page's world.
(() => {
  const store = new Map();
  const MAX_ENTRIES = 30;
  const MAX_AGE = 10 * 60 * 1000;
  const validBvid = value => typeof value === 'string' && /^BV[a-zA-Z0-9]{10}$/.test(value);
  const validCid = value => /^[1-9]\d{0,19}$/.test(String(value || ''));

  function subtitleURL(value) {
    if (typeof value !== 'string' || value.length > 8192) return '';
    try {
      const url = new URL(value.startsWith('//') ? 'https:' + value : value);
      const host = url.hostname;
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      if (!(host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'hdslb.com' || host.endsWith('.hdslb.com'))) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 100).flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const url = subtitleURL(item.subtitle_url || item.url);
      if (!url) return [];
      const lan = typeof item.lan === 'string' ? item.lan.slice(0, 50) : '';
      const lanDoc = typeof item.lan_doc === 'string' ? item.lan_doc.slice(0, 100) : '';
      const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).slice(0, 50) : '';
      if (!lan && !lanDoc && !id) return [];
      return [{ id, lan, lan_doc: lanDoc, subtitle_url: url }];
    });
  }

  function prune() {
    const now = Date.now();
    for (const [key, item] of store) if (now - item.time > MAX_AGE) store.delete(key);
    while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
  }

  window.addEventListener('bse-subtitle-capture', event => {
    // Page events are untrusted. Only accept bounded, plain JSON and known hosts.
    if (typeof event.detail !== 'string' || event.detail.length > 1024 * 1024) return;
    try {
      const detail = JSON.parse(event.detail);
      if (!detail || !validBvid(detail.bvid) || !validCid(detail.cid)) return;
      const url = new URL(detail.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
      if (!(url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))) return;
      if (!['fetch', 'xhr', 'playinfo', 'initial-state'].includes(detail.source)) return;
      if (detail.source === 'fetch' || detail.source === 'xhr') {
        if (url.hostname !== 'api.bilibili.com' || !/^\/x\/player\/(?:wbi\/)?v2$/.test(url.pathname)) return;
        if (url.searchParams.get('cid') !== String(detail.cid)) return;
        const requestBvid = url.searchParams.get('bvid');
        if (requestBvid && requestBvid !== detail.bvid) return;
      }
      const raw = normalize(detail.raw);
      if (!raw.length) return;
      const key = detail.bvid + ':' + detail.cid;
      store.delete(key);
      store.set(key, { raw, source: detail.source, time: Date.now(), url: url.href });
      prune();
    } catch (_) { /* An unrelated page event must never break the player. */ }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== 'bse:getCapturedSubtitles') return false;
    prune();
    const item = validBvid(msg.bvid) && validCid(msg.cid) ? store.get(msg.bvid + ':' + msg.cid) : null;
    sendResponse(item || { raw: [], source: 'capture-empty' });
    return false;
  });
})();
