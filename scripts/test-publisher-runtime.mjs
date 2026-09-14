// Real pinned ScienceDirect + RIS translators; synthetic publisher and native responses.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const extension=path.join(root,'build/manifestv3');
const expectedVersion=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const translators=await Promise.all(['ScienceDirect','RIS'].map(async name=>{
  const code=await fs.readFile(path.join(root,`src/zotero/translators/${name}.js`),'utf8');
  return {metadata:JSON.parse(/^\s*{[\S\s]*?}\s*?[\r\n]/.exec(code)[0]),code};
}));
const browser=await puppeteer.launch({headless:true,protocolTimeout:45000,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  const cspLogs=[], observers=[], observedTargets=new Set();
  const observe=target=>{
    if (!['page','other'].includes(target.type()) || observedTargets.has(target)) return;
    observedTargets.add(target);
    observers.push((async()=>{
      const session=await target.createCDPSession();
      session.on('Log.entryAdded',({entry})=>{if(entry.source==='security'&&entry.text.includes('inline style'))cspLogs.push(entry.text);});
      await session.send('Log.enable');
    })());
  };
  browser.on('targetcreated',observe);
  browser.on('targetchanged',observe);
  for(const target of browser.targets())observe(target);
  const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().endsWith('background-worker.js'),{timeout:15000});
  const worker=await target.worker();await worker.evaluate(()=>Zotero.initDeferred.promise);
  assert.equal(await worker.evaluate(()=>browser.runtime.getManifest().version),expectedVersion);
  assert.equal(await worker.evaluate(()=>browser.runtime.getManifest().action.default_icon['16']),'Icon-16.png');
  await worker.evaluate(async translators=>{
    await Zotero.Translators.init();Zotero.Translators._load(translators.map(t=>t.metadata));
    for(const {metadata,code} of translators)await Zotero.Prefs.set(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX+metadata.translatorID,code);
    await Zotero.Prefs.set('firstUse',false);
    globalThis.benchSaved=[];globalThis.benchPublisherRequests=[];globalThis.benchToolbarIcons=[];
    const originalSetIcon=browser.action.setIcon.bind(browser.action);
    browser.action.setIcon=details=>{globalThis.benchToolbarIcons.push(details);return originalSetIcon(details);};
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async (url,options)=>{
      if(String(url).startsWith('http://127.0.0.1:23130/'))return new Response('{}',{status:404});
      if(String(url).startsWith('https://www.sciencedirect.com/sdfe/arp/cite?')){
        globalThis.benchPublisherRequests.push(String(url));
        return new Response('TY  - JOUR\nTI  - Synthetic ScienceDirect paper\nAU  - Test, Alex\nAB  - An isolated synthetic publisher abstract.\nPY  - 2026\nJO  - Fixture Journal\nER  -\n',{headers:{'Content-Type':'application/x-research-info-systems'}});
      }
      return originalFetch(url,options);
    };
  },translators);
  const page=await browser.newPage();await page.setViewport({width:1100,height:700});await page.setRequestInterception(true);
  page.on('request',r=>r.url().startsWith('https://www.sciencedirect.com/')?r.respond({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Synthetic ScienceDirect paper</title><meta name="citation_pii" content="BENCH0001"><style>.paper{color:navy}</style></head><body style="padding:12px"><h1 class="paper" style="font-size:24px">Synthetic publisher fixture</h1><div id="export-citation"><button>Export citation</button></div><div class="accessContent">No PDF in this fixture</div></body></html>'}):r.continue());
  await page.goto('https://www.sciencedirect.com/science/article/pii/BENCH0001');
  const tab=await worker.evaluate(async()=> (await browser.tabs.query({url:'https://www.sciencedirect.com/science/article/pii/BENCH0001'}))[0]);assert(tab);
  const deadline=Date.now()+20000;let detected;
  while(Date.now()<deadline){detected=await worker.evaluate(id=>Zotero.Connector_Browser._tabInfo[id]?.translators?.[0]?.label==='ScienceDirect',tab.id);if(detected)break;await new Promise(r=>setTimeout(r,100));}
  assert(detected,'Real ScienceDirect translator must detect the synthetic publisher fixture');
  await worker.evaluate(tab=>Zotero.Connector_Browser._updateExtensionUI(tab),tab);
  const toolbar=await worker.evaluate(id=>globalThis.benchToolbarIcons.filter(icon=>icon.tabId===id).at(-1),tab.id);
  assert.equal(toolbar?.path?.[16],'images/zotero-new-z-16px.png');
  assert.equal(toolbar?.path?.[32],'images/zotero-new-z-16px@2x.png');
  console.log('PASS detected publisher keeps the full-color Abstractus toolbar icon.');
  await worker.evaluate(tab=>{ globalThis.benchBlockedSave=Zotero.Connector_Browser.saveWithTranslator(tab,0); },tab);
  const promptDeadline=Date.now()+10000;let frame;
  while(Date.now()<promptDeadline){frame=page.frames().find(f=>f.url().includes('modalPrompt/modalPrompt.html'));if(frame)break;await new Promise(r=>setTimeout(r,100));}
  assert(frame,'Connection prompt must be shown on the publisher page');
  await frame.waitForFunction(()=>document.body.textContent.includes('Update Abstractus Desktop'),{timeout:10000});
  assert((await frame.evaluate(()=>document.body.textContent)).includes('Reloading the extension alone will not fix this'));
  await page.screenshot({path:path.join(root,'.test-results/publisher-update-required.png')});
  await frame.evaluate(()=>Array.from(document.querySelectorAll('button,input')).find(e=>e.textContent==='Cancel'||e.value==='Cancel').click());
  await worker.evaluate(()=>globalThis.benchBlockedSave);
  assert.equal((await worker.evaluate(()=>globalThis.benchSaved)).length,0);
  assert.equal((await worker.evaluate(()=>globalThis.benchPublisherRequests)).length,0,'No citation request should start while the desktop is incompatible');
  console.log('PASS actual publisher-page prompt explains the old desktop and cancels capture.');
  await worker.evaluate(()=>{
    Zotero.Connector.getPref=async()=>false;
    Zotero.Connector.checkIsOnline=async()=>true;
    Zotero.Connector.callMethod=async (method,data)=>{
      const name=typeof method==='string'?method:method.method;
      if(name==='saveItems'){globalThis.benchSaved.push(...data.items);return {items:data.items};}
      if(name==='getSelectedCollection')return {libraryID:1,libraryName:'Synthetic Library',id:'L1',name:'Synthetic Library',filesEditable:false,libraryEditable:true,editable:true,targets:[{id:'L1',name:'Synthetic Library',level:0,filesEditable:false}],tags:{L1:[]}};
      if(['ping','updateSession','sessionProgress'].includes(name))return {done:true,items:[]};
      throw new Error('Unexpected native request in publisher fixture: '+name);
    };
  });
  await worker.evaluate(tab=>Zotero.Connector_Browser.saveWithTranslator(tab,0),tab);
  const saved=await worker.evaluate(()=>globalThis.benchSaved);
  assert.equal(saved.length,1);assert.equal(saved[0].title,'Synthetic ScienceDirect paper');
  assert(saved[0].creators.some(c=>c.firstName==='Alex'));assert(saved[0].abstractNote.includes('synthetic publisher abstract'));
  const requests=await worker.evaluate(()=>globalThis.benchPublisherRequests);assert.equal(requests.length,1);assert(requests[0].includes('withabstract=true'));
  console.log('PASS real ScienceDirect relative citation fetch, sandboxed RIS import, author/abstract callbacks and save (publisher/native responses stubbed).');
  await Promise.all(observers);
  assert([...observedTargets].some(target=>target.url().includes('/offscreen/')),'The real offscreen page must be observed for CSS-policy errors: '+JSON.stringify(browser.targets().map(target=>({type:target.type(),url:target.url()}))));
  assert.equal(cspLogs.length,0,'Styled publisher capture must not generate inline-style CSP errors');
  console.log(`PASS built ${expectedVersion} captures a styled publisher page without offscreen CSS-policy errors.`);
} finally {await browser.close();}
