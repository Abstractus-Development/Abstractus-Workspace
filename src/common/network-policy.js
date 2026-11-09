Zotero.AbstractusNetwork = {
  callback(args) {
    const [message,payload,tabId,frameId]=args;
    if(!/^(Translate\.onHandler\.(select|itemSaving|itemDone|attachmentProgress|done|error|pageModified|debug|translators)|MutationObserver\.observe)$/.test(message)
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
  sameSite(a,b) {
    const site=host=>host.toLowerCase().split('.').slice(-2).join('.');
    return site(new URL(a).hostname)===site(new URL(b).hostname);
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
