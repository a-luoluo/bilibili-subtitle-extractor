// ============================================================
// B站字幕提取器 v7.2 - 完整响应诊断
// ============================================================

(function() {
  if (document.getElementById('bili-sub-ext')) return;

  const css = document.createElement('style');
  css.textContent = `
    #bili-sub-ext-floating {
      position: fixed; bottom: 160px; right: 16px; z-index: 9999;
      width: 40px; height: 40px; border-radius: 50%;
      background: #fb7299; color: #fff; border: none; cursor: pointer;
      font-size: 18px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 12px rgba(251,114,153,0.35); transition: all 0.2s;
    }
    #bili-sub-ext-floating:hover { transform: scale(1.12); }
    #bili-sub-ext-panel {
      position: fixed; top: 60px; right: 16px; z-index: 9998;
      width: 360px; max-height: calc(100vh - 100px); background: #fff;
      border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      display: none; flex-direction: column; overflow: hidden;
      font-family: "Microsoft YaHei","PingFang SC",sans-serif; font-size: 13px;
    }
    #bili-sub-ext-panel.show { display: flex; }
    #bili-sub-ext-panel .ph {
      padding: 10px 14px; border-bottom: 1px solid #eee;
      display: flex; align-items: center; gap: 8px; background: #fafafa;
    }
    #bili-sub-ext-panel .ph .pt { flex: 1; font-weight: bold; color: #fb7299; font-size: 14px; }
    #bili-sub-ext-panel .ph .pc { background: none; border: none; font-size: 18px; color: #999; cursor: pointer; }
    #bili-sub-ext-panel .ph .pc:hover { color: #fb7299; }
    #bili-sub-ext-panel .pb { padding: 10px 14px; overflow-y: auto; flex: 1; }
    #bili-sub-ext-panel .pb .s { margin-bottom: 8px; }
    #bili-sub-ext-panel .pb .st { font-size: 11px; color: #999; margin-bottom: 3px; }
    #bili-sub-ext-panel .pb .info { font-size: 12px; color: #333; line-height: 1.5; }
    #bili-sub-ext-panel .tag {
      display: inline-block; padding: 3px 8px; border-radius: 12px;
      border: 1px solid #00a1d6; color: #00a1d6; font-size: 11px;
      margin: 2px 3px 2px 0; cursor: pointer; transition: all 0.15s; user-select: none;
    }
    #bili-sub-ext-panel .tag:hover { background: #00a1d6; color: #fff; }
    #bili-sub-ext-panel .tag.on { background: #00a1d6; color: #fff; }
    #bili-sub-ext-panel .tag.ai { border-color: #fb7299; color: #fb7299; }
    #bili-sub-ext-panel .tag.ai:hover { background: #fb7299; color: #fff; }
    #bili-sub-ext-panel .tag.ai.on { background: #fb7299; color: #fff; }
    #bili-sub-ext-panel .ai-dot { background: #fb7299; color: #fff; font-size: 8px; padding: 1px 4px; border-radius: 3px; margin-left: 3px; }
    #bili-sub-ext-panel .btn-row { display: flex; gap: 6px; margin-top: 6px; }
    #bili-sub-ext-panel .btn { flex: 1; border: none; border-radius: 6px; padding: 7px; font-size: 12px; font-weight: bold; cursor: pointer; }
    #bili-sub-ext-panel .btn.blue { background: #00a1d6; color: #fff; }
    #bili-sub-ext-panel .btn.pink { background: #fb7299; color: #fff; }
    #bili-sub-ext-panel .btn:disabled { background: #eee; color: #bbb; cursor: not-allowed; }
    #bili-sub-ext-panel .btn:hover:not(:disabled) { opacity: 0.85; }
    #bili-sub-ext-panel .pre {
      background: #f9f9f9; border-radius: 6px; padding: 8px;
      font-size: 11px; line-height: 1.5; color: #555; margin-top: 6px;
      max-height: 100px; overflow-y: auto; display: none;
    }
    #bili-sub-ext-panel .pre.on { display: block; }
    #bili-sub-ext-panel .pre .pl { padding: 1px 0; border-bottom: 1px solid #eee; }
    #bili-sub-ext-panel .pre .ptm { color: #00a1d6; margin-right: 5px; }
    #bili-sub-ext-panel .msg {
      text-align: center; font-size: 11px; padding: 5px; border-radius: 4px;
      margin-top: 6px; display: none; word-break: break-all;
    }
    #bili-sub-ext-panel .msg.on { display: block; }
    #bili-sub-ext-panel .msg.info { background: #e3f2fd; color: #1565c0; }
    #bili-sub-ext-panel .msg.err { background: #fce4ec; color: #c62828; }
    #bili-sub-ext-panel .msg.ok { background: #e8f5e9; color: #2e7d32; }

    #bili-sub-ext-reader {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: #fff; z-index: 10000; display: none; flex-direction: column;
    }
    #bili-sub-ext-reader.on { display: flex; }
    #bili-sub-ext-reader .rh {
      padding: 10px 16px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 8px;
    }
    #bili-sub-ext-reader .rback {
      background: none; border: 1px solid #00a1d6; color: #00a1d6;
      border-radius: 5px; padding: 3px 10px; cursor: pointer; font-size: 12px;
    }
    #bili-sub-ext-reader .rback:hover { background: #00a1d6; color: #fff; }
    #bili-sub-ext-reader .rtitle { flex: 1; font-weight: bold; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #bili-sub-ext-reader .rbody { flex: 1; overflow-y: auto; padding: 14px 18px; font-size: 14px; line-height: 2; color: #333; }
    #bili-sub-ext-reader .rp { text-indent: 2em; margin-bottom: 2px; }
    #bili-sub-ext-reader .rt { display: inline-block; color: #fb7299; font-size: 11px; margin-right: 8px; min-width: 36px; cursor: pointer; padding: 1px 3px; border-radius: 3px; }
    #bili-sub-ext-reader .rt:hover { background: #fb7299; color: #fff; }
  `;
  document.head.appendChild(css);

  const fb = document.createElement('button');
  fb.id = 'bili-sub-ext-floating'; fb.title = '提取字幕'; fb.textContent = '📝';
  document.body.appendChild(fb);

  const pn = document.createElement('div');
  pn.id = 'bili-sub-ext-panel';
  pn.innerHTML = `
    <div class="ph"><span class="pt">🎬 字幕提取器</span><button class="pc" id="bse-close">✕</button></div>
    <div class="pb">
      <div class="s"><div class="st">📺 视频</div><div class="info" id="bse-info">点击📝检测</div></div>
      <div class="s" id="bse-subsec" style="display:none"><div class="st">📝 字幕</div><div id="bse-tags"></div></div>
      <div class="s" id="bse-fmtsec" style="display:none">
        <div class="st">📄 格式</div>
        <div style="display:flex;gap:4px">
          <span class="tag on fmt" data-f="srt">SRT</span>
          <span class="tag fmt" data-f="txt">TXT</span>
          <span class="tag fmt" data-f="json">JSON</span>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn pink" id="bse-read" disabled>📖 阅读</button>
        <button class="btn blue" id="bse-dl" disabled>⬇ 下载</button>
      </div>
      <div class="msg" id="bse-msg"></div>
      <div class="pre" id="bse-pre"></div>
    </div>
  `;
  document.body.appendChild(pn);

  const rd = document.createElement('div');
  rd.id = 'bili-sub-ext-reader';
  rd.innerHTML = '<div class="rh"><button class="rback" id="bse-rback">← 返回</button><div class="rtitle" id="bse-rtitle"></div></div><div class="rbody" id="bse-rbody"></div>';
  document.body.appendChild(rd);

  const Q = s => document.querySelector(s);
  let vd = null, subs = [], sel = null, fmt = 'srt', cache = [];

  function msg(t, c) { const e = Q('#bse-msg'); e.textContent = t; e.className = 'msg on ' + (c || 'info'); if (c === 'ok') setTimeout(() => e.classList.remove('on'), 2000); }
  function fm(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*1000); return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')+','+String(ms).padStart(3,'0'); }
  function fs(s) { const m=Math.floor(s/60),sec=Math.floor(s%60); return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'); }
  function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
  function sf(s) { return (s||'sub').replace(/[\\/:*?"<>|]/g,'_').substring(0,80); }

  function dumpKeys(obj, prefix) {
    if (!obj || typeof obj !== 'object') return String(obj);
    if (Array.isArray(obj)) return 'Array['+obj.length+']';
    return '{'+Object.keys(obj).join(', ')+'}';
  }

  async function detect() {
    msg('检测中...', 'info');
    const bv = location.href.match(/BV[a-zA-Z0-9]+/);
    if (!bv) { msg('非视频页', 'err'); return; }
    const bvid = bv[0];

    let cid = 0, title = '';
    try { const s = window.__INITIAL_STATE__; if (s?.videoData?.cid) { cid = s.videoData.cid; title = s.videoData.title || ''; } } catch(e) {}
    if (!cid) {
      const pl = await (await fetch('https://api.bilibili.com/x/player/pagelist?bvid='+bvid)).json();
      if (pl.code===0 && pl.data?.length>0) { cid = pl.data[0].cid; title = pl.data[0].part || ''; }
    }
    if (!cid) { msg('无法获取CID', 'err'); return; }
    if (!title) title = document.title.replace(/_哔哩哔哩_bilibili/i,'').replace(/^[(\s]*/,'').replace(/[)\s]*$/,'').trim();
    vd = { bvid, cid, title };
    Q('#bse-info').innerHTML = '<b>'+esc(title)+'</b><br><span style="font-size:10px;color:#aaa">CID: '+cid+'</span>';

    const sub = await (await fetch('https://api.bilibili.com/x/player/v2?bvid='+bvid+'&cid='+cid)).json();
    
    // 完整诊断
    const data = sub.data || {};
    const keys = Object.keys(data);
    msg('data keys: '+keys.join(', ')+' | subtitle: '+dumpKeys(data.subtitle), 'info');

    let raw = data?.subtitle?.subtitles || [];

    // 如果 standard 路径没有，尝试所有可能路径
    if (raw.length === 0) {
      // 检查 player/v2 的其他可能字段
      const altPaths = [
        data?.subtitle?.list,
        data?.subtitles,
        data?.player?.subtitle,
        data?.video?.subtitle,
        sub?.result?.subtitle?.subtitles
      ];
      for (const alt of altPaths) {
        if (Array.isArray(alt) && alt.length > 0) {
          raw = alt;
          msg('found alt: '+alt.length+'条', 'info');
          break;
        }
      }
    }

    if (raw.length === 0) {
      // 终极大招：遍历 data 找任何包含 subtitle_url 的数组
      const s = JSON.stringify(data);
      msg('response preview: '+s.substring(0,200), 'err');
    }

    subs = raw.map(s => {
      const ld = (s.lan_doc||s.lan||'').substring(0,30);
      const im = ld.includes('音乐')||ld.includes('music');
      const ia = (s.lan||'').includes('ai')||ld.includes('自动生成')||ld.includes('AI');
      return { lang: ld, url: s.subtitle_url||'', key: s.lan||'', isAI: ia, isMusic: im };
    });
    const sp = subs.filter(s => !s.isMusic);
    if (sp.length > 0) subs = sp;

    if (subs.length === 0) { msg('无可用字幕', 'err'); return; }

    Q('#bse-tags').innerHTML = subs.map((s,i) => {
      const ai = s.isAI ? '<span class="ai-dot">AI</span>' : '';
      return '<span class="tag'+(s.isAI?' ai':'')+'" data-idx="'+i+'">'+s.lang+ai+'</span>';
    }).join('');
    Q('#bse-tags').querySelectorAll('.tag').forEach(el => el.addEventListener('click', () => selSub(parseInt(el.dataset.idx))));
    Q('#bse-subsec').style.display = 'block';
    Q('#bse-fmtsec').style.display = 'block';

    const idx = subs.findIndex(s => s.isAI&&s.key.includes('zh'));
    selSub(idx >= 0 ? idx : 0);
  }

  async function selSub(idx) {
    sel = idx; cache = [];
    Q('#bse-tags').querySelectorAll('.tag').forEach((el,i) => el.classList.toggle('on', i===idx));
    Q('#bse-read').disabled = false; Q('#bse-dl').disabled = false;
    const s = subs[idx];
    if (s.isMusic) return;
    Q('#bse-pre').innerHTML = '<div style="color:#aaa;text-align:center;padding:4px">加载预览...</div>';
    Q('#bse-pre').classList.add('on');
    try {
      let u = s.url; if (u.startsWith('//')) u = 'https:' + u;
      const d = await (await fetch(u)).json();
      const items = d.body || d || [];
      if (!Array.isArray(items) || !items.length) { Q('#bse-pre').innerHTML = '<div style="color:#c62828;text-align:center">数据异常</div>'; return; }
      const pre = items.slice(0, 3);
      Q('#bse-pre').innerHTML = pre.map(i => '<div class="pl"><span class="ptm">'+fm(i.from)+'</span>'+esc(i.content)+'</div>').join('');
      Q('#bse-pre').innerHTML += '<div style="color:#aaa;font-size:10px;text-align:center;padding:3px">共 '+items.length+' 条</div>';
    } catch(e) { Q('#bse-pre').innerHTML = '<div style="color:#c62828;text-align:center">加载失败</div>'; }
  }

  async function download() {
    if (sel === null) return; const s = subs[sel];
    if (s.isMusic) { msg('音乐轨', 'err'); return; }
    msg('下载中...', 'info');
    try {
      let u = s.url; if (u.startsWith('//')) u = 'https:' + u;
      const d = await (await fetch(u)).json();
      const items = d.body || d || [];
      if (!Array.isArray(items) || !items.length) { msg('数据异常', 'err'); return; }
      let c, fn;
      if (fmt === 'srt') { c = items.map((i,idx) => (idx+1)+'\n'+fm(i.from)+' --> '+fm(i.to)+'\n'+i.content+'\n').join('\n'); fn = sf(vd.title)+'.srt'; }
      else if (fmt === 'txt') { c = items.map(i => '['+fm(i.from)+'] '+i.content).join('\n'); fn = sf(vd.title)+'.txt'; }
      else { c = JSON.stringify(items,null,2); fn = sf(vd.title)+'.json'; }
      const b = new Blob(['\uFEFF'+c], { type: 'text/plain;charset=utf-8' });
      const u2 = URL.createObjectURL(b); const a = document.createElement('a');
      a.href = u2; a.download = fn; a.click(); URL.revokeObjectURL(u2);
      msg('OK: '+fn+' ('+items.length+'条)', 'ok');
    } catch(e) { msg('失败: '+e.message, 'err'); }
  }

  async function openReader() {
    if (sel === null) return; const s = subs[sel];
    if (s.isMusic) { msg('音乐轨无法阅读', 'err'); return; }
    if (!cache.length) {
      msg('加载...', 'info');
      try {
        let u = s.url; if (u.startsWith('//')) u = 'https:' + u;
        const d = await (await fetch(u)).json();
        cache = d.body || d || [];
        if (!Array.isArray(cache) || !cache.length) { msg('数据异常', 'err'); return; }
      } catch(e) { msg('失败: '+e.message, 'err'); return; }
    }
    Q('#bse-rtitle').textContent = vd.title;
    Q('#bse-rbody').innerHTML = cache.map(i =>
      '<p class="rp"><span class="rt" data-t="'+i.from+'">'+fs(i.from)+'</span>'+esc(i.content)+'</p>'
    ).join('');
    Q('#bse-rbody').querySelectorAll('.rt').forEach(el => {
      el.addEventListener('click', () => {
        const v = document.querySelector('video');
        if (v) v.currentTime = parseFloat(el.dataset.t);
      });
    });
    rd.classList.add('on'); pn.classList.remove('show');
  }

  fb.addEventListener('click', () => { pn.classList.toggle('show'); if (pn.classList.contains('show')) detect(); });
  Q('#bse-close').addEventListener('click', () => pn.classList.remove('show'));
  Q('#bse-rback').addEventListener('click', () => { rd.classList.remove('on'); pn.classList.add('show'); });
  Q('#bse-dl').addEventListener('click', download);
  Q('#bse-read').addEventListener('click', openReader);
  pn.addEventListener('click', (e) => {
    if (e.target.classList.contains('fmt')) {
      pn.querySelectorAll('.fmt').forEach(b => b.classList.remove('on'));
      e.target.classList.add('on'); fmt = e.target.dataset.f;
    }
  });
})();
