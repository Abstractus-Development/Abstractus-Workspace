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
} finally {await browser.close();}
