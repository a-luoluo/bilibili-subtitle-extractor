// Capture subtitle metadata that the normal Bilibili player loads in this tab.
(function(){
  const store=new Map();

  function parseVideoInfo(url){
    try{
      const u=new URL(url,location.href);
      const bvid=(u.href.match(/BV[a-zA-Z0-9]+/)||[])[0]||(location.href.match(/BV[a-zA-Z0-9]+/)||[])[0]||'';
      const cid=u.searchParams.get('cid')||'';
      return{bvid,cid};
    }catch(e){
      return{bvid:(location.href.match(/BV[a-zA-Z0-9]+/)||[])[0]||'',cid:''};
    }
  }

  function cleanUrl(u){
    if(!u||typeof u!=='string')return '';
    return u.startsWith('//')?'https:'+u:u;
  }

  function normalize(raw){
    return Array.isArray(raw)?raw.filter(s=>s&&(s.subtitle_url||s.url)&&(s.lan||s.lan_doc||s.id)).map(s=>({
      ...s,
      subtitle_url:cleanUrl(s.subtitle_url||s.url)
    })):[];
  }

  function save(detail){
    const raw=normalize(detail&&detail.raw);
    if(!raw.length)return;
    const info=parseVideoInfo(detail.url||location.href);
    const key=(info.bvid||'')+':'+(info.cid||'');
    store.set(key,{raw,source:detail.source||'capture',time:Date.now(),url:detail.url||''});
    if(info.bvid)store.set(info.bvid+':',store.get(key));
  }

  window.addEventListener('bse-subtitle-capture',e=>save(e.detail));

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg&&msg.action==='bse:getCapturedSubtitles'){
      const exact=store.get((msg.bvid||'')+':'+(msg.cid||''));
      const loose=store.get((msg.bvid||'')+':');
      const item=msg.cid?exact:(exact||loose);
      sendResponse(item||{raw:[],source:'capture-empty'});
      return true;
    }
    return false;
  });

  const script=document.createElement('script');
  script.textContent=`(()=> {
    if (window.__bseSubtitleCaptureInstalled) return;
    window.__bseSubtitleCaptureInstalled = true;

    const dispatch = (url, raw, source) => {
      if (!Array.isArray(raw) || !raw.length) return;
      window.dispatchEvent(new CustomEvent('bse-subtitle-capture', { detail: { url, raw, source } }));
    };
    const valid = s => s && typeof s === 'object' && (s.subtitle_url || s.url) && (s.lan || s.lan_doc || s.id);
    const findSubtitleLists = obj => {
      const out = [];
      const seen = new WeakSet();
      const walk = value => {
        if (!value || typeof value !== 'object') return;
        if (seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
          if (value.some(valid)) out.push(value);
          for (const item of value) walk(item);
          return;
        }
        for (const key of Object.keys(value)) walk(value[key]);
      };
      walk(obj);
      return out;
    };
    const inspectJSON = (url, data, source) => {
      if (!data || typeof data !== 'object') return;
      for (const list of findSubtitleLists(data)) dispatch(url, list, source);
    };
    const shouldInspect = url => /\\/x\\/player\\//.test(url) || /subtitle/i.test(url);

    const rawFetch = window.fetch;
    if (typeof rawFetch === 'function') {
      window.fetch = async function(input, init) {
        const res = await rawFetch.apply(this, arguments);
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || res.url || '';
          if (shouldInspect(url)) res.clone().json().then(data => inspectJSON(url, data, 'fetch')).catch(() => {});
        } catch (e) {}
        return res;
      };
    }

    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__bseUrl = String(url || '');
      return rawOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', function() {
        try {
          const url = this.__bseUrl || this.responseURL || '';
          if (!shouldInspect(url)) return;
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          if (text) inspectJSON(url, JSON.parse(text), 'xhr');
        } catch (e) {}
      });
      return rawSend.apply(this, arguments);
    };

    setTimeout(() => {
      inspectJSON(location.href, window.__playinfo__, 'playinfo');
      inspectJSON(location.href, window.__INITIAL_STATE__, 'initial-state');
    }, 0);
  })();`;
  (document.documentElement||document.head).appendChild(script);
  script.remove();
})();
