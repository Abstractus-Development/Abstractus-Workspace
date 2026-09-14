// Development-only DOM/CSP regression using the actual snapshot method and sandbox policy.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.readFile(path.join(root,'src/browserExt/inject/virtualOffscreenTranslate.js'),'utf8');
const sandbox=await fs.readFile(path.join(root,'src/browserExt/offscreen/offscreenSandbox.html'),'utf8');
const policy=/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(sandbox)[1];
const browser=await puppeteer.launch({headless:true});
let passed=0;const check=(condition,label)=>{assert(condition,label);passed++;console.log('PASS',label);};
try {
 const publisher=await browser.newPage();
 await publisher.setContent(`<!doctype html><html lang="en" style="background:white"><head>
 <title>Styled research paper</title><base href="https://publisher.example.org/articles/">
 <link rel="canonical" href="https://publisher.example.org/paper/1">
 <link rel="alternate" type="application/pdf" href="paper.pdf">
 <meta name="citation_title" content="Styled research paper"><meta name="citation_author" content="Test, Alex">
 <meta name="citation_abstract" content="An intact abstract."><meta name="citation_pdf_url" content="paper.pdf">
 <style>.paper { color: rgb(180, 20, 20) }</style>
 <script type="application/ld+json">{"name":"Styled research paper","description":"<style>not CSS: preserve this data</style>"}</script>
 </head><body id="research" data-page="article" style="padding:10px">
 <h1 class="paper" style="font-size:22px">Styled research paper</h1><div class="abstract">An intact abstract.</div>
 <div itemscope itemtype="https://schema.org/ScholarlyArticle"><span itemprop="author">Alex Test</span></div>
 <script>globalThis.publisherExecutions=(globalThis.publisherExecutions||0)+1;</script>
 <publisher-widget data-test="custom"></publisher-widget>
 <template id="card"><style>.card{color:red}</style><div style="color:blue" data-retain="yes">Template data</div></template>
 </body></html>`);
 await publisher.evaluate(()=>{
   globalThis.customConstructions=0;customElements.define('publisher-widget',class extends HTMLElement {constructor(){super();globalThis.customConstructions++;}});
   document.head.appendChild(document.createElement('div')).textContent='Invalid head child';
   globalThis.Zotero={Messaging:{addMessageListener:()=>{}}};
 });
 await publisher.addScriptTag({content:source});
 const snapshot=await publisher.evaluate(async()=>{
   const before=document.documentElement.outerHTML, constructors=globalThis.customConstructions;
   const translate=new Zotero.VirtualOffscreenTranslate();
   translate.sendMessage=async(name,payload)=>({name,payload});
   const result=await translate.setDocument(document);
   return {html:result.payload[0],unchanged:before===document.documentElement.outerHTML,constructorsUnchanged:constructors===globalThis.customConstructions,liveStyles:document.querySelectorAll('style').length,liveColor:getComputedStyle(document.querySelector('h1')).color};
 });
 check(snapshot.unchanged&&snapshot.constructorsUnchanged&&snapshot.liveStyles===1&&snapshot.liveColor==='rgb(180, 20, 20)','Snapshot leaves the live page, styles and custom elements untouched');
 const parser=await browser.newPage(), cdp=await parser.createCDPSession();
 const securityLogs=[];
 cdp.on('Log.entryAdded',({entry})=>{if(entry.source==='security')securityLogs.push(entry.text);});
 await cdp.send('Log.enable');
 await parser.setContent(`<meta http-equiv="Content-Security-Policy" content="${policy}">`);
 // The sandbox policy allows a parsed page's inline styles (they cannot fetch or run anything),
 // so documents fetched by translators no longer log CSP errors in chrome://extensions either.
 // Prove the environment still catches real violations: an external stylesheet must be blocked.
 check(/style-src [^;]*'unsafe-inline'/.test(policy)&&/default-src 'none'/.test(policy),'Sandbox policy allows inline styles only, with default-src none');
 await parser.evaluate(()=>new DOMParser().parseFromString('<style>p{color:red}</style><p style="color:blue">baseline</p>','text/html').body.textContent);
 await parser.evaluate(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href='https://blocked.example.org/probe.css';document.head.appendChild(link);});
 await cdp.send('Runtime.evaluate',{expression:'0'});
 check(!securityLogs.some(t=>t.includes('inline style'))&&securityLogs.some(t=>t.includes('blocked.example.org')),'Inline styles pass while external stylesheets are still blocked by the real sandbox policy');
 securityLogs.length=0;
 const parsed=await parser.evaluate(html=>{
   const doc=new DOMParser().parseFromString(html,'text/html');
   globalThis.benchParsedDocument=doc;
   return {title:doc.title,author:doc.querySelector('[name="citation_author"]').content,abstract:doc.querySelector('[name="citation_abstract"]').content,pdf:doc.querySelector('[rel="alternate"]').href,canonical:doc.querySelector('[rel="canonical"]').href,body:!!doc.querySelector('body#research[data-page="article"]'),json:JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent),microdata:doc.querySelector('[itemprop="author"]').textContent,styles:doc.querySelectorAll('style,[style]').length,templateStyles:doc.querySelector('template').content.querySelectorAll('style,[style]').length,templateData:doc.querySelector('template').content.querySelector('[data-retain="yes"]').textContent,invalidHead:!!doc.head.querySelector('div'),scriptExecuted:globalThis.publisherExecutions!==undefined};
 },snapshot.html);
 await cdp.send('Runtime.evaluate',{expression:'0'});
 check(securityLogs.length===0,'Styled publisher snapshot produces zero CSP violations');
 check(parsed.styles===0&&parsed.templateStyles===0&&!parsed.invalidHead,'Presentation CSS is removed, including nested template content');
 check(parsed.title==='Styled research paper'&&parsed.author==='Test, Alex'&&parsed.abstract==='An intact abstract.'&&parsed.body&&parsed.microdata==='Alex Test','Title, authors, abstract, body structure and microdata survive');
 check(parsed.pdf==='https://publisher.example.org/articles/paper.pdf'&&parsed.canonical==='https://publisher.example.org/paper/1','Relative PDF links, canonical URL and base URL survive');
 check(parsed.json.description==='<style>not CSS: preserve this data</style>'&&parsed.templateData==='Template data'&&!parsed.scriptExecuted,'Embedded JSON and template data survive; publisher scripts do not execute');
 const restrictions=await parser.evaluate(async()=>{
   const results={networkBlocked:false,inlineScriptBlocked:false};
   try{await fetch('https://blocked.example.org/probe');}catch{results.networkBlocked=true;}
   const script=document.createElement('script');script.textContent='globalThis.cspBypassed=true';document.body.appendChild(script);
   results.inlineScriptBlocked=globalThis.cspBypassed!==true;return results;
 });
 check(restrictions.networkBlocked&&restrictions.inlineScriptBlocked,'Sandbox still blocks direct network access and inline scripts');
 await fs.mkdir(path.join(root,'.test-results'),{recursive:true});
 await fs.writeFile(path.join(root,'.test-results/offscreen-styles.json'),JSON.stringify({passed,syntheticOnly:true,policyUnchanged:true,at:new Date().toISOString()},null,2)+'\n');
} finally {await browser.close();}
