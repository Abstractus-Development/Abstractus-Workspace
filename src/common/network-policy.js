Zotero.AbstractusNetwork = {
  callback(args) {
    const [message,payload,tabId,frameId]=args;
    if(!/^RemoteTranslate\.(select|itemSaving|onDebug|onError|translatorFallback)$/.test(message)
      || !Number.isInteger(tabId) || tabId<0 || !Number.isInteger(frameId) || frameId<0
      || !Array.isArray(payload) || JSON.stringify(payload).length>8*1024*1024) {
      throw new Error('Unsupported translator callback');
    }
    return args;
  },
  validate(url) {
    const parsed=new URL(url);
    const host=parsed.hostname.toLowerCase().replace(/\.$/,'');
    const own=new URL(browser.runtime.getURL('/'));
    if(parsed.protocol===own.protocol && parsed.host===own.host && !parsed.username && !parsed.password) return parsed.href;
    if(parsed.protocol==='http:' && (!parsed.port || parsed.port==='80')) { parsed.protocol='https:'; parsed.port=''; }
    if(parsed.protocol!=='https:' || parsed.username || parsed.password || (parsed.port && parsed.port!=='443')
      || !host.includes('.') || /^\[/.test(host) || /^[\d.]+$/.test(host) || parsed.hostname.endsWith('.')
      || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
      throw new Error('Translator requests require a public HTTPS publisher address');
    }
    if(typeof Zotero!=='undefined' && Zotero.SiteBlocklist && Zotero.SiteBlocklist.isBlockedUrl(parsed.href)) {
      throw new Error('Translator requests to this site are blocked');
    }
    return parsed.href;
  },
  siteOf(raw) {
    const labels=new URL(raw).hostname.toLowerCase().replace(/\.$/,'').split('.');
    const shared=labels.length>2 && labels.at(-1).length===2 && /^(ac|co|com|edu|gov|govt|go|gob|gouv|mil|net|ne|nhs|or|org|sch|ltd|plc|me|id|res|nom)$/.test(labels.at(-2));
    return labels.slice(shared?-3:-2).join('.');
  },
  sameSite(a,b) {
    return this.siteOf(a)===this.siteOf(b);
  },
  COOKIE_TRANSLATORS:new Set(['71f28f90-764a-42a8-8107-d87252da9b50','8efcb7cb-4180-4555-969a-08e8b34066c4','a14301dc-be1c-4f34-bcaa-1b53b08ce80d','c82c574d-7fe8-49ca-a360-a05d6e34fec0','e1c104ef-9f4d-44fb-bf84-59b99ead7329','eb876bd2-644c-458e-8d05-bf54b10176f3']),
  scopeDocumentCookie(document,translators) {
    if(!document || !document.cookie || this.COOKIE_TRANSLATORS.has(translators?.[0]?.translatorID)) return document;
    return Object.assign({},document,{cookie:''});
  },
  scopeCredentials(url,options,pageURL) {
    options=Object.assign({},options||{});
    let site=null;
    try { if(pageURL && this.sameSite(url,pageURL)) site=this.siteOf(url); } catch(e) {}
    options.omitCredentials=!site;
    options.credentialSite=site;
    return options;
  },
  checkCredentialedRedirect(options,finalURL) {
    if(options.omitCredentials || !options.credentialSite || !finalURL || this.siteOf(finalURL)===options.credentialSite) return;
    const error=new Error('A request with logins was redirected to another site');
    error.credentialedRedirect=true;
    throw error;
  },
  translatorRequestOptions(url,options) {
    options=Object.assign({},options||{});
    const headers={};
    for(const [name,value] of Object.entries(options.headers||{})) {
      const key=name.toLowerCase();
      if(key==='cookie' || key==='user-agent' || key==='origin' || key==='host' || key.startsWith('sec-') || key.startsWith('proxy-')) continue;
      if(key==='referer') { if(this.referrerAllowed(url,value)) headers[name]=value; continue; }
      headers[name]=value;
    }
    options.headers=headers;
    if(options.referrer && !this.referrerAllowed(url,options.referrer)) delete options.referrer;
    options.publisherOnly=true;
    return options;
  },
  referrerAllowed(url,referrer) {
    try { return typeof referrer==='string' && /^https:/i.test(referrer) && this.sameSite(url,referrer); }
    catch(e) { return false; }
  },
  checkFinalURL(requestedURL,finalURL) {
    if(!finalURL || finalURL===requestedURL) return;
    try { this.validate(finalURL); }
    catch(e) { throw new Error(`Request to ${requestedURL} was redirected to a non-public address`); }
  }
};
