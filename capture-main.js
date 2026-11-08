// MAIN world, declared in manifest.json: no inline script injection or eval.
(() => {
  if (window.__bseSubtitleCaptureInstalled) return;
  window.__bseSubtitleCaptureInstalled = true;
  const validBvid = value => typeof value === 'string' && /^BV[a-zA-Z0-9]{10}$/.test(value);
  const validCid = value => /^[1-9]\d{0,19}$/.test(String(value || ''));

  function pageBvid() {
    return (location.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})(?:\/|$)/) || [])[1] || '';
  }

  function playerRequest(input) {
    try {
      const value = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'api.bilibili.com' || url.port || url.username || url.password) return null;
      if (!/^\/x\/player\/(?:wbi\/)?v2$/.test(url.pathname)) return null;
      const cid = url.searchParams.get('cid');
      if (!validCid(cid)) return null;
      const aid = url.searchParams.get('aid') || '';
      if (aid && !validCid(aid)) return null;
      let bvid = url.searchParams.get('bvid') || '';
      if (bvid && !validBvid(bvid)) return null;
      // Capture identity when the request STARTS, not after a SPA navigation.
      if (!bvid) {
        const video = window.__INITIAL_STATE__?.videoData;
        const stateBvid = video?.bvid || video?.bv_id;
        if (aid && String(video?.aid) === aid && validBvid(stateBvid) && stateBvid === pageBvid()) bvid = stateBvid;
      }
      // A response may provide the BV identity before page globals are ready.
      return validBvid(bvid) || aid ? { bvid, aid, cid, url: url.href } : null;
    } catch (_) { return null; }
  }

  function dispatch(info, raw, source) {
    if (!info || !validBvid(info.bvid) || !validCid(info.cid) || !Array.isArray(raw) || !raw.length) return;
    const detail = JSON.stringify({ ...info, raw: raw.slice(0, 100), source });
    if (detail.length <= 1024 * 1024) window.dispatchEvent(new CustomEvent('bse-subtitle-capture', { detail }));
  }

  function inspect(info, json, source) {
    if (!info || !json || typeof json !== 'object' || (json.code !== undefined && json.code !== 0)) return;
    const data = json.data || json.result || json;
    // If the API carries identity, reject a mismatched response as well.
    if (info.aid && data.aid !== undefined && String(data.aid) !== info.aid) return;
    if (info.bvid && data.bvid !== undefined && data.bvid !== info.bvid) return;
    if (data.cid !== undefined && String(data.cid) !== info.cid) return;
    let bvid = info.bvid;
    if (!bvid) {
      // Resolve aid-only requests from the matching response, never the new URL.
      if (!info.aid || String(data.aid) !== info.aid || String(data.cid) !== info.cid || !validBvid(data.bvid)) return;
      bvid = data.bvid;
    }
    dispatch({ ...info, bvid }, data.subtitle?.subtitles || data.subtitle?.list || data.subtitles, source);
  }

  const rawFetch = window.fetch;
  if (typeof rawFetch === 'function') {
    window.fetch = function(input) {
      const info = playerRequest(input);
      const promise = rawFetch.apply(this, arguments);
      // Return the original promise/Response; observe only a cloned body.
      if (info) promise.then(response => {
        try {
          if (response.ok) response.clone().json().then(json => inspect(info, json, 'fetch')).catch(() => {});
        } catch (_) { /* Capture must not affect the request. */ }
      }, () => {}).catch(() => {});
      return promise;
    };
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const requests = new WeakMap();
    const installed = new WeakSet();
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      const result = rawOpen.apply(this, arguments);
      requests.set(this, playerRequest(url));
      return result;
    };
    XMLHttpRequest.prototype.send = function() {
      if (!installed.has(this)) {
        installed.add(this);
        this.addEventListener('load', function() {
          try {
            const info = requests.get(this);
            if (!info || this.status < 200 || this.status >= 300) return;
            // responseText throws when responseType === 'json'.
            if (this.responseType === 'json') inspect(info, this.response, 'xhr');
            else if (!this.responseType || this.responseType === 'text') inspect(info, JSON.parse(this.responseText), 'xhr');
          } catch (_) { /* Ignore non-JSON and failed responses. */ }
        });
      }
      return rawSend.apply(this, arguments);
    };
  }

  function inspectPageState() {
    try {
      const video = window.__INITIAL_STATE__?.videoData;
      const bvid = video?.bvid || video?.bv_id;
      if (validBvid(bvid) && bvid === pageBvid() && validCid(video.cid)) {
        dispatch({ bvid, cid: String(video.cid), url: location.href }, video.subtitle?.subtitles || video.subtitle?.list, 'initial-state');
      }
      const play = window.__playinfo__?.data;
      // Do not infer a playinfo CID from another global's current page.
      const playBvid = play?.bvid || (play?.aid && String(play.aid) === String(video?.aid) ? bvid : '');
      if (validBvid(playBvid) && playBvid === pageBvid() && validCid(play?.cid)) {
        dispatch({ bvid: playBvid, cid: String(play.cid), url: location.href }, play.subtitle?.subtitles || play.subtitles, 'playinfo');
      }
    } catch (_) { /* Globals can be incomplete while the page is loading. */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inspectPageState, { once: true });
  else inspectPageState();
})();
