// Browser-only compatibility test. The native API is explicitly stubbed; no library is used.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const extension=path.join(root,'build/manifestv3');
const code=await fs.readFile(path.join(root,'src/zotero/translators/Embedded Metadata.js'),'utf8');
const metadata=JSON.parse(/^\s*{[\S\s]*?}\s*?[\r\n]/.exec(code)[0]);
const browser=await puppeteer.launch({headless:true,protocolTimeout:45000,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().endsWith('background-worker.js'),{timeout:15000});
  const worker=await target.worker();
  await worker.evaluate(()=>Promise.race([Zotero.initDeferred.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Startup timed out')),25000))]));
  await worker.evaluate(async ({metadata,code})=>{
    await Zotero.Translators.init();Zotero.Translators._load([metadata]);
    await Zotero.Prefs.set(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX+metadata.translatorID,code);
    await Zotero.Prefs.set('firstUse',false);
    globalThis.benchSaved=[];
    Zotero.Connector.getPref=async ()=>false;
    Zotero.Connector.checkIsOnline=async ()=>true;
    Zotero.Connector.callMethod=async (method,data)=>{
      const name=typeof method==='string'?method:method.method;
      if(name==='saveItems'){globalThis.benchSaved.push(...data.items);return {items:data.items};}
      if(name==='getSelectedCollection')return {libraryID:1,libraryName:'Synthetic Library',id:'L1',name:'Synthetic Library',filesEditable:false,libraryEditable:true,editable:true,targets:[{id:'L1',name:'Synthetic Library',level:0,filesEditable:false}],tags:{L1:[]}};
      if(['ping','updateSession','sessionProgress'].includes(name))return {done:true,items:[]};
      throw new Error('Unexpected native request in browser-only fixture: '+name);
    };
  },{metadata,code});
  const page=await browser.newPage();await page.setRequestInterception(true);
  page.on('request',r=>r.url().startsWith('https://bench.example.org/')?r.respond({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Synthetic research paper</title><meta name="citation_title" content="Synthetic research paper"><meta name="citation_author" content="Test, Alex"><meta name="citation_journal_title" content="Fixture Journal"><meta name="citation_date" content="2026"><meta name="DC.description" content="An isolated synthetic abstract."></head><body>Synthetic publisher fixture</body></html>'}):r.continue());
  await page.goto('https://bench.example.org/paper');
  const tab=await worker.evaluate(async()=> (await browser.tabs.query({url:'https://bench.example.org/paper'}))[0]);assert(tab);
  const deadline=Date.now()+20000;let detected;
  while(Date.now()<deadline){detected=await worker.evaluate(id=>Boolean(Zotero.Connector_Browser._tabInfo[id]?.translators?.length),tab.id);if(detected)break;await new Promise(r=>setTimeout(r,100));}
  assert(detected,'The actual Embedded Metadata translator must detect the synthetic page');
  await worker.evaluate(tab=>Zotero.Connector_Browser.saveWithTranslator(tab,0),tab);
  const saved=await worker.evaluate(()=>globalThis.benchSaved);
  assert.equal(saved.length,1);assert.equal(saved[0].title,'Synthetic research paper');
  assert(saved[0].creators.some(c=>c.firstName==='Alex'));assert(saved[0].abstractNote.includes('synthetic abstract'));
  console.log('PASS real content-script detection, sandbox translation, callbacks and metadata save (native API stubbed).');

  // The save popup over a light page is dark (contrast) and its frame adopts the page's colour
  // scheme, which is what keeps the iframe canvas transparent instead of a white box.
  const results=path.join(root,'.test-results');await fs.mkdir(results,{recursive:true});
  const popupFrame=async()=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const f=page.frames().find(f=>f.url().includes('progressWindow/progressWindow.html'));if(f){await f.waitForSelector('.ProgressWindow-box',{timeout:10000}).catch(()=>{});return f;}await new Promise(r=>setTimeout(r,100));}throw new Error('Save popup frame not found');};
  let frame=await popupFrame();
  const frameScheme=()=>({theme:document.documentElement.dataset.theme,root:getComputedStyle(document.documentElement).colorScheme,host:new URLSearchParams(location.search).get('host'),scheme:new URLSearchParams(location.search).get('scheme')});
  let scheme=await frame.evaluate(frameScheme);
  assert.deepEqual(scheme,{theme:'dark',root:'light',host:'light',scheme:'light'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).colorScheme),'normal');
  await page.screenshot({path:path.join(results,'popup-on-light-page.png')});
  page.removeAllListeners('request');
  page.on('request',r=>r.url().startsWith('https://bench.example.org/')?r.respond({status:200,contentType:'text/html',body:'<!doctype html><html style="color-scheme:dark"><head><title>Dark synthetic paper</title><meta name="citation_title" content="Dark synthetic paper"><meta name="citation_author" content="Night, Sam"><meta name="citation_date" content="2026"><style>body{background:#111827;color:#e8ecf4;font:16px sans-serif;padding:40px}</style></head><body><h1>Dark publisher fixture</h1><p>Body text on a dark page.</p></body></html>'}):r.continue());
  await page.goto('https://bench.example.org/dark');
  const darkTab=await worker.evaluate(async()=> (await browser.tabs.query({url:'https://bench.example.org/dark'}))[0]);
  const darkDeadline=Date.now()+20000;
  while(Date.now()<darkDeadline){if(await worker.evaluate(id=>Boolean(Zotero.Connector_Browser._tabInfo[id]?.translators?.length),darkTab.id))break;await new Promise(r=>setTimeout(r,100));}
  await worker.evaluate(tab=>Zotero.Connector_Browser.saveWithTranslator(tab,0),darkTab);
  frame=await popupFrame();
  scheme=await frame.evaluate(frameScheme);
  assert.deepEqual(scheme,{theme:'light',root:'dark',host:'dark',scheme:'dark'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).colorScheme),'dark');
  await page.screenshot({path:path.join(results,'popup-on-dark-page.png')});
  console.log('PASS save popup contrasts with light and dark pages and its frame follows the page scheme (no opaque canvas).');
} finally {await browser.close();}
