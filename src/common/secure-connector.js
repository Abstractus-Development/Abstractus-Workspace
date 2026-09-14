// Abstractus paired transport. Loaded in the extension background only.
// Pairing keys deliberately bypass Zotero.Prefs and its content-script RPC surface.
(() => {
  const encoder = new TextEncoder();
  const messages = {
    pairing_required: 'Click Connect to Abstractus Desktop in Connector Settings, or use a connection code from Library → Browser connections.',
    desktop_update_required: 'The app on the desktop port does not support secure browser connections. Open an updated Abstractus Desktop before connecting.',
    offline: 'Open Abstractus Desktop, then try again.',
    unverified: 'Desktop could not be verified. Check that Abstractus Desktop is running, then reconnect this browser in Connector Settings.',
    connected: 'Connected securely to Abstractus Desktop.'
  };
  function connectionError(code) {
    const error = new Error(messages[code]);
    error.name = 'AbstractusConnectionError'; error.status = 0; error.code = code;
    return error;
  }
  // Diagnostics only: an unsigned reply never establishes trust or receives paper data.
  async function diagnose() {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 2500);
    try {
      const response = await fetch('http://127.0.0.1:23130/connector/handshake', {
        method: 'GET', headers: {'X-Zotero-Connector-API-Version': '3'},
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal
      });
      await response.body?.cancel();
      return response.status === 404 ? 'desktop_update_required' : 'pairing_required';
    } catch { return 'offline'; }
    finally { clearTimeout(timer); }
  }
  const hex = bytes => Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
  const unhex = text => Uint8Array.from(text.match(/../g), v=>parseInt(v,16));
  const digest = async bytes => hex(await crypto.subtle.digest('SHA-256',bytes));
  const nonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));
  const parse = code => {
    if (!/^[a-f0-9-]{36}:[a-f0-9]{64}$/.test(code)) throw new Error('Paste the complete connection code from Abstractus Library.');
    const [id,key]=code.split(':'); return {id,key};
  };
  async function store(value, remove=false, name='key') {
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('abstractus-browser-connection',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('connection');
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(new Error('Cannot open browser connection storage'+(request.error?.message?` (${request.error.message})`:'')));
      request.onblocked=()=>reject(new Error('Browser connection storage is busy; close other Connector settings pages and retry'));
    });
    try { return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('connection',value!==undefined || remove ? 'readwrite':'readonly');
      const object=transaction.objectStore('connection');
      const request=remove?object.delete(name):value!==undefined?object.put(value,name):object.get(name);
      let result; request.onsuccess=()=>{result=request.result;};
      transaction.oncomplete=()=>resolve(result); transaction.onerror=()=>reject(new Error('Cannot save browser connection'));
    }); } finally { db.close(); }
  }
  // Identifies this browser profile to the desktop (each profile has its own extension storage),
  // so reconnecting replaces this profile's pairing and never another profile's. Random, kept
  // for the life of the install; a reinstall is a new profile as far as the desktop knows.
  async function installId() {
    let id=await store(undefined,false,'install');
    if(!/^[a-f0-9]{32}$/.test(id||'')){ id=nonce(); await store(id,false,'install'); }
    return id;
  }
  async function bytes(body) {
    if(body==null)return new Uint8Array();
    if(typeof body==='string')return encoder.encode(body);
    if(body instanceof Blob)return new Uint8Array(await body.arrayBuffer());
    if(body instanceof ArrayBuffer)return new Uint8Array(body);
    if(ArrayBuffer.isView(body))return new Uint8Array(body.buffer,body.byteOffset,body.byteLength);
    throw new Error('Unsupported connector body');
  }
  async function signature(key,text) {
    const cryptoKey=await crypto.subtle.importKey('raw',unhex(key),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
    return {cryptoKey, value:hex(await crypto.subtle.sign('HMAC',cryptoKey,encoder.encode(text)))};
  }
  function target(uri) {
    const url=new URL(uri);
    if(url.origin!=='http://127.0.0.1:23130' || url.username || url.password || url.hash || !url.pathname.startsWith('/connector/')) throw new Error('Invalid desktop connection address');
    return url;
  }
  async function signed(pair,method,uri,options) {
    const url=target(uri), n=nonce(), time=String(Math.floor(Date.now()/1000));
    const body=await bytes(options.body), bodyHash=await digest(body);
    const headers=new Headers(options.headers);
    headers.set('X-Zotero-Connector-API-Version','3');
    const canonical=['abstractus-request-v1',pair.id,time,n,method,url.pathname+url.search,bodyHash,headers.get('Content-Type')||'',headers.get('X-Metadata')||''].join('\n');
    const proof=await signature(pair.key,canonical);
    for(const [key,value] of Object.entries({'X-Abstractus-Client':pair.id,'X-Abstractus-Time':time,'X-Abstractus-Nonce':n,'X-Abstractus-Body':bodyHash,'X-Abstractus-Signature':proof.value})) headers.set(key,value);
    const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),Math.min(options.timeout||20000,60000));
    let response, raw;
    try {
      response=await fetch(url.href,{method,headers,body:method==='GET'?undefined:body,credentials:'omit',redirect:'error',cache:'no-store',signal:abort.signal});
      // Connector replies are small; bound a spoofed server's response before allocating it.
      const reader=response.body?.getReader(); const chunks=[]; let length=0;
      if(reader)while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4*1024*1024){await reader.cancel();throw new Error('Desktop response too large');}chunks.push(value);}
      raw=new Uint8Array(length);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
    } catch { throw connectionError('offline'); } finally {clearTimeout(timer);}
    const serverProof=response.headers.get('X-Abstractus-Proof');
    const valid=serverProof && /^[a-f0-9]{64}$/.test(serverProof) && await crypto.subtle.verify('HMAC',proof.cryptoKey,unhex(serverProof),encoder.encode(['abstractus-response-v1',n,String(response.status),await digest(raw)].join('\n')));
    if(!valid)throw connectionError(response.status === 404 && url.pathname === '/connector/handshake' ? 'desktop_update_required' : 'unverified');
    const text=new TextDecoder().decode(raw);
    return {status:response.status,response:text,responseText:text,getResponseHeader:name=>response.headers.get(name)};
  }
  async function handshake(pair) {
    const response=await signed(pair,'GET','http://127.0.0.1:23130/connector/handshake',{headers:{},body:null});
    if(response.status!==200)throw connectionError('unverified');
  }
  async function getConnectionState() {
    const pair = await store();
    let state;
    if (!pair) state = await diagnose();
    else {
      try { await handshake(pair); state = 'connected'; }
      catch (error) {
        if (error.name !== 'AbstractusConnectionError') throw error;
        state = error.code;
      }
    }
    return {connected: state === 'connected', state, message: messages[state]};
  }
  Zotero.AbstractusTransport={
    getConnectionState,
    async request(method,uri,options) {
      target(uri);
      const pair=await store(); if(!pair)throw connectionError('pairing_required');
      await handshake(pair); // Prove server identity before transmitting paper metadata or bytes.
      return signed(pair,method,uri,options);
    }
  };
  // Human-readable browser brand for the desktop's connection list ("Google Chrome",
  // "Microsoft Edge", "Brave", "Firefox"). Never the full user agent.
  function browserBrand() {
    if(typeof navigator==='undefined')return 'Browser';
    // userAgentData lists the real brand next to "Chromium" and a deliberately garbled
    // "Not;A=Brand"-style entry; take a known brand first, then anything that is neither.
    const brands=(navigator.userAgentData?.brands||[]).map(b=>String(b.brand||''));
    const known=brands.find(b=>/^(Google Chrome|Microsoft Edge|Brave|Opera|Vivaldi|Arc|Samsung Internet)$/i.test(b));
    let brand=known||brands.find(b=>!/chromium/i.test(b) && !/not.*brand/i.test(b))||'';
    if(!brand){const ua=navigator.userAgent||'';brand=/Firefox\//.test(ua)?'Firefox':/Edg\//.test(ua)?'Microsoft Edge':/OPR\//.test(ua)?'Opera':/Chrome\//.test(ua)?'Google Chrome':/Safari\//.test(ua)?'Safari':'Browser';}
    return brand.replace(/[^A-Za-z0-9 .()-]/g,'').trim().slice(0,32)||'Browser';
  }
  // Disconnect on the desktop too, so the pairing does not linger in its list. Best effort:
  // an unreachable desktop still lets the browser forget its key.
  async function unpair(pair) {
    try { await signed(pair,'POST','http://127.0.0.1:23130/connector/unpair',{headers:{'Content-Type':'application/json'},body:'{}'}); return true; }
    catch { return false; }
  }
  let nativePending=false;
  browser.runtime.onMessage.addListener((request,sender)=>{
    if(request?.type!=='abstractus-pair')return;
    if(sender.id!==browser.runtime.id || !['preferences/preferences.html','preferences/connect.html'].some(path=>sender.url?.split(/[?#]/)[0]===browser.runtime.getURL(path)))return Promise.reject(new Error('Only Connector Settings can change browser pairing'));
    return (async()=>{
      if(request.action==='disconnect'){
        const pair=await store();
        const desktopUpdated=pair?await unpair(pair):true;
        await store(undefined,true);
        return {connected:false, state:'pairing_required', message:desktopUpdated
          ?'Browser disconnected. No papers can be saved until you reconnect.'
          :'Browser disconnected. Abstractus Desktop was not reachable, so remove this browser in Library → Browser connections as well.'};
      }
      // One connection per browser: while the stored pairing still verifies, reconnecting means
      // disconnecting first (which also removes it on the desktop). A stored pairing the desktop
      // no longer recognises (removed there, or the desktop was reset) is dead weight: replace it.
      if(request.action==='native' || request.action==='connect'){
        const existing=await store();
        if(existing){
          let verified=false;
          try { await handshake(existing); verified=true; } catch {}
          if(verified)throw new Error('This browser is already connected. Disconnect it first to connect again.');
          await unpair(existing); await store(undefined,true);
        }
      }
      if(request.action==='native'){
        if(nativePending)throw new Error('A connection approval is already open. Check Abstractus Desktop.');
        nativePending=true;
        try {
          if(!await browser.permissions.contains({permissions:['nativeMessaging']}))throw new Error('Allow the browser connection permission, or use a code.');
          let reply;
          try {reply=await browser.runtime.sendNativeMessage('ai.abstractus.desktop',{action:'connect',browser:browserBrand(),install:await installId()});}
          catch(e) {
            // Surface Chrome's own reason (host not found / forbidden / exited) so setup problems are diagnosable
            const reason=String(e?.message||e||'').replace(/\s+/g,' ').slice(0,200);
            throw new Error(`Click-to-connect is not available${reason?` (${reason})`:''}. Open an updated Abstractus Desktop, or use a connection code below.`);
          }
          if(reply?.error)throw new Error(String(reply.error).slice(0,300));
          const pair=parse(String(reply?.code||''));
          await handshake(pair);await store(pair);
          return {connected:true,message:messages.connected};
        } finally {nativePending=false;}
      }
      if(request.action==='connect'){const pair=parse(String(request.code||'').trim());await handshake(pair);await store(pair);return {connected:true};}
      return getConnectionState();
    })();
  });
})();
