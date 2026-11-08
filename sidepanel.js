// Every asynchronous result belongs to one tab, video, part and subtitle selection.
let videoData=null,subtitles=[],selectedSub=null,selectedFormat='srt';
let allPages=[],allBody=[];
let detectSeq=0,selectionSeq=0,autoTimer=null;
let detectController=null,bodyController=null,bodyPromise=null,readerSelection=null;
const MANUAL_DETECT_DELAYS=[0,700,1500,3000];
const REQUEST_TIMEOUT=8000;
const $=id=>document.getElementById(id);
const statusEl=$('status'),videoInfoEl=$('videoInfo');
const subListEl=$('subList'),subCard=$('subCard');
const formatCard=$('formatCard'),extractBtn=$('extractBtn'),readBtn=$('readBtn');
const previewEl=$('preview'),previewLabel=$('previewLabel'),debugEl=$('debug');
const pageCard=$('pageCard'),pageListEl=$('pageList');
const readerEl=$('reader'),readerContent=$('readerContent'),readerBack=$('readerBack');
const mainUI=$('mainUI');

function log(message,seq=detectSeq){
  if(!isCurrentRun(seq))return;
  debugEl.textContent=(debugEl.textContent+'['+new Date().toLocaleTimeString()+'] '+message+'\n').split('\n').slice(-100).join('\n');
  debugEl.classList.add('show');debugEl.scrollTop=debugEl.scrollHeight;
}
function invalidateSelection(){
  selectionSeq++;bodyController?.abort();
  bodyController=null;bodyPromise=null;allBody=[];readerSelection=null;
}
function resetUI(){
  invalidateSelection();videoData=null;subtitles=[];selectedSub=null;allPages=[];
  subCard.style.display='none';subListEl.innerHTML='';formatCard.style.display='none';
  extractBtn.disabled=true;readBtn.disabled=true;
  previewLabel.style.display='none';previewEl.classList.remove('show');previewEl.innerHTML='';
  pageCard.style.display='none';pageListEl.innerHTML='';
  videoInfoEl.textContent='正在检测当前视频…';
  hideStatus();readerEl.style.display='none';mainUI.style.display='block';
}
function parseVideoUrl(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!(url.hostname==='bilibili.com'||url.hostname.endsWith('.bilibili.com'))||url.username||url.password)return null;
    const match=url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})\/?$/);
    if(!match)return null;
    const rawPage=url.searchParams.get('p')||'1';
    if(!/^[1-9]\d*$/.test(rawPage))return null;
    const p=Number(rawPage);
    return Number.isSafeInteger(p)?{bvid:match[1],p}:null;
  }catch{return null;}
}
function makeKey(tab,info){return `${tab?.id??'no-tab'}:${info?.bvid||'no-bv'}:${info?.p||1}`;}
function isCurrentRun(seq){return seq===detectSeq;}
async function getActiveTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab;}
async function isStillSameVideo(seq,key){
  if(!isCurrentRun(seq))return false;
  try{const tab=await getActiveTab();return isCurrentRun(seq)&&makeKey(tab,parseVideoUrl(tab?.url))===key;}
  catch{return false;}
}
function scheduleAutoDetect(reason){
  // Invalidate immediately; old actions must not remain usable during debounce.
  clearTimeout(autoTimer);detectSeq++;detectController?.abort();resetUI();
  autoTimer=setTimeout(()=>getCurrentVideo({reason}),250);
}
function cleanSubtitleUrl(value){
  if(typeof value!=='string'||!value)return '';
  try{
    const url=new URL(value.startsWith('//')?'https:'+value:value),host=url.hostname;
    if(url.protocol!=='https:'||url.username||url.password||url.port)return '';
    if(!(host==='bilibili.com'||host.endsWith('.bilibili.com')||host==='hdslb.com'||host.endsWith('.hdslb.com')))return '';
    return url.href;
  }catch{return '';}
}
function normalizeSubtitles(raw){
  if(!Array.isArray(raw))return [];
  return raw.filter(s=>s&&typeof s==='object').map(s=>({
    ...s,lan:String(s.lan||''),lan_doc:String(s.lan_doc||s.lan||'未知语言'),subtitle_url:cleanSubtitleUrl(s.subtitle_url||s.url)
  })).filter(s=>s.subtitle_url);
}
function abortError(){return new DOMException('操作已取消','AbortError');}
function wait(ms,signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(abortError());return;}
    const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(abortError());};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}
async function fetchJSON(url,{signal,subtitle=false}={}){
  if(signal?.aborted)throw abortError();
  const controller=new AbortController(),cancel=()=>controller.abort();
  signal?.addEventListener('abort',cancel,{once:true});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},REQUEST_TIMEOUT);
  try{
    const response=await fetch(url,{credentials:subtitle?'omit':'include',signal:controller.signal});
    if(!response.ok)throw new Error('请求失败（HTTP '+response.status+'）');
    if(subtitle&&response.url&&!cleanSubtitleUrl(response.url))throw new Error('字幕地址不受支持');
    try{return await response.json();}
    catch(error){if(error.name==='AbortError')throw error;throw new Error('服务器返回的内容不是有效 JSON');}
  }catch(error){
    if(signal?.aborted)throw abortError();
    if(timedOut)throw new Error('请求超时，请检查网络后重试');
    if(error instanceof TypeError)throw new Error('网络连接失败，请检查网络或网站访问权限');
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
function checkApi(json){
  if(!json||typeof json!=='object'||Array.isArray(json))throw new Error('接口响应格式异常');
  if(json.code!==0){
    const error=new Error('B站接口返回 '+String(json.code??'未知状态')+'：'+String(json.message||'请求失败'));
    error.needLogin=json.code===-101;throw error;
  }
  if(!json.data||typeof json.data!=='object')throw new Error('接口未返回有效数据');
  return json.data;
}
function emptyResult(){return{raw:[],source:'',needLogin:false,available:false,errors:[]};}
function mergeResults(a,b){
  return{raw:b.raw.length?b.raw:a.raw,source:b.raw.length?b.source:a.source,
    needLogin:a.needLogin||b.needLogin,available:a.available||b.available,errors:[...a.errors,...b.errors]};
}
async function getPageState(tabId){
  try{
    const [result]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
      const v=window.__INITIAL_STATE__?.videoData||{};
      return{cid:v.cid||0,aid:v.aid||0,bvid:v.bvid||v.bv_id||'',title:v.title||''};
    }});
    return result?.result||{};
  }catch{return {};}
}
async function getPlayerSubtitlesFromPage(tabId,vd,seq=detectSeq){
  const result=emptyResult();
  try{
    const captured=await chrome.tabs.sendMessage(tabId,{action:'bse:getCapturedSubtitles',bvid:vd.bvid,cid:vd.cid});
    result.raw=normalizeSubtitles(captured?.raw);
    if(result.raw.length)return{...result,source:'capture',available:true};
  }catch{/* Already-open pages may not have a content-script bridge yet. */}
  if(!isCurrentRun(seq))return result;
  try{
    const [response]=await chrome.scripting.executeScript({
      target:{tabId},world:'MAIN',args:[vd.bvid,vd.cid,vd.aid,REQUEST_TIMEOUT],
      func:async(bvid,cid,aid,timeout)=>{
        // Runs in the page: do not close over sidebar variables.
        const outcome={raw:[],source:'',needLogin:false,available:false,errors:[]};
        const lists=obj=>[obj?.subtitle?.subtitles,obj?.subtitle?.list,obj?.subtitles];
        const pick=arrays=>arrays.find(a=>Array.isArray(a)&&a.some(s=>s&&(s.subtitle_url||s.url)))||[];
        const matches=record=>record&&(record.bvid||record.bv_id)===bvid&&Number(record.cid)===Number(cid);
        const state=window.__INITIAL_STATE__||{},play=window.__playinfo__||{};
        const currentState=matches(state.videoData),direct=[];
        if(currentState)direct.push(...lists(state.videoData),...lists(state));
        if(matches(play.data)||(currentState&&Number(play.data?.cid)===Number(cid)))direct.push(...lists(play.data));
        if(matches(play))direct.push(...lists(play));
        const raw=pick(direct);
        if(raw.length)return{...outcome,raw,source:'page-state',available:true};
        const urls=performance.getEntriesByType('resource').map(e=>e.name).filter(value=>{
          try{
            const url=new URL(value);
            if(url.protocol!=='https:'||url.hostname!=='api.bilibili.com'||!/^\/x\/player\/(wbi\/)?v2$/.test(url.pathname))return false;
            if(url.searchParams.get('cid')!==String(cid))return false;
            const bv=url.searchParams.get('bvid');
            return bv?bv===bvid:!!aid&&url.searchParams.get('aid')===String(aid);
          }catch{return false;}
        });
        urls.push('https://api.bilibili.com/x/player/v2?bvid='+encodeURIComponent(bvid)+'&cid='+encodeURIComponent(cid));
        for(const url of [...new Set(urls)].slice(-4)){
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
          try{
            const response=await fetch(url,{credentials:'include',signal:controller.signal});
            if(!response.ok)throw new Error('HTTP '+response.status);
            const json=await response.json();
            if(json.code===-101)outcome.needLogin=true;
            if(json.code!==0||!json.data)throw new Error('接口状态 '+String(json.code??'未知'));
            const data=json.data;
            if((data.bvid!=null&&data.bvid!==bvid)||(data.bv_id!=null&&data.bv_id!==bvid)||
              (data.cid!=null&&Number(data.cid)!==Number(cid))||(aid&&data.aid!=null&&Number(data.aid)!==Number(aid)))throw new Error('字幕响应与当前视频不一致');
            outcome.available=true;outcome.needLogin=outcome.needLogin||!!json.data.need_login_subtitle;
            outcome.raw=pick([...lists(json.data),...lists(json.result)]);
            if(outcome.raw.length){outcome.source='page-fetch';return outcome;}
          }catch(error){outcome.errors.push(error.name==='AbortError'?'页面请求超时':error.message);}
          finally{clearTimeout(timer);}
        }
        return outcome;
      }
    });
    const page=response?.result;
    if(page)return{...result,...page,raw:normalizeSubtitles(page.raw)};
  }catch(error){log('页面播放器读取失败：'+error.message,seq);result.errors.push('无法读取页面播放器');}
  return result;
}
function extractSubtitleMetadata(json,source,vd){
  const data=checkApi(json);
  if(source==='web-interface-view'&&Number(data.cid)!==Number(vd.cid))return [];
  if((vd.bvid&&data.bvid!=null&&data.bvid!==vd.bvid)||(vd.bvid&&data.bv_id!=null&&data.bv_id!==vd.bvid)||
    (data.cid!=null&&Number(data.cid)!==Number(vd.cid))||(vd.aid&&data.aid!=null&&Number(data.aid)!==Number(vd.aid)))throw new Error('字幕响应与当前视频不一致');
  return normalizeSubtitles(data.subtitle?.subtitles||data.subtitle?.list||data.subtitles||json.result?.subtitle?.subtitles);
}
async function fetchApiSubtitleMetadata(vd,seq,signal){
  const result=emptyResult(),query='bvid='+encodeURIComponent(vd.bvid)+'&cid='+encodeURIComponent(vd.cid);
  for(const path of ['v2','wbi/v2']){
    if(!isCurrentRun(seq)||signal.aborted)throw abortError();
    try{
      const json=await fetchJSON('https://api.bilibili.com/x/player/'+path+'?'+query,{signal}),data=checkApi(json);
      result.raw=extractSubtitleMetadata(json,'player-'+path,vd);
      result.available=true;result.needLogin=result.needLogin||!!data.need_login_subtitle;
      log('player/'+path+'：'+result.raw.length+' 条字幕轨',seq);
      if(result.raw.length){result.source='player-'+path;return result;}
    }catch(error){
      if(error.name==='AbortError')throw error;
      result.needLogin=result.needLogin||!!error.needLogin;
      result.errors.push(error.message);log('player/'+path+'：'+error.message,seq);
    }
  }
  return result;
}
async function resolveVideoData(tab,info,seq,signal=detectController?.signal){
  let viewData=null,pages=[],errors=[];
  try{
    const json=await fetchJSON('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(info.bvid),{signal});
    viewData=checkApi(json);
    if(viewData.bvid&&viewData.bvid!==info.bvid)throw new Error('视频信息与当前链接不一致');
    pages=Array.isArray(viewData.pages)?viewData.pages:[];
  }catch(error){
    if(error.name==='AbortError')throw error;
    viewData=null;errors.push(error.message);log('视频信息：'+error.message,seq);
  }
  if(!isCurrentRun(seq))return null;
  const validPages=value=>value.filter(p=>Number.isSafeInteger(Number(p?.cid))&&Number(p.cid)>0&&Number.isSafeInteger(Number(p.page))&&Number(p.page)>0);
  pages=validPages(pages);
  // A failed fallback must not invalidate an already successful view response.
  if(!pages.length){
    try{
      const json=await fetchJSON('https://api.bilibili.com/x/player/pagelist?bvid='+encodeURIComponent(info.bvid),{signal});
      const data=checkApi(json);pages=validPages(Array.isArray(data)?data:[]);
    }catch(error){if(error.name==='AbortError')throw error;errors.push(error.message);}
  }
  if(!isCurrentRun(seq))return null;
  if(!pages.length)throw new Error(errors.length?'无法读取视频信息：'+errors[0]:'未获取到视频分P信息，请刷新视频后重试');
  const page=pages.find(p=>Number(p.page)===info.p);
  if(!page)throw new Error('视频没有第 '+info.p+' P，请检查链接');
  const state=await getPageState(tab.id);
  if(!isCurrentRun(seq))return null;
  const cid=Number(page.cid),trustedState=state.bvid===info.bvid&&Number(state.cid)===cid;
  let title=String(viewData?.title||(trustedState&&state.title)||page.part||info.bvid);
  if(pages.length>1&&page.part&&!title.includes(page.part))title+=' - '+page.part;
  allPages=pages;
  const initialSubtitles=viewData?extractSubtitleMetadata({code:0,data:viewData},'web-interface-view',{cid}):[];
  return{bvid:info.bvid,cid,aid:viewData?.aid||(trustedState&&state.aid)||0,title,page:info.p,
    tabId:tab.id,windowId:tab.windowId,key:makeKey(tab,info),initialSubtitles};
}
async function fetchSubtitlesWithRetry(tabId,vd,seq,key,signal){
  let result=emptyResult();
  for(let i=0;i<MANUAL_DETECT_DELAYS.length;i++){
    if(MANUAL_DETECT_DELAYS[i])await wait(MANUAL_DETECT_DELAYS[i],signal);
    if(!await isStillSameVideo(seq,key))return null;
    const page=await getPlayerSubtitlesFromPage(tabId,vd,seq);
    if(!await isStillSameVideo(seq,key))return null;
    result=mergeResults(result,page);
    if(result.raw.length)return result;
    if(vd.initialSubtitles.length)return{...result,raw:vd.initialSubtitles,source:'video-info',available:true};
    const api=await fetchApiSubtitleMetadata(vd,seq,signal);
    if(!await isStillSameVideo(seq,key))return null;
    result=mergeResults(result,api);
    if(result.raw.length||result.needLogin)return result;
  }
  return result;
}
async function getCurrentVideo(options={}){
  clearTimeout(autoTimer);
  const seq=++detectSeq;
  detectController?.abort();detectController=new AbortController();
  const signal=detectController.signal;
  resetUI();debugEl.textContent='';showStatus('正在读取当前视频…','info');
  try{
    const tab=await getActiveTab();
    if(!isCurrentRun(seq))return;
    const info=parseVideoUrl(tab?.url);
    if(!info){videoInfoEl.textContent='尚未选择 B站视频';showStatus('请打开含 BV 号的 B站视频页面','error');return;}
    const key=makeKey(tab,info);
    log(info.bvid+' · P'+info.p+' · '+(options.reason||'manual'),seq);
    const vd=await resolveVideoData(tab,info,seq,signal);
    if(!vd||!await isStillSameVideo(seq,key))return;
    videoData=vd;
    videoInfoEl.innerHTML='<div><span class="val">'+esc(vd.title)+'</span></div><div><span class="label">CID: </span><span class="val">'+vd.cid+'</span></div>';
    const result=await fetchSubtitlesWithRetry(tab.id,vd,seq,key,signal);
    if(!result||!await isStillSameVideo(seq,key))return;
    if(result.raw.length){render(result.raw);return;}
    if(result.needLogin)showStatus('该视频字幕需要登录。请在 B站登录并确认播放器能显示字幕，再点“重新检测”。','error');
    else if(!result.available)showStatus('字幕请求失败，请检查网络或刷新 B站页面后重试。','error');
    else showStatus('未检测到可提取字幕。请确认播放器已提供 CC / AI 字幕，再重新检测。','info');
  }catch(error){
    if(isCurrentRun(seq)&&error.name!=='AbortError'){
      log(error.message,seq);if(!videoData)videoInfoEl.textContent='未能读取视频信息';showStatus(error.message,'error');
    }
  }
}
function render(raw){
  const tracks=normalizeSubtitles(raw).map(s=>{
    const lang=s.lan_doc.substring(0,60),key=s.lan;
    return{lang,key,url:s.subtitle_url,isAI:key.includes('ai')||/自动生成|AI/i.test(lang),isMusic:/音乐|music/i.test(lang)};
  });
  const speech=tracks.filter(s=>!s.isMusic);subtitles=speech.length?speech:tracks;
  if(!subtitles.length){showStatus('未找到有效的字幕地址','error');return;}
  subListEl.innerHTML=subtitles.map((s,i)=>'<button type="button" class="sub-item'+(s.isAI?' ai':'')+(s.isMusic?' music':'')+'" data-idx="'+i+'">'+esc(s.lang)+(s.isAI?'<span class="ai-badge">AI</span>':'')+'</button>').join('');
  subListEl.querySelectorAll('.sub-item').forEach(el=>el.addEventListener('click',()=>selectIdx(Number(el.dataset.idx))));
  subCard.style.display='block';formatCard.style.display='block';hideStatus();
  let idx=subtitles.findIndex(s=>s.key.includes('zh')&&!s.isMusic&&!s.isAI);
  if(idx<0)idx=subtitles.findIndex(s=>s.key.includes('zh')&&!s.isMusic);
  void selectIdx(idx<0?0:idx);
}
function getSelection(){
  if(!videoData||selectedSub===null||!subtitles[selectedSub])return null;
  return{run:detectSeq,selection:selectionSeq,video:videoData,subtitle:subtitles[selectedSub]};
}
function isCurrentSelection(value){
  return !!value&&isCurrentRun(value.run)&&value.selection===selectionSeq&&value.video===videoData&&value.subtitle===subtitles[selectedSub];
}
async function isSelectionVisible(value){return isCurrentSelection(value)&&await isStillSameVideo(value.run,value.video.key)&&isCurrentSelection(value);}
async function selectIdx(idx){
  if(!Number.isInteger(idx)||!subtitles[idx])return;
  invalidateSelection();selectedSub=idx;
  subListEl.querySelectorAll('.sub-item').forEach((el,i)=>{el.classList.toggle('active',i===idx);el.setAttribute('aria-pressed',String(i===idx));});
  readerEl.style.display='none';mainUI.style.display='block';
  extractBtn.disabled=subtitles[idx].isMusic;readBtn.disabled=subtitles[idx].isMusic;
  previewEl.innerHTML='';hideStatus();
  if(subtitles[idx].isMusic){previewLabel.style.display='none';previewEl.classList.remove('show');showStatus('音乐轨没有可导出的文字字幕','info');return;}
  await loadPreview();
}
function validateBody(json){
  const body=Array.isArray(json)?json:json?.body;
  if(!Array.isArray(body))throw new Error('字幕正文格式异常');
  if(!body.length)throw new Error('字幕正文为空');
  if(body.some(item=>!item||typeof item.content!=='string'||typeof item.from!=='number'||typeof item.to!=='number'||!Number.isFinite(item.from)||!Number.isFinite(item.to)||item.from<0||item.to<item.from))throw new Error('字幕包含无效的文字或时间戳');
  return body;
}
async function getSubtitleBody(selection){
  if(!isCurrentSelection(selection))throw abortError();
  if(allBody.length)return allBody;
  if(!bodyPromise){
    bodyController=new AbortController();const signal=bodyController.signal;
    bodyPromise=(async()=>{
      const url=cleanSubtitleUrl(selection.subtitle.url);
      if(!url)throw new Error('字幕地址不受支持');
      const items=validateBody(await fetchJSON(url,{signal,subtitle:true}));
      if(!isCurrentSelection(selection))throw abortError();
      allBody=items;return items;
    })();
  }
  const pending=bodyPromise;
  try{return await pending;}
  catch(error){if(isCurrentSelection(selection)&&bodyPromise===pending)bodyPromise=null;throw error;}
}
async function loadPreview(){
  const selection=getSelection();if(!selection||selection.subtitle.isMusic)return;
  previewLabel.style.display='block';previewEl.textContent='正在加载预览…';previewEl.classList.add('show');
  try{
    const items=await getSubtitleBody(selection);
    if(!await isSelectionVisible(selection))return;
    showFullPreview(items,3);
  }catch(error){if(isCurrentSelection(selection)&&error.name!=='AbortError')previewEl.textContent='加载失败：'+error.message;}
}
async function download(){
  const selection=getSelection(),format=selectedFormat;
  if(!selection||selection.subtitle.isMusic)return;
  extractBtn.disabled=true;showStatus('正在准备下载…','info');let objectUrl='';
  try{
    const items=await getSubtitleBody(selection);
    if(!await isSelectionVisible(selection))return;
    const text=format==='srt'?toSRT(items):format==='txt'?toTXT(items):JSON.stringify(items,null,2);
    const filename=safe(selection.video.title,190)+' - '+safe(selection.subtitle.key||selection.subtitle.lang,40)+'.'+format;
    const mime=format==='json'?'application/json':format==='srt'?'application/x-subrip':'text/plain';
    const blob=new Blob([format==='json'?text:'\uFEFF'+text],{type:mime+';charset=utf-8'});
    objectUrl=URL.createObjectURL(blob);
    await chrome.downloads.download({url:objectUrl,filename});
    const savedUrl=objectUrl;setTimeout(()=>URL.revokeObjectURL(savedUrl),60000);objectUrl='';
    if(isCurrentSelection(selection)){showFullPreview(items,20);showStatus('已开始保存：'+filename+'（'+items.length+' 条）','success');}
  }catch(error){if(isCurrentSelection(selection)&&error.name!=='AbortError')showStatus('未完成保存：'+error.message,'error');}
  finally{if(objectUrl)URL.revokeObjectURL(objectUrl);if(isCurrentSelection(selection))extractBtn.disabled=false;}
}
async function read(){
  const selection=getSelection();if(!selection||selection.subtitle.isMusic)return;
  readBtn.disabled=true;showStatus('正在加载字幕…','info');
  try{
    const items=await getSubtitleBody(selection);
    if(!await isSelectionVisible(selection))return;
    readerSelection=selection;hideStatus();$('readerTitle').textContent=selection.video.title;
    readerContent.innerHTML=items.map(item=>'<p class="read-para"><button type="button" class="read-time" style="border:0;background:none" data-time="'+item.from+'" title="跳转到 '+fmtShort(item.from)+'">'+fmtShort(item.from)+'</button>'+esc(item.content)+'</p>').join('');
    readerContent.querySelectorAll('.read-time').forEach(el=>el.addEventListener('click',()=>seek(Number(el.dataset.time),selection)));
    mainUI.style.display='none';readerEl.style.display='flex';readerEl.style.flexDirection='column';readerContent.scrollTop=0;
  }catch(error){if(isCurrentSelection(selection)&&error.name!=='AbortError')showStatus('加载失败：'+error.message,'error');}
  finally{if(isCurrentSelection(selection))readBtn.disabled=false;}
}
function closeRead(){readerSelection=null;readerEl.style.display='none';mainUI.style.display='block';}
async function seek(time,selection=readerSelection){
  if(!Number.isFinite(time)||time<0||!selection||!await isSelectionVisible(selection))return;
  try{
    const [result]=await chrome.scripting.executeScript({target:{tabId:selection.video.tabId},args:[time,selection.video.bvid,selection.video.page],func:(seconds,bvid,page)=>{
      const url=new URL(location.href),match=url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})\/?$/);
      if(match?.[1]!==bvid||Number(url.searchParams.get('p')||1)!==page)return false;
      const video=document.querySelector('video');if(!video)return false;
      video.currentTime=seconds;return true;
    }});
    if(!result?.result&&isCurrentSelection(selection))showStatus('未找到当前视频播放器，请刷新 B站页面','error');
  }catch(error){if(isCurrentSelection(selection))showStatus('无法跳转：'+error.message,'error');}
}
function toSRT(body){return body.map((item,idx)=>(idx+1)+'\n'+fmt(item.from)+' --> '+fmt(item.to)+'\n'+item.content+'\n').join('\n');}
function toTXT(body){return body.map(item=>'['+fmt(item.from)+'] '+item.content).join('\n');}
function fmt(seconds){
  const total=Math.round(seconds*1000);
  return p2(Math.floor(total/3600000))+':'+p2(Math.floor(total/60000)%60)+':'+p2(Math.floor(total/1000)%60)+','+String(total%1000).padStart(3,'0');
}
function fmtShort(seconds){return p2(Math.floor(seconds/60))+':'+p2(Math.floor(seconds)%60);}
function p2(value){return String(value).padStart(2,'0');}
function safe(value,maxBytes=190){
  const cleaned=String(value||'subtitle').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g,'_');
  let result='',bytes=0;
  // APFS limits a filename to 255 UTF-8 bytes, not 255 JavaScript characters.
  for(const character of cleaned){
    const code=character.codePointAt(0),size=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;
    if(bytes+size>maxBytes)break;
    result+=character;bytes+=size;
  }
  return result.replace(/[.\s]+$/g,'')||'subtitle';
}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showFullPreview(body,limit=3){
  previewEl.innerHTML=body.slice(0,limit).map(item=>'<div class="preview-item"><span class="time">'+fmt(item.from)+'</span><span class="text">'+esc(item.content)+'</span></div>').join('')+'<div style="color:#666;text-align:center;padding:4px">共 '+body.length+' 条</div>';
  previewEl.classList.add('show');
}
function showStatus(message,type='info'){statusEl.textContent=message;statusEl.className='status '+type;}
function hideStatus(){statusEl.className='status';statusEl.textContent='';}
$('refreshBtn').addEventListener('click',()=>getCurrentVideo({reason:'manual'}));
extractBtn.addEventListener('click',download);readBtn.addEventListener('click',read);readerBack.addEventListener('click',closeRead);
document.querySelectorAll('.format-btn').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.format-btn').forEach(other=>other.classList.remove('active'));
  button.classList.add('active');selectedFormat=button.dataset.format;
}));
chrome.tabs.onActivated.addListener(info=>{
  if(videoData&&info.windowId!==videoData.windowId)return;
  scheduleAutoDetect('tab-activated');
});
chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
  if(!tab.active||(videoData&&tab.windowId!==videoData.windowId))return;
  if(changeInfo.url||changeInfo.status==='loading'||changeInfo.status==='complete')scheduleAutoDetect('page-updated');
});
getCurrentVideo({reason:'init',force:true});
