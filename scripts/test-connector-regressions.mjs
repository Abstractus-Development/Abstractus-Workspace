// Development-only regression tests. No native process, user profile or network.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {webcrypto,createHmac,createHash} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFile(path.join(root,name),'utf8');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const key='ab'.repeat(32), id='12345678-1234-4234-8234-123456789abc';
const requests=[], errors=[];
let listener, reply='legacy';
const context=vm.createContext({URL,Headers,Response,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,AbortController,crypto:webcrypto,indexedDB:new IDBFactory(),setTimeout,clearTimeout,
  Zotero:{version:'bench',isSafari:false,HTTP:{StatusError:class extends Error{}},Prefs:{get:()=> 'http://127.0.0.1:23130/'},Connector_Browser:{onStateChange:()=>{}},debug:()=>{},logError:e=>errors.push(e)},
  browser:{runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p.replace(/^\//,''),onMessage:{addListener:fn=>{listener=fn;}}}},
  fetch:async (url,options)=>{
    requests.push({url:String(url),options});
    assert(String(url).startsWith('http://127.0.0.1:23130/connector/'));
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    if(reply==='offline')throw new TypeError('Failed to fetch');
    if(reply==='legacy')return new Response('{"error":"Not supported"}',{status:404});
    if(reply==='unpaired')return new Response('{}',{status:401});
    const headers=new Headers(options.headers);
    const body='{}', digest=createHash('sha256').update(body).digest('hex');
    const signature=createHmac('sha256',Buffer.from(key,'hex')).update(['abstractus-response-v1',headers.get('X-Abstractus-Nonce'),'200',digest].join('\n')).digest('hex');
    return new Response(body,{headers:{'X-Abstractus-Proof':reply==='spoof'?'00'.repeat(32):signature,'X-Zotero-Version':'bench','Content-Type':'application/json'}});
  }
});
vm.runInContext(await read('src/common/secure-connector.js'),context);
vm.runInContext(await read('src/common/connector.js'),context);
const transport=context.Zotero.AbstractusTransport, connector=context.Zotero.Connector;
const sender={id:'test-extension',url:'chrome-extension://test-extension/preferences/preferences.html'};
const action=(action,code)=>listener({type:'abstractus-pair',action,code},sender);
await test('Unpaired save is offline and transmits no paper or handshake',async()=>{
  assert.equal(await connector.checkIsOnline(),false);
  await assert.rejects(()=>connector.callMethod('saveItems',{items:[{title:'Never transmit'}]}),e=>e.code==='pairing_required'&&e.status===0);
  assert.equal(requests.length,0);assert.equal(errors.length,0);assert.equal(connector.isOnline,false);
});
await test('Old desktop is diagnosed without trusting it or transmitting metadata',async()=>{
  const state=await action('status');assert.equal(state.state,'desktop_update_required');assert.equal(state.connected,false);
  assert.equal(requests.length,1);assert.equal(requests[0].options.body,undefined);
  assert.equal(new Headers(requests[0].options.headers).get('X-Abstractus-Client'),null);
});
await test('No desktop and unpaired compatible desktop have different guidance',async()=>{
  reply='offline';assert.equal((await action('status')).state,'offline');
  reply='unpaired';assert.equal((await action('status')).state,'pairing_required');
});
await test('A page or another extension cannot install a pairing key',async()=>{
  for(const foreign of [{id:'test-extension',url:'https://publisher.org/'},{id:'foreign',url:sender.url},{id:'test-extension',url:'chrome-extension://test-extension/preferences/preferences.html.evil'}]){
    await assert.rejects(()=>listener({type:'abstractus-pair',action:'connect',code:id+':'+key},foreign));
  }
});
await test('Pairing and actual status require an authenticated desktop response',async()=>{
  reply='legacy';await assert.rejects(()=>action('connect',id+':'+key),e=>e.code==='desktop_update_required');
  reply='spoof';await assert.rejects(()=>action('connect',id+':'+key),e=>e.code==='unverified');
  reply='signed';assert.equal((await action('connect',id+':'+key)).connected,true);
  const state=await action('status');assert.equal(state.connected,true);assert(!JSON.stringify(state).includes(key));
  assert.equal(await connector.checkIsOnline(),true);
});
await test('A stored code is not reported connected when desktop is absent or spoofed',async()=>{
  reply='offline';assert.equal((await action('status')).connected,false);
  reply='spoof';assert.equal((await action('status')).state,'unverified');
  const before=requests.length;
  await assert.rejects(()=>connector.callMethod('saveItems',{items:[{title:'Never transmit'}]}));
  assert.equal(requests.length,before+1);assert(requests.at(-1).url.endsWith('/handshake'));assert.equal(requests.at(-1).options.body,undefined);
});
await test('Disconnect invalidates the stored credential',async()=>{
  await action('disconnect');const before=requests.length;
  await assert.rejects(()=>transport.request('POST','http://127.0.0.1:23130/connector/saveItems',{body:'Never transmit'}));
  assert.equal(requests.length,before);
});
await test('Unexpected errors without HTTP status cannot be mistaken for online',async()=>{
  const original=transport.request;transport.request=async()=>{throw new Error('Synthetic programming fault');};
  try {assert.equal(await connector.checkIsOnline(),false);assert(errors.some(e=>e.message==='Synthetic programming fault'));}
  finally {transport.request=original;}
});

vm.runInContext(await read('src/common/network-policy.js'),context);
await test('Publisher URLs and own packaged resources pass; private, HTTP and foreign extension URLs fail',async()=>{
  const validate=context.Zotero.AbstractusNetwork.validate;
  for(const url of ['https://www.sciencedirect.com/science/article/pii/S1877056826002148','https://pubmed.ncbi.nlm.nih.gov/123/','chrome-extension://test-extension/utilities/resource/dateFormats.json'])assert.equal(validate(url),url);
  // Plain http from a translator (arXiv's OAI endpoint) is upgraded, never sent in the clear
  assert.equal(validate('http://export.arxiv.org/oai2?verb=GetRecord&identifier=oai:arXiv.org:2609.12223'),'https://export.arxiv.org/oai2?verb=GetRecord&identifier=oai:arXiv.org:2609.12223');
  assert.equal(validate('http://publisher.org:80/a'),'https://publisher.org/a');
  for(const url of ['http://publisher.org:8080/','http://127.0.0.1:23130/connector/ping','https://127.0.0.1/','https://2130706433/','https://[::1]/','https://localhost/','https://host.internal/','https://192.168.1.1/','https://publisher.org:8443/','https://user:password@publisher.org/','http://user:password@publisher.org/','chrome-extension://foreign/resource.json'])assert.throws(()=>validate(url));
});

let headerListener;const pending=[],lookups=[],updates=[],tabInfo={};let tabResult={id:7,url:'https://publisher.org/paper.pdf'}, closed=false;
const tabContext=vm.createContext({setTimeout:fn=>{pending.push(fn);},Zotero:{isFirefox:true,Utilities:{},logError:e=>{throw e;},WebRequestIntercept:{addListener:(event,fn)=>{headerListener=fn;}},Connector_Browser:{getTabInfo:()=>tabInfo,_updateExtensionUI:async tab=>updates.push(tab.id)}},browser:{tabs:{get:async id=>{lookups.push(id);if(closed)throw new Error('No tab');return tabResult;}}}});
vm.runInContext(await read('src/browserExt/saveWithoutProgressWindow.js'),tabContext);
const details={tabId:7,type:'main_frame',method:'GET',statusCode:200,url:'https://publisher.org/paper.pdf',responseHeadersObject:{'content-type':'application/pdf'}};
async function event(overrides={}){headerListener({...details,...overrides});while(pending.length)await pending.shift()();}
await test('Requests without a valid tab, redirects and subframes never update the top-level icon',async()=>{
  for(const overrides of [{tabId:-1},{tabId:undefined},{tabId:1.5},{type:'sub_frame'},{type:'xmlhttprequest'},{method:'POST'},{statusCode:302},{statusCode:500}])await event(overrides);
  assert.equal(lookups.length,0);assert.equal(updates.length,0);
});
await test('Closing or navigating a tab during the deferred PDF check is harmless',async()=>{
  closed=true;await event();closed=false;tabResult={id:7,url:'https://publisher.org/another-paper'};await event();assert.equal(updates.length,0);
});
await test('Valid PDF and script-blocking CSP documents still offer background capture',async()=>{
  tabResult={id:7,url:details.url+'#page=2'};await event();assert.equal(tabInfo.isPDF,true);assert.equal(updates.length,1);
  tabContext.Zotero.isFirefox=false;await event({responseHeadersObject:{'content-type':'text/html','content-security-policy':'sandbox'}});
  assert.equal(tabInfo.isPDF,false);assert.equal(tabInfo.uninjectable,true);assert.equal(updates.length,2);
});
await test('Native connection stays restricted to own setup pages and never returns the key to them',async()=>{
  let calls=0;
  context.browser.permissions={contains:async()=>true};
  // Chrome lists a garbled placeholder brand first; the real brand must be the one reported
  context.navigator={userAgentData:{brands:[{brand:'Not;A=Brand',version:'99'},{brand:'Chromium',version:'131'},{brand:'Google Chrome',version:'131'}]},userAgent:'Mozilla/5.0 Chrome/131'};
  const installs=[];
  context.browser.runtime.sendNativeMessage=async(host,message)=>{calls++;assert.equal(host,'ai.abstractus.desktop');assert.deepEqual(Object.keys(message).sort(),['action','browser','install']);assert.equal(message.action,'connect');assert.equal(message.browser,'Google Chrome');assert.match(message.install,/^[a-f0-9]{32}$/);installs.push(message.install);return {code:id+':'+key};};
  for(const foreign of [{id:'test-extension',url:'https://publisher.org/'},{id:'foreign',url:sender.url}])await assert.rejects(()=>listener({type:'abstractus-pair',action:'native'},foreign));
  assert.equal(calls,0);
  reply='signed';
  const result=await listener({type:'abstractus-pair',action:'native'},{id:'test-extension',url:'chrome-extension://test-extension/preferences/connect.html'});
  assert.equal(result.connected,true);assert(!JSON.stringify(result).includes(key));assert.equal(calls,1);
  await action('disconnect');
  // The profile's install ID is stable across connections (it is what lets the desktop replace
  // this profile's pairing instead of adding one), and survives a disconnect
  await listener({type:'abstractus-pair',action:'native'},{id:'test-extension',url:'chrome-extension://test-extension/preferences/connect.html'});
  assert.equal(installs.length,2);assert.equal(installs[0],installs[1]);
  await action('disconnect');
});
await test('Declined native approval and a spoofed desktop never establish a connection',async()=>{
  context.browser.runtime.sendNativeMessage=async()=>({error:'Connection cancelled.'});
  await assert.rejects(()=>action('native'),/cancelled/);
  reply='unpaired';assert.equal((await action('status')).connected,false);
  context.browser.runtime.sendNativeMessage=async()=>({code:id+':'+key});
  reply='spoof';await assert.rejects(()=>action('native'),e=>e.code==='unverified');
  reply='unpaired';assert.equal((await action('status')).connected,false);
});
await test('Native approval is single-flight and requires the optional browser permission',async()=>{
  context.browser.permissions.contains=async()=>false;
  let calls=0;context.browser.runtime.sendNativeMessage=async()=>{calls++;return {code:id+':'+key};};
  await assert.rejects(()=>action('native'),/permission/);assert.equal(calls,0);
  context.browser.permissions.contains=async()=>true;
  let release;context.browser.runtime.sendNativeMessage=()=>new Promise(resolve=>{release=resolve;});
  const pending=action('native');
  while(!release)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(()=>action('native'),/already open/);
  reply='signed';release({code:id+':'+key});assert.equal((await pending).connected,true);
  await action('disconnect');
});
await test('One connection per browser: reconnecting requires a disconnect, which also unpairs on the desktop',async()=>{
  reply='signed';assert.equal((await action('connect',id+':'+key)).connected,true);
  context.browser.runtime.sendNativeMessage=async()=>{throw new Error('must not be called while connected');};
  await assert.rejects(()=>action('native'),/already connected/);
  await assert.rejects(()=>action('connect',id+':'+key),/already connected/);
  const before=requests.length;
  const result=await action('disconnect');
  assert.equal(result.connected,false);assert.match(result.message,/^Browser disconnected\. No papers/);
  const unpair=requests.slice(before).find(r=>r.url.endsWith('/connector/unpair'));
  assert(unpair,'disconnect must tell the desktop');assert.equal(unpair.options.method,'POST');
  assert.equal(new Headers(unpair.options.headers).get('X-Abstractus-Client'),id);
  reply='unpaired';assert.equal((await action('status')).state,'pairing_required');
  // A stored pairing the desktop no longer recognises must not trap the user: Connect replaces it
  reply='signed';await action('connect',id+':'+key);
  reply='unpaired';assert.equal((await action('status')).state,'unverified');
  let nativeCalls=0;context.browser.runtime.sendNativeMessage=async()=>{nativeCalls++;reply='signed';return {code:id+':'+key};};
  const replaced=await action('native');
  assert.equal(replaced.connected,true);assert.equal(nativeCalls,1);
  assert.equal((await action('status')).state,'connected');
  await action('disconnect');
  // Desktop unreachable: the browser still forgets its key, and says the desktop list needs tidying
  reply='signed';await action('connect',id+':'+key);reply='offline';
  assert.match((await action('disconnect')).message,/not reachable/);
  assert.equal((await action('status')).state,'offline');
  for(const brands of [[{brand:'Not/A)Brand'},{brand:'Chromium'},{brand:'Microsoft Edge'}],[{brand:'Not_A Brand'},{brand:'Chromium'},{brand:'Brave'}],[{brand:'Chromium'},{brand:'Not:A-Brand'}]]){
    context.navigator={userAgentData:{brands},userAgent:'Mozilla/5.0 Chrome/131 Safari/537'};
    let sent;context.browser.runtime.sendNativeMessage=async(h,m)=>{sent=m.browser;return {error:'Connection cancelled.'};};
    await assert.rejects(()=>action('native'),/cancelled/);
    assert.equal(sent,brands.length===3?brands[2].brand:'Google Chrome');
  }
});
await test('Maintained proxy engine still rewrites publisher URLs without the Zotero desktop',async()=>{
  const proxyContext=vm.createContext({URL,console,Date,Set,Map,Zotero:{debug:()=>{},Utilities:{quotemeta:s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}}});
  vm.runInContext(await read('src/common/proxy.js'),proxyContext);
  const Z=proxyContext.Zotero;
  const proxy=new Z.Proxy({scheme:'%h.proxy.example.edu/%p',hosts:['www.publisher.org'],dotsToHyphens:true});
  Z.Proxies.proxies=[proxy];Z.Proxies.hosts={'www.publisher.org':proxy};
  assert.equal(Z.Proxies.proxyToProper('https://www-publisher-org.proxy.example.edu/article'), 'https://www.publisher.org/article');
  assert.equal(Z.Proxies.properToProxy('https://www.publisher.org/article'), 'https://www-publisher-org.proxy.example.edu/article');
  assert.equal(Z.Proxies.proxyToProper('https://unrelated.org/paper'),'https://unrelated.org/paper');
});
const result={passed,syntheticOnly:true,nativeTested:false,at:new Date().toISOString()};
await fs.mkdir(path.join(root,'.test-results'),{recursive:true});
await fs.writeFile(path.join(root,'.test-results/connector-regressions.json'),JSON.stringify(result,null,2)+'\n');

await test('Concurrent offscreen startup creates one document and never rejects',async()=>{
  // Worker start: Connector_Browser.init() and content scripts in open tabs all need the
  // offscreen page at once; Chrome allows exactly one createDocument() to succeed.
  let created=0;const clients=[];
  const offscreen=vm.createContext({setTimeout,clearTimeout,setInterval:()=>0,console,OFFSCREEN_BACKGROUND_OVERRIDES:{},
    Zotero:{debug:()=>{},logError:e=>{throw e;},Promise:{defer(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}},
      MessagingGeneric:class{constructor(o){this.o=o;}reinit(o){this.o=o;}addMessageListener(name,fn){if(name==='offscreen-sandbox-initialized')fn();}async sendMessage(){return 'sent';}}},
    browser:{tabs:{onRemoved:{addListener(){}}},offscreen:{
      hasDocument:async()=>created>0,
      createDocument:async()=>{created++;if(created>1)throw new Error('Only a single offscreen document may be created.');await new Promise(r=>setTimeout(r,20));clients.push({url:'chrome-extension://test-extension/offscreen/offscreen.html',postMessage(){}});}}},
    self:{clients:{matchAll:async()=>clients.slice()}}});
  vm.runInContext(await read('src/browserExt/background/offscreenManager.js'),offscreen);
  const manager=offscreen.Zotero.OffscreenManager;
  const port={postMessage(){},onmessage:null};
  const arrivals=[manager.init(),manager.init(),manager.sendMessage('Translate.new',[]),manager.addMessageListener('x',()=>{})];
  await new Promise(r=>setTimeout(r,40));
  offscreen.self.onmessage({data:'offscreen-port',ports:[port]});
  const results=await Promise.all(arrivals);
  assert.equal(created,1);assert.equal(results[2],'sent');
  // Losing the race outright (document created by someone else between check and call) is not an error either
  clients.length=0;created=0;
  offscreen.browser.offscreen.hasDocument=async()=>false;
  offscreen.browser.offscreen.createDocument=async()=>{throw new Error('Only a single offscreen document may be created.');};
  const late=manager.init();
  await new Promise(r=>setTimeout(r,10));
  offscreen.self.onmessage({data:'offscreen-port',ports:[port]});
  await late;
  // A real failure still surfaces
  offscreen.browser.offscreen.createDocument=async()=>{throw new Error('Offscreen API unavailable');};
  await assert.rejects(()=>manager.init(),/unavailable/);
});
await test('Appearance resolves contrast, fixed and system modes and page schemes are measured',async()=>{
  const attrs={};const dom=vm.createContext({location:{search:'?host=dark&mode=contrast'},localStorage:{getItem:()=>null,setItem(){}},
    window:null,document:{documentElement:{setAttribute:(k,v)=>{attrs[k]=v;},getAttribute:k=>attrs[k]}}});
  dom.window=dom;dom.matchMedia=()=>({matches:false,addEventListener(){}});dom.addEventListener=()=>{};dom.URLSearchParams=URLSearchParams;
  vm.runInContext(await read('src/common/theme.js'),dom);
  const t=dom.AbstractusTheme;
  assert.equal(attrs['data-theme'],'light'); // contrast over a dark page
  assert.equal(t.resolve('contrast','light',false),'dark');assert.equal(t.resolve('contrast',null,true),'light');assert.equal(t.resolve('contrast',null,false),'dark');
  assert.equal(t.resolve('dark','light',false),'dark');assert.equal(t.resolve('light','dark',true),'light');
  assert.equal(t.resolve('system',null,true),'dark');assert.equal(t.resolve('system','dark',false),'light');
  assert.throws(()=>t.set('neon'));
  const util=vm.createContext({Zotero:{Prefs:{get:()=>'contrast'}},URLSearchParams});
  vm.runInContext(await read('src/common/utilities.js'),util);
  const scheme=util.Zotero.Utilities.Connector.pageColorScheme, doc=(bodyBg,htmlBg,colorScheme='normal')=>({body:{bg:bodyBg},documentElement:{bg:htmlBg},defaultView:{getComputedStyle:el=>({backgroundColor:el.bg,colorScheme})}});
  assert.equal(scheme(doc('rgb(255, 255, 255)','rgba(0, 0, 0, 0)')),'light');
  assert.equal(scheme(doc('rgb(18, 18, 18)','rgb(255, 255, 255)')),'dark');
  assert.equal(scheme(doc('rgba(0, 0, 0, 0)','rgb(24, 32, 48)')),'dark');
  assert.equal(scheme(doc('rgba(0, 0, 0, 0.2)','rgba(0, 0, 0, 0)','dark')),'dark');
  assert.equal(scheme(doc('rgba(0, 0, 0, 0)','rgba(0, 0, 0, 0)','light dark')),'light');
  assert.equal(scheme(doc('rgba(0, 0, 0, 0)','rgba(0, 0, 0, 0)')),'light');
  assert.equal(scheme({}),'light');
  // The frame must adopt the embedder's used scheme exactly (an opaque canvas otherwise)
  const embed=util.Zotero.Utilities.Connector.embedderColorScheme, page=(colorScheme,prefersDark=false)=>({body:{},documentElement:{},defaultView:{getComputedStyle:()=>({colorScheme}),matchMedia:()=>({matches:prefersDark})}});
  assert.equal(embed(page('normal')),'light');assert.equal(embed(page('light')),'light');assert.equal(embed(page('dark')),'dark');
  assert.equal(embed(page('light dark',true)),'dark');assert.equal(embed(page('light dark',false)),'light');assert.equal(embed(page('only light')),'light');assert.equal(embed({}),'light');
  assert.equal(util.Zotero.Utilities.Connector.themedFrameURL('chrome-extension://x/p.html',doc('rgb(0, 0, 0)','rgb(0, 0, 0)','dark')),'chrome-extension://x/p.html?mode=contrast&host=dark&scheme=dark');
});
await test('Translator repository requests identify as the tracked Zotero Connector release, not the product version',async()=>{
  const config=vm.createContext({});vm.runInContext(await read('src/common/zotero_config.js')+';globalThis.CONFIG=ZOTERO_CONFIG;',config);
  assert.match(config.CONFIG.REPOSITORY_CLIENT_VERSION,/^5\.\d+\.\d+$/);
  const repo=await read('src/common/repo.js');
  assert.equal((repo.match(/version=\$?\{?ZOTERO_CONFIG\.REPOSITORY_CLIENT_VERSION|"metadata\?version=" \+ ZOTERO_CONFIG\.REPOSITORY_CLIENT_VERSION/g)||[]).length,2);
  assert(!/version=\$\{Zotero\.version\}|version=" \+ Zotero\.version/.test(repo),'repo.js must not send the product version');
});
console.log(`${passed} connector regressions passed. No native process or user library used.`);
