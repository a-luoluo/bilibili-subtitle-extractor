const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../sidepanel.js'),'utf8').replace("getCurrentVideo({reason:'init',force:true});",'');
const BV='BV1GJ411x7h7',OTHER='BV1xx411c7mD';
const pageUrl=(bv=BV,p=1)=>`https://www.bilibili.com/video/${bv}/?p=${p}`;
const track=(name='zh')=>({lan:name,lan_doc:name,subtitle_url:`https://aisubtitle.hdslb.com/${name}.json`});
const body=(text='正文')=>({body:[{from:1.2,to:2.5,content:text}]});
const response=json=>({ok:true,status:200,json:async()=>json});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function element(){
  let html='',text='';const classes=new Set();
  return{style:{},dataset:{},disabled:false,attributes:{},listeners:{},
    get innerHTML(){return html;},set innerHTML(v){html=v;text='';},get textContent(){return text;},set textContent(v){text=v;html='';},
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},
    addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(k,v){this.attributes[k]=v;},querySelectorAll(){return[];}};
}
function harness(options={}){
  const elements=new Map(),timers=new Map(),downloads=[],blobs=new Map(),requests=[],scriptCalls=[];
  let timerId=0,blobId=0;
  const active={tab:{id:7,windowId:1,active:true,url:pageUrl()}};
  const getElement=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const events={};const event=name=>({addListener:fn=>{events[name]=fn;}});
  class TestURL extends URL{
    static createObjectURL(blob){const url='blob:test-'+(++blobId);blobs.set(url,blob);return url;}
    static revokeObjectURL(){}
  }
  const context={URL:TestURL,URLSearchParams,AbortController,DOMException,Blob,console,Date,TypeError,
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    document:{getElementById:getElement,querySelectorAll:()=>[]},
    window:{__INITIAL_STATE__:{},__playinfo__:{}},performance:{getEntriesByType:()=>[]},
    fetch:async(url,init)=>{requests.push({url,init});return options.fetch?options.fetch(url,init):response(body());},
    chrome:{tabs:{query:async()=>[active.tab],sendMessage:async()=>({raw:[]}),onActivated:event('activated'),onUpdated:event('updated')},
      scripting:{executeScript:async args=>{scriptCalls.push(args);return[{result:await args.func(...(args.args||[]))}];}},
      downloads:{download:async value=>{downloads.push(value);return downloads.length;}}}};
  vm.createContext(context);vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  const setSelection=(bv=BV,p=1)=>run(`videoData={bvid:${JSON.stringify(bv)},cid:${p===1?111:222},page:${p},title:'测试视频',tabId:7,windowId:1,key:'7:${bv}:${p}',initialSubtitles:[]}; subtitles=[{key:'zh',lang:'中文',url:'https://aisubtitle.hdslb.com/zh.json',isMusic:false},{key:'en',lang:'English',url:'https://aisubtitle.hdslb.com/en.json',isMusic:false}];selectedSub=0;`);
  return{context,run,setSelection,active,elements,getElement,timers,events,downloads,blobs,requests,scriptCalls};
}

// Formatting and external data validation protect all three export paths.
test('round milliseconds once, including second/minute/hour carry',()=>{
  const h=harness();
  assert.equal(h.context.fmt(1.2),'00:00:01,200');
  assert.equal(h.context.fmt(59.9996),'00:01:00,000');
  assert.equal(h.context.fmt(3599.9996),'01:00:00,000');
  assert.match(h.context.toSRT(body().body),/00:00:01,200 --> 00:00:02,500/);
});
test('video parser rejects lookalike hosts, query-only IDs and invalid parts',()=>{
  const h=harness();
  assert.equal(h.context.parseVideoUrl(pageUrl(BV,2)).p,2);
  for(const url of [`https://bilibili.com.evil.test/video/${BV}/`,`https://evil.test/?url=bilibili.com/video/${BV}`,`https://www.bilibili.com/?video=${BV}`,pageUrl(BV,0),pageUrl(BV,'2abc'),`https://a@www.bilibili.com/video/${BV}/`])assert.equal(h.context.parseVideoUrl(url),null,url);
});
test('subtitle URLs only accept HTTPS Bilibili/CDN hosts without credentials',()=>{
  const h=harness();
  assert.equal(h.context.cleanSubtitleUrl('//aisubtitle.hdslb.com/a.json'),'https://aisubtitle.hdslb.com/a.json');
  for(const url of ['javascript:alert(1)','https://hdslb.com.evil.test/a','http://aisubtitle.hdslb.com/a','https://u:p@aisubtitle.hdslb.com/a','https://aisubtitle.hdslb.com:8443/a'])assert.equal(h.context.cleanSubtitleUrl(url),'',url);
});
test('invalid bodies cannot generate corrupt or injectable timestamp exports',()=>{
  const h=harness();
  assert.equal(h.context.validateBody(body()).length,1);
  for(const input of [{},[],{body:[{from:'1',to:2,content:'x'}]},{body:[{from:2,to:1,content:'x'}]},{body:[{from:NaN,to:2,content:'x'}]},{body:[{from:0,to:2,content:{text:'x'}}]}])assert.throws(()=>h.context.validateBody(input));
});
test('language labels and preview subtitle content are escaped',async()=>{
  const h=harness({fetch:async()=>response(body('<img src=x>'))});h.setSelection();
  h.context.render([{...track(),lan_doc:'<img src=x onerror=1>'}]);
  await new Promise(setImmediate);
  assert.match(h.getElement('subList').innerHTML,/&lt;img/);
  assert.doesNotMatch(h.getElement('subList').innerHTML,/<img/);
  assert.match(h.getElement('preview').innerHTML,/&lt;img/);
});

// Detection must match identities before trusting page snapshots or replay URLs.
test('stale initial page state is ignored after switching video/part',async()=>{
  const h=harness({fetch:async()=>response({code:0,data:{subtitle:{subtitles:[track('new')]}}})});
  h.context.window.__INITIAL_STATE__={videoData:{bvid:OTHER,cid:111,subtitle:{subtitles:[track('old')]}}};
  h.context.window.__playinfo__={data:{bvid:OTHER,cid:111,subtitle:{subtitles:[track('old')]}}};
  const result=await h.context.getPlayerSubtitlesFromPage(7,{bvid:BV,cid:222,aid:9});
  assert.equal(result.raw[0].lan,'new');assert.ok(h.requests.length);
});
test('resource replay matches complete CID and BV/AID values',async()=>{
  const valid=`https://api.bilibili.com/x/player/wbi/v2?bvid=${BV}&cid=123&w_rid=valid`;
  const h=harness({fetch:async()=>response({code:0,data:{subtitle:{subtitles:[]}}})});
  h.context.performance.getEntriesByType=()=>[
    `https://api.bilibili.com/x/player/v2?bvid=${BV}&cid=1234`,
    `https://api.bilibili.com/x/player/v2?bvid=${OTHER}&cid=123`,
    `https://evil.test/x/player/v2?bvid=${BV}&cid=123`,valid
  ].map(name=>({name}));
  await h.context.getPlayerSubtitlesFromPage(7,{bvid:BV,cid:123,aid:9});
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].url,valid);
});
test('successful view pages do not depend on failing pagelist',async()=>{
  const h=harness({fetch:async url=>{assert.ok(!url.includes('pagelist'));return response({code:0,data:{bvid:BV,title:'标题',cid:111,pages:[{cid:111,page:1,part:'P1'},{cid:222,page:2,part:'P2'}]}});}});
  const result=await h.context.resolveVideoData(h.active.tab,{bvid:BV,p:2},0);
  assert.equal(result.cid,222);assert.equal(h.requests.length,1);
});
test('unknown part reports an error instead of exporting part one',async()=>{
  const h=harness({fetch:async()=>response({code:0,data:{bvid:BV,cid:111,pages:[{cid:111,page:1}]}})});
  await assert.rejects(h.context.resolveVideoData(h.active.tab,{bvid:BV,p:8},0),/没有第 8 P/);
});
test('missing CID/pages exits loading state with an actionable message',async()=>{
  const h=harness({fetch:async url=>response({code:0,data:url.includes('pagelist')?[]:{pages:[]}})});
  await h.context.getCurrentVideo();
  assert.match(h.getElement('status').textContent,/未获取到视频分P信息/);
  assert.equal(h.getElement('extractBtn').disabled,true);
});
test('login-required player response is reported as login, not no subtitles',async()=>{
  const h=harness({fetch:async url=>response(url.includes('web-interface/view')?
    {code:0,data:{bvid:BV,cid:111,pages:[{cid:111,page:1}],title:'标题'}}:
    {code:0,data:{need_login_subtitle:true,subtitle:{subtitles:[]}}})});
  await h.context.getCurrentVideo();
  assert.match(h.getElement('status').textContent,/需要登录/);
  assert.doesNotMatch(h.getElement('status').textContent,/无字幕/);
});
test('network-only detection failures are not presented as missing subtitles',async()=>{
  const h=harness();
  h.context.resolveVideoData=async(tab,info)=>({...info,cid:111,tabId:tab.id,key:h.context.makeKey(tab,info),initialSubtitles:[]});
  h.context.fetchSubtitlesWithRetry=async()=>({raw:[],needLogin:false,available:false,errors:['network']});
  await h.context.getCurrentVideo();assert.match(h.getElement('status').textContent,/请求失败/);
});
test('a late active-tab query from an older detection cannot replace newer state',async()=>{
  const h=harness(),old=deferred();let calls=0;
  h.context.chrome.tabs.query=()=>++calls===1?old.promise:Promise.resolve([{...h.active.tab,url:'https://example.com'}]);
  const first=h.context.getCurrentVideo();await h.context.getCurrentVideo();
  old.resolve([h.active.tab]);await first;
  assert.match(h.getElement('status').textContent,/请打开/);assert.equal(h.requests.length,0);
});
test('navigation during metadata loading cannot render the previous video',async()=>{
  const h=harness(),pending=deferred();
  h.context.resolveVideoData=()=>pending.promise;
  const first=h.context.getCurrentVideo();await new Promise(setImmediate);
  h.active.tab={...h.active.tab,url:pageUrl(OTHER)};
  h.events.activated({tabId:8,windowId:1});
  pending.resolve({bvid:BV,cid:111,title:'旧视频',key:`7:${BV}:1`,initialSubtitles:[]});await first;
  assert.equal(h.run('videoData'),null);assert.doesNotMatch(h.getElement('videoInfo').innerHTML,/旧视频/);
});

// Deferred responses exercise stale preview/read/download regressions.
test('slower previous-language preview cannot replace the current selection',async()=>{
  const old=deferred(),fresh=deferred();
  const h=harness({fetch:url=>url.includes('/zh.')?old.promise:fresh.promise});h.setSelection();
  const first=h.context.selectIdx(0),second=h.context.selectIdx(1);
  fresh.resolve(response(body('English current')));await second;
  old.resolve(response(body('中文旧结果')));await first;
  assert.match(h.getElement('preview').innerHTML,/English current/);
  assert.doesNotMatch(h.getElement('preview').innerHTML,/中文旧结果/);
  assert.equal(h.run('allBody[0].content'),'English current');
});
test('read uses current language and never reopens stale results',async()=>{
  const old=deferred(),fresh=deferred();
  const h=harness({fetch:url=>url.includes('/zh.')?old.promise:fresh.promise});h.setSelection();
  const first=h.context.read();const preview=h.context.selectIdx(1);const second=h.context.read();
  fresh.resolve(response(body('new language')));await Promise.all([preview,second]);
  old.resolve(response(body('stale language')));await first;
  assert.match(h.getElement('readerContent').innerHTML,/new language/);
  assert.doesNotMatch(h.getElement('readerContent').innerHTML,/stale language/);
});
test('download is cancelled when its video/selection becomes stale',async()=>{
  const pending=deferred();const h=harness({fetch:()=>pending.promise});h.setSelection();
  const download=h.context.download();h.context.scheduleAutoDetect('url-changed');
  h.active.tab={...h.active.tab,url:pageUrl(OTHER)};
  pending.resolve(response(body('old video')));await download;
  assert.equal(h.downloads.length,0);assert.equal(h.run('allBody.length'),0);
});
test('download freezes format/title and emits parseable JSON without BOM',async()=>{
  const pending=deferred();const h=harness({fetch:()=>pending.promise});h.setSelection();
  h.run("selectedFormat='json'");const download=h.context.download();h.run("selectedFormat='srt'");
  pending.resolve(response(body('中文 JSON')));await download;
  assert.equal(h.downloads.length,1);assert.match(h.downloads[0].filename,/测试视频 - zh\.json$/);
  assert.equal('saveAs' in h.downloads[0],false);
  const text=await h.blobs.get(h.downloads[0].url).text();
  assert.equal(JSON.parse(text)[0].content,'中文 JSON');assert.notEqual(text.charCodeAt(0),0xfeff);
});
test('all export formats use one validated body and preserve millisecond values',async()=>{
  const h=harness();h.setSelection();
  for(const format of ['srt','txt','json']){h.run(`selectedFormat='${format}'`);await h.context.download();}
  assert.equal(h.downloads.length,3);assert.equal(h.requests.length,1);
  assert.equal(h.blobs.get(h.downloads[0].url).type,'application/x-subrip;charset=utf-8');
  assert.equal(h.blobs.get(h.downloads[1].url).type,'text/plain;charset=utf-8');
  assert.equal(h.blobs.get(h.downloads[2].url).type,'application/json;charset=utf-8');
  assert.match(await h.blobs.get(h.downloads[0].url).text(),/00:00:01,200 --> 00:00:02,500/);
  assert.match(await h.blobs.get(h.downloads[1].url).text(),/\[00:00:01,200\]/);
});
test('HTTP errors in subtitle body are not exported and can be retried',async()=>{
  let calls=0;const h=harness({fetch:async()=>++calls===1?{ok:false,status:403}:response(body())});h.setSelection();
  await h.context.download();assert.equal(h.downloads.length,0);assert.match(h.getElement('status').textContent,/HTTP 403/);
  await h.context.download();assert.equal(h.downloads.length,1);
});
test('seek targets the original tab and checks video/part inside the page',async()=>{
  const h=harness();h.setSelection();const video={currentTime:0};
  h.context.location={href:pageUrl()};h.context.document.querySelector=()=>video;
  const selection=h.context.getSelection();await h.context.seek(8,selection);
  assert.equal(h.scriptCalls[0].target.tabId,7);assert.equal(video.currentTime,8);
  // Navigation between tabs.query and script execution must still be caught.
  h.context.location.href=pageUrl(BV,2);await h.context.seek(12,selection);assert.equal(video.currentTime,8);
  h.active.tab={id:8,windowId:1,url:pageUrl(OTHER)};await h.context.seek(18,selection);
  assert.equal(h.scriptCalls.length,2);assert.equal(video.currentTime,8);
});
test('tab navigation disables actions immediately before the debounce timer',()=>{
  const h=harness();h.setSelection();h.getElement('extractBtn').disabled=false;h.getElement('readBtn').disabled=false;
  h.events.updated(7,{url:pageUrl(BV,2)},{...h.active.tab,url:pageUrl(BV,2)});
  assert.equal(h.getElement('extractBtn').disabled,true);assert.equal(h.getElement('readBtn').disabled,true);
  assert.equal(h.run('videoData'),null);
});
test('long emoji title and language fit macOS UTF-8 filename limits',async()=>{
  const h=harness();h.setSelection();
  h.run(`videoData.title=${JSON.stringify('🎬'.repeat(100))};subtitles[0].key=${JSON.stringify('字幕😀'.repeat(100))};selectedFormat='json';`);
  await h.context.download();
  const filename=h.downloads[0].filename;
  assert.ok(Buffer.byteLength(filename,'utf8')<=255,filename);
  assert.match(filename,/\.json$/);
  assert.equal(Buffer.from(filename,'utf8').toString('utf8'),filename);
});
test('page-context fallback rejects explicit video identity conflicts but accepts missing IDs',async()=>{
  const conflicts=[{bvid:OTHER},{cid:999},{aid:88}];
  for(const conflict of conflicts){
    const h=harness({fetch:async()=>response({code:0,data:{...conflict,subtitle:{subtitles:[track('wrong')]}}})});
    const result=await h.context.getPlayerSubtitlesFromPage(7,{bvid:BV,cid:111,aid:9});
    assert.equal(result.raw.length,0,JSON.stringify(conflict));
    assert.equal(result.available,false);
    assert.match(result.errors.join(' '),/当前视频不一致/);
  }
  const h=harness({fetch:async()=>response({code:0,data:{subtitle:{subtitles:[track('legacy')]}}})});
  const result=await h.context.getPlayerSubtitlesFromPage(7,{bvid:BV,cid:111,aid:9});
  assert.equal(result.raw[0].lan,'legacy');
});
test('extension API fallback rejects explicit video identity conflicts but accepts missing IDs',async()=>{
  const conflicts=[{bvid:OTHER},{cid:999},{aid:88}];
  for(const conflict of conflicts){
    const h=harness({fetch:async()=>response({code:0,data:{...conflict,subtitle:{subtitles:[track('wrong')]}}})});
    const result=await h.context.fetchApiSubtitleMetadata({bvid:BV,cid:111,aid:9},0,new AbortController().signal);
    assert.equal(result.raw.length,0,JSON.stringify(conflict));
    assert.equal(result.available,false);
    assert.match(result.errors.join(' '),/当前视频不一致/);
  }
  const h=harness({fetch:async()=>response({code:0,data:{subtitle:{subtitles:[track('legacy')]}}})});
  const result=await h.context.fetchApiSubtitleMetadata({bvid:BV,cid:111,aid:9},0,new AbortController().signal);
  assert.equal(result.raw[0].lan,'legacy');
});
test('activating a tab in another window preserves this window reader and selection',()=>{
  const h=harness();h.setSelection();h.getElement('reader').style.display='flex';
  const original=h.context.getSelection();
  h.events.activated({tabId:99,windowId:2});
  assert.equal(h.context.isCurrentSelection(original),true);
  assert.equal(h.getElement('reader').style.display,'flex');
  assert.equal(h.timers.size,0);
});
