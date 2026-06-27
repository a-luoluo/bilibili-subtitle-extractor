// ============================================================
// B站字幕提取器 v6.5 - 多源字幕检测 + 稳定重试
// ============================================================

let videoData=null,subtitles=[],selectedSub=null,selectedFormat='srt';
let allPages=[],allBody=[];
let detectSeq=0,autoTimer=null,lastAutoKey='';

const MANUAL_DETECT_DELAYS=[0,700,1500,3000,5000];

const $=id=>document.getElementById(id);
const statusEl=$('status'),videoInfoEl=$('videoInfo');
const subListEl=$('subList'),subCard=$('subCard');
const formatCard=$('formatCard'),extractBtn=$('extractBtn'),readBtn=$('readBtn');
const previewEl=$('preview'),previewLabel=$('previewLabel'),debugEl=$('debug'),pageCard=$('pageCard'),pageListEl=$('pageList');
const readerEl=$('reader'),readerContent=$('readerContent'),readerBack=$('readerBack');
const mainUI=$('mainUI');

function log(msg){debugEl.textContent+='['+new Date().toLocaleTimeString()+'] '+msg+'\n';debugEl.classList.add('show');debugEl.scrollTop=debugEl.scrollHeight;}

function resetUI(){
  videoData=null;subtitles=[];selectedSub=null;allBody=[];
  subCard.style.display='none';subListEl.innerHTML='';formatCard.style.display='none';
  extractBtn.disabled=true;readBtn.disabled=true;
  previewLabel.style.display='none';previewEl.classList.remove('show');previewEl.innerHTML='';
  pageCard.style.display='none';pageListEl.innerHTML='';
  videoInfoEl.innerHTML='<div style="text-align:center;padding:20px;color:#555">检测中...</div>';
  hideStatus();readerEl.style.display='none';mainUI.style.display='block';
}

function parseVideoUrl(url){
  if(!url||!url.includes('bilibili.com'))return null;
  const bv=url.match(/BV[a-zA-Z0-9]+/);
  if(!bv)return null;
  let p=1;
  try{
    const u=new URL(url);
    const n=parseInt(u.searchParams.get('p')||'1',10);
    if(Number.isFinite(n)&&n>0)p=n;
  }catch(e){}
  return{bvid:bv[0],p};
}

function makeKey(tab,info){
  return(tab?.id||'no-tab')+':'+(info?.bvid||'no-bv')+':'+(info?.p||1);
}

function wait(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function cleanSubtitleUrl(url){
  if(!url||typeof url!=='string')return '';
  return url.startsWith('//')?'https:'+url:url;
}

function normalizeSubtitles(raw){
  return Array.isArray(raw)?raw.filter(s=>s&&(s.subtitle_url||s.url)&&(s.lan||s.lan_doc||s.id)).map(s=>({
    ...s,
    subtitle_url:cleanSubtitleUrl(s.subtitle_url||s.url)
  })).filter(s=>s.subtitle_url):[];
}

function sourcePriority(source){
  if(!source)return 0;
  if(source.includes('capture'))return 100;
  if(source.includes('page-state'))return 95;
  if(source.includes('page-fetch'))return 90;
  if(source.includes('player-wbi-v2'))return 88;
  if(source.includes('player-v2'))return 84;
  if(source.includes('dm-view'))return 78;
  if(source.includes('web-interface-view'))return 72;
  return 10;
}

function pickBetterSubtitle(current,next){
  if(!next?.raw?.length)return current;
  if(!current?.raw?.length)return next;
  const a=sourcePriority(current.source),b=sourcePriority(next.source);
  if(b>a)return next;
  if(b===a&&next.raw.length>=current.raw.length)return next;
  return current;
}

function isCurrentRun(seq){
  return seq===detectSeq;
}

async function getActiveTab(){
  const[tab]=await chrome.tabs.query({active:true,currentWindow:true});
  return tab;
}

async function isStillSameVideo(seq,expectedKey){
  if(!isCurrentRun(seq))return false;
  const tab=await getActiveTab();
  const info=parseVideoUrl(tab?.url||'');
  return isCurrentRun(seq)&&makeKey(tab,info)===expectedKey;
}

function scheduleAutoDetect(reason,force){
  clearTimeout(autoTimer);
  autoTimer=setTimeout(()=>getCurrentVideo({reason,force:true}),350);
}

async function getPageState(tabId){
  try{
    const[r]=await chrome.scripting.executeScript({
      target:{tabId},
      world:'MAIN',
      func:()=>{
        const s=window.__INITIAL_STATE__;
        const p=window.__playinfo__;
        const v=s?.videoData||{};
        return{
          cid:p?.data?.cid||v.cid||0,
          aid:v.aid||0,
          bvid:v.bvid||v.bv_id||'',
          title:v.title||'',
          documentTitle:document.title.replace(/_哔哩哔哩_bilibili/i,'').replace(/^[(\s]*/,'').replace(/[)\s]*$/,'').trim()
        };
      }
    });
    return r?.result||{};
  }catch(e){
    return{};
  }
}

async function getPlayerSubtitlesFromPage(tabId,vd){
  try{
    const captured=await chrome.tabs.sendMessage(tabId,{action:'bse:getCapturedSubtitles',bvid:vd.bvid,cid:vd.cid});
    if(captured?.raw?.length)return{raw:normalizeSubtitles(captured.raw),source:'capture-'+(captured.source||'content')};
  }catch(e){}

  try{
    const[r]=await chrome.scripting.executeScript({
      target:{tabId},
      world:'MAIN',
      args:[vd.bvid,vd.cid],
      func:async(bvid,cid)=>{
        const cleanUrl=u=>{
          if(!u||typeof u!=='string')return '';
          return u.startsWith('//')?'https:'+u:u;
        };
        const valid=s=>s&&typeof s==='object'&&(s.subtitle_url||s.url)&&(s.lan||s.lan_doc||s.id);
        const normalize=arr=>Array.isArray(arr)?arr.filter(valid).map(s=>({
          ...s,
          subtitle_url:cleanUrl(s.subtitle_url||s.url)
        })):[];
        const firstValid=(items,source)=>{
          for(const item of items){
            const raw=normalize(item);
            if(raw.length)return{raw,source};
          }
          return null;
        };

        const playinfo=window.__playinfo__||{};
        const state=window.__INITIAL_STATE__||{};
        const direct=firstValid([
          playinfo?.data?.subtitle?.subtitles,
          playinfo?.subtitle?.subtitles,
          playinfo?.data?.subtitles,
          state?.videoData?.subtitle?.subtitles,
          state?.videoData?.subtitle?.list,
          state?.subtitle?.subtitles
        ],'page-state');
        if(direct)return direct;

        const urls=performance.getEntriesByType('resource')
          .map(e=>e.name||'')
          .filter(u=>u.includes('/x/player')&&u.includes('cid='+cid)&&/\/player\/(wbi\/)?v2/.test(u));
        urls.push(
          'https://api.bilibili.com/x/player/v2?bvid='+encodeURIComponent(bvid)+'&cid='+encodeURIComponent(cid),
          'https://api.bilibili.com/x/player/wbi/v2?bvid='+encodeURIComponent(bvid)+'&cid='+encodeURIComponent(cid)
        );

        const seen=new Set();
        for(const url of urls){
          if(!url||seen.has(url))continue;
          seen.add(url);
          try{
            const res=await fetch(url,{credentials:'include'});
            if(!res.ok)continue;
            const json=await res.json();
            const found=firstValid([
              json?.data?.subtitle?.subtitles,
              json?.data?.subtitle?.list,
              json?.data?.subtitles,
              json?.result?.subtitle?.subtitles
            ],'page-fetch');
            if(found)return found;
          }catch(e){}
        }
        return{raw:[],source:'none'};
      }
    });
    return r?.result||{raw:[],source:'none'};
  }catch(e){
    log('页面上下文读取失败: '+e.message);
    return{raw:[],source:'page-error'};
  }
}

async function fetchJSON(url){
  const r=await fetch(url,{headers:{'Referer':'https://www.bilibili.com/'},credentials:'include'});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return await r.json();
}

function extractSubtitleMetadata(json,source,vd){
  if(source==='web-interface-view'){
    const data=json?.data||{};
    const pages=Array.isArray(data.pages)?data.pages:[];
    const isCurrentCid=Number(data.cid)===Number(vd.cid);
    if(pages.length>1&&!isCurrentCid)return{raw:[],source};
    return{raw:normalizeSubtitles(data.subtitle?.list||data.subtitle?.subtitles),source};
  }

  const raw=normalizeSubtitles(
    json?.data?.subtitle?.subtitles||
    json?.data?.subtitle?.list||
    json?.data?.subtitles||
    json?.result?.subtitle?.subtitles
  );
  return{raw,source};
}

async function fetchApiSubtitleMetadata(vd){
  const q=vd.aid?'aid='+encodeURIComponent(vd.aid)+'&cid='+encodeURIComponent(vd.cid):'bvid='+encodeURIComponent(vd.bvid)+'&cid='+encodeURIComponent(vd.cid);
  const dm=vd.aid?'aid='+encodeURIComponent(vd.aid):'bvid='+encodeURIComponent(vd.bvid);
  const sources=[
    ['player-wbi-v2','https://api.bilibili.com/x/player/wbi/v2?'+q],
    ['player-v2','https://api.bilibili.com/x/player/v2?'+q],
    ['dm-view','https://api.bilibili.com/x/v2/dm/view?'+dm+'&oid='+encodeURIComponent(vd.cid)+'&type=1']
  ];
  let best={raw:[],source:''};
  for(const[source,url]of sources){
    try{
      const json=await fetchJSON(url);
      if(json?.data?.need_login_subtitle)log(source+' 提示字幕需要登录态');
      const item=extractSubtitleMetadata(json,source,vd);
      log(source+': '+item.raw.length+'条');
      best=pickBetterSubtitle(best,item);
    }catch(e){
      log(source+' 失败: '+e.message);
    }
  }
  return best;
}

async function resolveVideoData(tab,info,seq){
  let viewData=null,viewSubtitle=[];
  try{
    const view=await fetchJSON('https://api.bilibili.com/x/web-interface/view?bvid='+info.bvid);
    if(view.code===0&&view.data)viewData=view.data;
  }catch(e){
    log('web-interface/view 失败: '+e.message);
  }

  const pl=await fetchJSON('https://api.bilibili.com/x/player/pagelist?bvid='+info.bvid);
  if(!isCurrentRun(seq))return null;
  const viewPages=Array.isArray(viewData?.pages)?viewData.pages:[];
  allPages=viewPages.length?viewPages:(pl.code===0&&Array.isArray(pl.data)?pl.data:[]);
  if(!allPages.length)return null;

  const pageState=await getPageState(tab.id);
  if(!isCurrentRun(seq))return null;

  let page=allPages.find(x=>Number(x.page)===info.p);
  const stateCidInPages=!!pageState.cid&&allPages.some(x=>Number(x.cid)===Number(pageState.cid));
  const stateBvidMatches=!!pageState.bvid&&pageState.bvid===info.bvid;
  const trustPageState=stateBvidMatches||stateCidInPages;
  if(!page&&stateCidInPages){
    page=allPages.find(x=>Number(x.cid)===Number(pageState.cid));
  }
  if(!page)page=allPages[0];

  const cid=Number(page.cid)||0;
  let title=(trustPageState&&pageState.title)||viewData?.title||page.part||pageState.documentTitle||'未知';
  if(allPages.length>1&&page.part&&title&&!title.includes(page.part))title=title+' - '+page.part;
  const aid=viewData?.aid||pageState.aid||0;
  if(viewData){
    const viewItem=extractSubtitleMetadata({data:viewData},'web-interface-view',{cid});
    viewSubtitle=viewItem.raw;
    log('web-interface-view: '+viewSubtitle.length+'条');
  }
  return{bvid:info.bvid,cid,aid,title,page:Number(page.page)||info.p,initialSubtitles:viewSubtitle};
}

async function fetchSubtitlesWithRetry(tabId,vd,seq,expectedKey){
  const delays=MANUAL_DETECT_DELAYS;
  let best={raw:[],source:''};
  for(let i=0;i<delays.length;i++){
    const delay=delays[i];
    if(delay>0){
      log('等待 '+delay+'ms 后重试字幕检测');
      await wait(delay);
    }
    if(!await isStillSameVideo(seq,expectedKey))return null;

    const pageResult=await getPlayerSubtitlesFromPage(tabId,vd);
    if(!isCurrentRun(seq))return null;
    const pageRaw=pageResult.raw||[];
    log('页面播放器尝试 '+(i+1)+'/'+delays.length+': '+pageRaw.length+'条 source='+pageResult.source);
    if(pageRaw.length>0){
      best=pickBetterSubtitle(best,{raw:pageRaw,source:pageResult.source||'page'});
      return pageRaw;
    }

    if(vd.initialSubtitles?.length){
      best=pickBetterSubtitle(best,{raw:vd.initialSubtitles,source:'web-interface-view'});
      log('web-interface-view 缓存: '+vd.initialSubtitles.length+'条');
    }

    const apiResult=await fetchApiSubtitleMetadata(vd);
    if(!isCurrentRun(seq))return null;
    if(apiResult.raw.length>0){
      best=pickBetterSubtitle(best,apiResult);
      return apiResult.raw;
    }
  }
  if(best.raw.length>0)log('检测完成，使用最佳字幕源: '+best.raw.length+'条 source='+best.source);
  return best.raw;
}

async function getCurrentVideo(options){
  const opt=options||{};
  let seq=detectSeq;

  try{
    const tab=await getActiveTab();
    if(!tab?.url?.includes('bilibili.com')){
      seq=++detectSeq;
      resetUI();debugEl.textContent='';
      log('===== '+(Date.now()%10000)+' '+(opt.reason||'manual')+' =====');
      showStatus('请打开B站视频','error');lastAutoKey='';
      return;
    }

    const info=parseVideoUrl(tab.url);
    if(!info){
      seq=++detectSeq;
      resetUI();debugEl.textContent='';
      log('===== '+(Date.now()%10000)+' '+(opt.reason||'manual')+' =====');
      showStatus('URL需含BV号','error');lastAutoKey='';
      return;
    }

    const key=makeKey(tab,info);
    if(!opt.force&&key===lastAutoKey&&videoData?.bvid===info.bvid&&videoData?.page===info.p&&subtitles.length>0){
      log('跳过重复自动检测: '+key);
      return;
    }

    seq=++detectSeq;
    resetUI();debugEl.textContent='';
    log('===== '+(Date.now()%10000)+' '+(opt.reason||'manual')+' =====');
    showStatus('读取中...','info');allPages=[];
    lastAutoKey=key;
    log('BV: '+info.bvid+' P: '+info.p);

    const vd=await resolveVideoData(tab,info,seq);
    if(!isCurrentRun(seq)||!vd)return;
    if(!vd.cid){showStatus('无法获取CID','error');return;}
    log('cid='+vd.cid+' page='+vd.page);

    videoData=vd;
    videoInfoEl.innerHTML='<div><span class="val">'+esc(vd.title)+'</span></div><div><span class="label">CID:</span><span class="val" style="color:#f59e0b">'+vd.cid+'</span></div>';

    const raw=await fetchSubtitlesWithRetry(tab.id,vd,seq,key);
    if(!isCurrentRun(seq)||raw===null)return;
    if(raw.length===0){
      log('最终无字幕: cid='+vd.cid+' 尝试 '+MANUAL_DETECT_DELAYS.length+' 次');
      showStatus('该视频无字幕','error');
    }else{
      render(raw);
    }
  }catch(e){
    if(isCurrentRun(seq)){
      log('异常: '+e.message);
      showStatus('错误: '+e.message,'error');
    }
  }
}

function render(raw){
  const all=raw.map(s=>{const ld=(s.lan_doc||s.lan||'').substring(0,30);const im=ld.includes('音乐')||ld.includes('music');const ia=(s.lan||'').includes('ai')||ld.includes('自动生成')||ld.includes('AI');return{lang:ld,url:s.subtitle_url||'',key:s.lan||'',isAI:ia,isMusic:im};});
  const sp=all.filter(s=>!s.isMusic),mu=all.filter(s=>s.isMusic);
  subtitles=sp.length>0?sp:mu;
  if(subtitles.length===0){showStatus('无可用字幕','error');return;}
  subListEl.innerHTML=subtitles.map((s,i)=>{var c=s.isAI?' ai':'';if(s.isMusic)c+=' music';var b=s.isAI?'<span class="ai-badge">AI</span>':'';if(s.isMusic)b='<span class="music-badge">M</span>';return'<div class="sub-item'+c+'" data-idx="'+i+'">'+s.lang+b+'</div>';}).join('');
  subListEl.querySelectorAll('.sub-item').forEach(el=>el.addEventListener('click',()=>selectIdx(parseInt(el.dataset.idx))));
  subCard.style.display='block';formatCard.style.display='block';
  var idx=subtitles.findIndex(s=>s.isAI&&!s.isMusic&&s.key.includes('zh'));if(idx<0)idx=subtitles.findIndex(s=>!s.isMusic&&s.key.includes('zh'));if(idx<0)idx=0;
  selectIdx(idx);
  hideStatus();
}

async function selectIdx(idx){
  selectedSub=idx;allBody=[];
  subListEl.querySelectorAll('.sub-item').forEach((e,i)=>e.classList.toggle('active',i===idx));
  extractBtn.disabled=false;readBtn.disabled=false;
  await loadPreview();
}

async function loadPreview(){
  if(selectedSub===null)return;
  const s=subtitles[selectedSub];
  if(s.isMusic)return;
  previewLabel.style.display='block';
  previewEl.innerHTML='<div style="text-align:center;color:#555;padding:10px">加载预览...</div>';
  previewEl.classList.add('show');
  try{
    let u=s.url;if(u.startsWith('//'))u='https:'+u;
    const d=await(await fetch(u,{headers:{'Referer':'https://www.bilibili.com/'}})).json();
    const items=d.body||d||[];
    if(!Array.isArray(items)||!items.length){previewEl.innerHTML='<div style="text-align:center;color:#fca5a5;padding:10px">数据异常</div>';return;}
    const pre=items.slice(0,3);
    previewEl.innerHTML=pre.map(i=>'<div class="preview-item"><span class="time">'+fmt(i.from)+'</span><span class="text">'+esc(i.content)+'</span></div>').join('');
    previewEl.innerHTML+='<div style="color:#666;font-size:10px;text-align:center;padding:4px">... 共 '+items.length+' 条</div>';
  }catch(e){previewEl.innerHTML='<div style="text-align:center;color:#fca5a5;padding:10px">加载失败</div>';}
}

async function download(){
  if(selectedSub===null)return;const s=subtitles[selectedSub];
  if(s.isMusic){showStatus('音乐轨无文字','error');return;}
  showStatus('下载中...','info');
  try{let u=s.url;if(u.startsWith('//'))u='https:'+u;const d=await(await fetch(u,{headers:{'Referer':'https://www.bilibili.com/'}})).json();const items=d.body||d||[];if(!Array.isArray(items)||!items.length){showStatus('数据异常','error');return;}let c,fn;if(selectedFormat==='srt'){c=toSRT(items);fn=safe(videoData.title)+'.srt';}else if(selectedFormat==='txt'){c=toTXT(items);fn=safe(videoData.title)+'.txt';}else{c=JSON.stringify(items,null,2);fn=safe(videoData.title)+'.json';}showFullPreview(items);const b=new Blob(['\uFEFF'+c],{type:'text/plain;charset=utf-8'});const ur=URL.createObjectURL(b);const a=document.createElement('a');a.href=ur;a.download=fn;a.click();URL.revokeObjectURL(ur);showStatus('OK: '+fn+' ('+items.length+'条)',"success");}catch(e){showStatus('失败: '+e.message,'error');}
}

async function read(){
  if(selectedSub===null)return;const s=subtitles[selectedSub];
  if(s.isMusic){showStatus('音乐轨无法阅读','error');return;}
  if(!allBody.length){showStatus('加载中...','info');try{let u=s.url;if(u.startsWith('//'))u='https:'+u;const d=await(await fetch(u,{headers:{'Referer':'https://www.bilibili.com/'}})).json();allBody=d.body||d||[];if(!Array.isArray(allBody)||!allBody.length){showStatus('数据异常','error');return;}hideStatus();}catch(e){showStatus('失败: '+e.message,'error');return;}}
  document.getElementById('readerTitle').textContent=videoData.title;
  readerContent.innerHTML=allBody.map(i=>'<p class="read-para"><span class="read-time" data-time="'+i.from+'" title="跳转">'+fmtShort(i.from)+'</span>'+esc(i.content)+'</p>').join('');
  readerContent.querySelectorAll('.read-time').forEach(el=>el.addEventListener('click',()=>seek(parseFloat(el.dataset.time))));
  mainUI.style.display='none';readerEl.style.display='flex';readerEl.style.flexDirection='column';readerContent.scrollTop=0;
}
function closeRead(){readerEl.style.display='none';mainUI.style.display='block';}

async function seek(t){const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)return;try{await chrome.tabs.sendMessage(tab.id,{action:'seek',time:t});}catch(e){try{await chrome.scripting.executeScript({target:{tabId:tab.id},func:(x)=>{const v=document.querySelector('video');if(v)v.currentTime=x;},args:[t]});}catch(e2){}}}

function toSRT(b){return b.map((i,idx)=>(idx+1)+'\n'+fmt(i.from)+' --> '+fmt(i.to)+'\n'+i.content+'\n').join('\n');}
function toTXT(b){return b.map(i=>'['+fmt(i.from)+'] '+i.content).join('\n');}
function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*1000);return p2(h)+':'+p2(m)+':'+p2(sec)+','+p3(ms);}
function fmtShort(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return p2(m)+':'+p2(sec);}
function p2(n){return String(n).padStart(2,'0');}function p3(n){return String(n).padStart(3,'0');}
function safe(s){return(s||'subtitle').replace(/[\\/:*?"<>|]/g,'_').substring(0,80);}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function showFullPreview(b){const p=b.slice(0,20);previewEl.innerHTML=p.map(i=>'<div class="preview-item"><span class="time">'+fmt(i.from)+'</span><span class="text">'+esc(i.content)+'</span></div>').join('');if(b.length>20)previewEl.innerHTML+='<div style="color:#666;padding:8px;text-align:center">... '+b.length+'条 ...</div>';previewEl.classList.add('show');}
function showStatus(m,t){statusEl.textContent=m;statusEl.className='status '+(t||'info');}
function hideStatus(){statusEl.className='status';statusEl.textContent='';}

$('refreshBtn').addEventListener('click',()=>getCurrentVideo({reason:'manual',force:true}));
extractBtn.addEventListener('click',download);
readBtn.addEventListener('click',read);
readerBack.addEventListener('click',closeRead);
document.querySelectorAll('.format-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.format-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedFormat=b.dataset.format;}));

chrome.tabs.onActivated.addListener(()=>scheduleAutoDetect('tab-activated',false));
chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
  if(!tab.active)return;
  if(changeInfo.url||changeInfo.status==='complete')scheduleAutoDetect(changeInfo.url?'url-changed':'page-complete',false);
});

getCurrentVideo({reason:'init',force:true});
