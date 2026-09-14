// Development-only: production extension in a disposable browser, synthetic desktop responses.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.test-results');await fs.mkdir(output,{recursive:true});
const extension=path.join(root,'build/manifestv3');
const browser=await puppeteer.launch({headless:true,protocolTimeout:45000,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().endsWith('background-worker.js'),{timeout:15000});
  const worker=await target.worker();
  await worker.evaluate(()=>Zotero.initDeferred.promise);
  await worker.evaluate(()=>{
    globalThis.benchDesktop='legacy';globalThis.benchLocalRequests=[];
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async (url,options)=>{
      if(String(url).startsWith('http://127.0.0.1:23130/')){
        globalThis.benchLocalRequests.push({url:String(url),method:options?.method,body:options?.body});
        if(globalThis.benchDesktop==='offline')throw new TypeError('Synthetic offline desktop');
        return new Response('{}',{status:globalThis.benchDesktop==='legacy'?404:401});
      }
      return originalFetch(url,options);
    };
  });
  await worker.evaluate(async()=>{
    await Zotero.Connector_Browser.onPDFFrame('https://publisher.org/paper.pdf',1,-1);
    await Zotero.Connector_Browser.onPDFFrame('https://publisher.org/paper.pdf',1,2147483647);
  });
  console.log('PASS background PDF frame handler tolerates absent and closed tabs.');
  const settings=await browser.newPage();await settings.setViewport({width:1000,height:800});
  const url=target.url().replace('background-worker.js','preferences/preferences.html');
  for(const [mode,expected] of [['legacy','does not support secure browser connections'],['unpaired','Click Connect'],['offline','Open Abstractus Desktop']]){
    await worker.evaluate(mode=>{globalThis.benchDesktop=mode;},mode);
    await settings.goto(url);
    await settings.waitForFunction(expected=>document.getElementById('abstractus-pair-status')?.textContent.includes(expected),{timeout:10000},expected);
    assert.equal(await worker.evaluate(()=>Zotero.Connector.checkIsOnline()),false);
    if(mode==='legacy')await settings.screenshot({path:path.join(output,'connector-update-required.png')});
    console.log('PASS production settings guidance: '+mode);
  }
  assert((await worker.evaluate(()=>globalThis.benchLocalRequests)).every(r=>r.url.endsWith('/handshake')&&r.method==='GET'&&r.body===undefined));
  console.log('PASS setup diagnostics send no paper data (desktop responses stubbed).');

  await settings.waitForSelector('#content-general.selected');
  await settings.click('#pane-advanced');
  await settings.waitForSelector('#content-advanced.selected');
  assert.equal(await settings.$eval('.diagnostics',element=>element.open),false);
  assert.equal(await settings.$eval('#pane-advanced',element=>element.textContent.includes('Advanced')),false);
  await settings.click('#pane-general');
  await settings.waitForSelector('#content-general.selected');
  await settings.waitForSelector('#abstractus-pair-native');
  assert.equal(await settings.$eval('.connection-backup',element=>element.open),false);
  await settings.waitForFunction(()=>getComputedStyle(document.getElementById('content-general')).opacity==='1');
  await settings.screenshot({path:path.join(output,'connector-general-202.png')});
  const popup=await browser.newPage();await popup.setViewport({width:480,height:560});
  await popup.goto(url.replace('preferences.html','connect.html'));
  await popup.waitForSelector('#abstractus-pair-native');
  await popup.evaluate(()=>{browser.permissions.request=async()=>true;});
  await worker.evaluate(()=>{
    browser.permissions.contains=async()=>true;
    browser.runtime.sendNativeMessage=async()=>({error:'Connection cancelled. Nothing was connected.'});
  });
  await popup.click('#abstractus-pair-native');
  await popup.waitForFunction(()=>document.getElementById('abstractus-pair-status').textContent.includes('cancelled'));
  assert.equal(await popup.$eval('#abstractus-pair-native',element=>element.disabled),false);
  await popup.screenshot({path:path.join(output,'connector-connect-202.png')});
  console.log('PASS shipped connection popup, cancellation recovery, code fallback and collapsed diagnostics (native approval stubbed).');
  const page=await browser.newPage();await page.setViewport({width:960,height:470,deviceScaleFactor:2});
  const names=['Icon-32.png','treeitem-journalArticle.png','treeitem-book.png','treeitem-webpage.png','treeitem-attachment-pdf.png','treesource-collection.png'];
  const labels=['Abstractus','Article','Book','Web page','PDF','Collection'];
  const images=[];
  for(const [i,name] of names.entries()){
    const file=i===0?path.join(root,'icons',name):path.join(root,'src/common/images',name);
    const retina=i===0?path.join(root,'icons/Icon-32.png'):file.replace(/\.png$/, '@2x.png');
    images.push([file,retina].map(async file=>'data:image/png;base64,'+(await fs.readFile(file)).toString('base64')));
    images[i]=await Promise.all(images[i]);
  }
  const rows=[['Light page','#ffffff','#14233b'],['Dark toolbar','#202124','#ffffff'],['Brown toolbar','#49301e','#ffffff']];
  await page.setContent(`<style>body{margin:0;background:#eef1f6;font:14px system-ui;color:#17233a}h2{font-size:19px;margin:18px 22px 8px}.row{margin:12px 20px;padding:18px;border-radius:12px;display:flex;align-items:center;gap:22px}.name{width:125px;font-weight:600}.cell{width:88px;text-align:center}.sample{display:flex;justify-content:center;align-items:center;gap:14px;height:36px}label{display:block;margin-top:9px;font-size:12px}p{margin:14px 22px;font-size:12px;color:#526075}</style><h2>Abstractus · toolbar and capture icons</h2>${rows.map(([name,bg,fg])=>`<div class="row" style="background:${bg};color:${fg}"><div class="name">${name}</div>${images.map((src,i)=>`<div class="cell"><div class="sample"><img src="${src[0]}" width="16" height="16"><img src="${src[1]}" width="32" height="32"></div><label>${labels[i]}</label></div>`).join('')}</div>`).join('')}<p>Shipped assets at 16px and 32px. Orange book on cobalt; item icons have a light backing. Both remain distinct across themes.</p>`);
  await page.screenshot({path:path.join(output,'icon-contrast.png')});
  const brandColors=await page.evaluate(()=>{
    const image=document.images[1], canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
    const context=canvas.getContext('2d');context.drawImage(image,0,0,32,32);
    const rgba=context.getImageData(0,0,32,32).data;let orange=0,cobalt=0;
    for(let p=0;p<rgba.length;p+=4){const [r,g,b,a]=rgba.slice(p,p+4);if(a<240)continue;if(r>180&&g>60&&g<190&&b<80)orange++;if(r<65&&g<85&&b>140)cobalt++;}
    return {orange,cobalt};
  });
  assert(brandColors.orange>40 && brandColors.cobalt>5,JSON.stringify(brandColors));
  console.log('PASS toolbar logo uses the orange book on cobalt.');
  const pixels=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d');
    return Array.from(document.images).filter((_,i)=>i%2===0).slice(0,6).map(img=>{ctx.clearRect(0,0,16,16);ctx.drawImage(img,0,0,16,16);const rgba=ctx.getImageData(0,0,16,16).data;let light=0,dark=0;for(let p=0;p<rgba.length;p+=4){if(rgba[p+3]<240)continue;const mean=(rgba[p]+rgba[p+1]+rgba[p+2])/3;if(mean>235)light++;if(mean<180)dark++;}return {light,dark};});
  });
  assert(pixels.slice(1).every(p=>p.light>25&&p.dark>12),JSON.stringify(pixels));
  console.log('PASS actual 16px item icons retain a light backing and contrasting foreground.');
} finally {await browser.close();}
