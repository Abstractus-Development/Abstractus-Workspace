(function() {

"use strict";

const OPENATHENS_REDIRECT_INTERVAL = 12 * 60 * 60 * 1000;

Zotero.Proxies = new function() {
	this.REDIRECT_LOOP_TIMEOUT = 3600e3;
	this.REDIRECT_LOOP_MONITOR_COUNT = 4;
	this.REDIRECT_LOOP_MONITOR_TIMEOUT = 5e3;
	this.openAthensHostRedirectTime = {};
	this.init = async function() {
		this.transparent = false;
		this.proxies = [];
		this.hosts = {};
		this._redirectedTabIDs = {};
		this._loopPreventionTimestamp = Zotero.Prefs.get('proxies.loopPreventionTimestamp');

		this.openAthensHostRedirectTime =
			await Zotero.Utilities.Connector.createMV3PersistentObject('openAthensRedirectTime');
		
		this.loadPrefs();
		
		Zotero.Proxies.lastIPCheck = 0;
		Zotero.Proxies.disabledByDomain = false;
		
		Zotero.Proxies.proxies = Zotero.Prefs.get('proxies.proxies').map(function(proxy) {
			proxy = Zotero.Proxies._createProxyInstance(proxy);
			for (let host of proxy.hosts) {
				Zotero.Proxies.hosts[host] = proxy;
			}
			return proxy;
		});
	};
	
	this.loadPrefs = function() {
		Zotero.Proxies.transparent = Zotero.Prefs.get("proxies.transparent");
		Zotero.Proxies.autoRecognize = Zotero.Proxies.transparent && Zotero.Prefs.get("proxies.autoRecognize");
		
		var disableByDomainPref = Zotero.Prefs.get("proxies.disableByDomain");
		Zotero.Proxies.disableByDomain = (Zotero.Proxies.transparent && disableByDomainPref ? Zotero.Prefs.get("proxies.disableByDomainString") : null);
		Zotero.Proxies.showRedirectNotification = Zotero.Prefs.get("proxies.showRedirectNotification");	
		
		if (this.transparent) {
			this.enable();
			this.updateDisabledByDomain();
		} else {
			this.disable();
		}
	};
	
	this.enable = function() {
		Zotero.WebRequestIntercept.addListener('headersReceived', Zotero.Proxies.onHeadersReceived);
		browser.webNavigation.onCommitted.addListener(Zotero.Proxies.onNavigationCommitted)
	};


	this.disable = function() {
		Zotero.WebRequestIntercept.removeListener('headersReceived', Zotero.Proxies.onHeadersReceived);
		browser.webNavigation.onCommitted.removeListener(Zotero.Proxies.onNavigationCommitted)
	};
	
	
	this.updateDisabledByDomain = function() {
		if (!Zotero.Proxies.disableByDomain) return;
		let now = Date.now();
		if (now - this.lastIPCheck > 15 * 60 * 1000) {
			this.lastIPCheck = now;
			Zotero.Proxies.DNS.getHostnames().then(function(hosts) {
				Zotero.Proxies.disabledByDomain = false;
				for (var host of hosts) {
					Zotero.Proxies.disabledByDomain = host.toLowerCase().indexOf(Zotero.Proxies.disableByDomain) != -1;
					if (Zotero.Proxies.disabledByDomain) return;
				}
				
			}.bind(this));
		}
	};


	this.onPageLoadSafari = function(tab) {
		let details = {url: tab.url, frameId: 0, tabId: tab, statusCode: 200};
	
		for (let proxy of Zotero.Proxies.proxies) {
			if (typeof proxy.maybeAddHost === 'function') {
				proxy.maybeAddHost(details);
			}
		}
	};

	this.onHeadersReceived = (details) => {
		if (Zotero.Proxies.autoRecognize) {
			Zotero.Proxies._recognizeProxy(details);
		}
	}

	this.onNavigationCommitted = (details) => {
		if (details.frameId != 0) {
			return;
		}

		this.checkForRedirectLoop(details);

		Zotero.Proxies.updateDisabledByDomain();
		if (Zotero.Proxies.disabledByDomain) return;
		
		for (let proxy of Zotero.Proxies.proxies) {
			proxy.maybeAddHost(details);
		}
		
		if (Zotero.Proxies.isPreventingRedirectLoops()) return;
		
		let redirect;
		let redirectProxy;
		for (redirectProxy of Zotero.Proxies.proxies) {
			if (typeof redirectProxy.maybeRedirect === 'function') {
				redirect = redirectProxy.maybeRedirect(details);
				if (redirect) break;
			}
		}
		if (!redirect) return;
		if (redirectProxy.type !== 'openathens') {
			this._redirectedTabIDs[details.tabId] = {
				host: new URL(details.url).host,
				count: this.REDIRECT_LOOP_MONITOR_COUNT,
				timeout: Date.now() + this.REDIRECT_LOOP_MONITOR_TIMEOUT
			};
		}
		browser.tabs.update(details.tabId, {url: redirect.redirectUrl});
	};
	
	this.toggleRedirectLoopPrevention = function(value) {
		if (typeof value === "undefined") {
			Zotero.debug('Called Proxies._toggleRedirectLoopPrevention() without an argument');
		}
		Zotero.debug(`Proxies: ${value ? "Enabling" : "Disabling"} loop prevention`)
		this._loopPreventionTimestamp = value ? (Date.now() + this.REDIRECT_LOOP_TIMEOUT) : 0;
		Zotero.Prefs.set('proxies.loopPreventionTimestamp', this._loopPreventionTimestamp)
	}
	
	this.isPreventingRedirectLoops = function() {
		return this._loopPreventionTimestamp > Date.now();
	}
	
	this.checkForRedirectLoop = (details) => {
		if (details.frameId != 0) return;
		let redirectedTab = this._redirectedTabIDs[details.tabId];
		if (redirectedTab) {
			if (details.transitionQualifiers?.includes('forward_back') || details.transitionQualifiers?.includes('from_address_bar') ) {
				delete this._redirectedTabIDs[details.tabId];
			}
			else if (redirectedTab.host == new URL(details.url).host) {
				this.toggleRedirectLoopPrevention(true);
				delete this._redirectedTabIDs[details.tabId];
				return true;
			}
			else if (redirectedTab.count-- <= 0 || redirectedTab.timeout <= Date.now()) {
				delete this._redirectedTabIDs[details.tabId];
			}
		}
		return false;
	}
	
	this.notifyNewProxy = async function(proxy, tabId) {
		let instance = Zotero.Proxies._createProxyInstance(proxy);
		let host = proxy.hosts[proxy.hosts.length - 1];
		let proxyName = instance.toDisplayName();
		let response = await Zotero.Proxies.showNotification(
			Zotero.getString('proxy_newProxy_title'),
			Zotero.getString('proxy_newProxy_message', [ZOTERO_CONFIG.CLIENT_NAME, host, proxyName]),
			['✕', Zotero.getString('proxy_settings'), Zotero.getString('proxy_accept')],
			tabId
		);
		if (response == 2) {
			let result = await Zotero.Messaging.sendMessage('confirm', {
				title: Zotero.getString('proxy_addProxy_title'),
				message: Zotero.getString('proxy_addProxy_message', [ZOTERO_CONFIG.CLIENT_NAME, host, proxyName]),
				button1Text: Zotero.getString('proxy_addProxy'),
				button2Text: Zotero.getString('general_cancel')
			}, tabId);
			if (result.button == 1) {
				return Zotero.Proxies.save(proxy);
			}
		}
		if (response == 1) {
			Zotero.Connector_Browser.openPreferences("proxies");
			return this.notifyNewProxy(proxy, tabId);
		}
	}
	
	this._recognizeProxy = function (details) {
		setTimeout(() => {
			var proxy = false;
			for (var detectorName in Zotero.Proxies.Detectors) {
				var detector = Zotero.Proxies.Detectors[detectorName];
				try {
					proxy = detector(details);
				} catch(e) {
					Zotero.logError(e);
				}
				
				if (!proxy) continue;
				let requestURI = new URL(details.url);
				Zotero.debug("Proxies: Detected "+detectorName+" proxy "+proxy.toProperScheme+" for "+requestURI.host);
				
				let invalid = (typeof proxy.validate === 'function') ? proxy.validate() : false;
				if (invalid) continue;

				this.notifyNewProxy(proxy.toJSON ? proxy.toJSON() : proxy, details.tabId);
				
				break;
			}
		});
	};

	this.validate = function(proxy) {
		let instance = Zotero.Proxies._createProxyInstance(proxy);
		return instance.validate();
	}

	this.save = function(proxy) {
		let instance = Zotero.Proxies._createProxyInstance(proxy);

		instance.toProxyScheme = (instance.toProxyScheme || "").trim();
		instance.toProperScheme = (instance.toProperScheme || instance.scheme || "").trim();
		instance.hosts = instance.hosts.map(host => host.trim()).filter(host => host);
		
		let multiHost = (instance.type === 'openathens')
			|| (instance.toProperScheme || '').includes('%h')
			|| (instance.toProxyScheme || '').includes('%u');
		if (!multiHost) {
			instance.hosts = instance.hosts.slice(0, 1);
		}
		
		var existingProxyIndex = Zotero.Proxies.proxies.findIndex((p) => p.id == instance.id);
		if (existingProxyIndex == -1) {
			Zotero.Proxies.proxies.push(instance);
		}
		else {
			Zotero.Proxies.proxies[existingProxyIndex] = instance;
		}
		if (!instance.regexp && typeof instance.compileRegexp === 'function') instance.compileRegexp();

		for (let host in Zotero.Proxies.hosts) {
			if (Zotero.Proxies.hosts[host].id == instance.id && instance.hosts.indexOf(host) == -1) {
				delete Zotero.Proxies.hosts[host];
			}
		}
		
		for (let host of instance.hosts) {
			Zotero.Proxies.hosts[host] = instance;
		}

		Object.assign(proxy, instance.toJSON())
		
		Zotero.Proxies.storeProxies();
	};
	
	this.remove = function(proxy) {
		var existingProxyIndex = Zotero.Proxies.proxies.findIndex((p) => p.id == proxy.id);
		if (existingProxyIndex != -1) {
			Zotero.Proxies.proxies.splice(existingProxyIndex, 1);
			Zotero.Proxies.storeProxies();
		}
		Object.keys(Zotero.Proxies.hosts).filter(function(h) {
			if (Zotero.Proxies.hosts[h]) {
				delete Zotero.Proxies.hosts[h];
			}
		});
	};
	
	this.storeProxies = function() {
		let proxies = Zotero.Proxies.proxies.map(function(p) {
			return {
				id: p.id,
				autoAssociate: p.autoAssociate,
				toProxyScheme: p.toProxyScheme,
				toProperScheme: p.toProperScheme || p.scheme,
				hosts: p.hosts,
				type: p.type
			};
		});
		
		Zotero.Prefs.set('proxies.proxies', proxies);
	};

	this._createProxyInstance = function(json={}) {
		if (json.type === 'openathens') {
			return new Zotero.Proxy.OpenAthensProxy(json);
		}
		return new Zotero.Proxy(json);
	};

	this.proxyToProper = function(url, onlyReturnIfProxied) {
		for (var proxy of Zotero.Proxies.proxies) {
			if (proxy.regexp) {
				var m = proxy.regexp.exec(url);
				if (m) {
					var toProper = proxy.toProper(m);
					Zotero.debug("Proxies.proxyToProper: "+url+" to "+toProper);
					return toProper;
				}
			}
		}
		return (onlyReturnIfProxied ? false : url);
	};

	this.properToProxy = function(url, onlyReturnIfProxied) {
		var uri = new URL(url);
		if (Zotero.Proxies.hosts[uri.host]) {
			var toProxy = Zotero.Proxies.hosts[uri.host].toProxy(uri);
			Zotero.debug("Proxies.properToProxy: "+url+" to "+toProxy);
			return toProxy;
		}
		return (onlyReturnIfProxied ? false : url);
	};

	this.getPotentialProxies = function(url) {
		url = new URL(url).href;
		var urlToProxy = {};
		if (Zotero.Proxies.transparent) {
			for (var proxy of Zotero.Proxies.proxies) {
				if (proxy.regexp) {
					var m = proxy.regexp.exec(url);
					if (m) {
						let proper = proxy.toProper(m);
						urlToProxy[proper] = proxy.toJSON();
						return urlToProxy;
					}
				}
			}
		}
		urlToProxy[url] = null;
		
		var m = /^(https?:\/\/)([^\/]+)/i.exec(url);
		if (m) {
			var host = m[2];
			if (host.substr(0, 2) === "0-") host = host.substr(2);
			var hostnameParts = [host.split(".")];
			if (m[1] == 'https://') {
				hostnameParts.push(host.split('.'));
				hostnameParts[1].splice(0, 1, ...(hostnameParts[1][0].replace(/-/g, '.').split('.')));
			}
			
			for (let i=0; i < hostnameParts.length; i++) {
				let parts = hostnameParts[i];
				for (let j=1; j<parts.length-2; j++) {
					if (TLDS[parts[j].toLowerCase()]) {
						var properHost = parts.slice(0, j+1).join(".");
						var properURL = m[1]+properHost+url.substr(m[0].length);
						let skippedParts = '';
						while (parts[j+1].match(/^[0-9]*$/)) {
							skippedParts += '-' + parts[j+1];
							j++;
						}
						var proxyHost = parts.slice(j+1).join('.');
						let scheme = `%h${skippedParts}.${proxyHost}/%p`
						urlToProxy[properURL] = {toProperScheme: scheme, scheme};
					}
				}
			}
		}
		return urlToProxy;
	};

	this._isBlacklisted = function(host) {
		const hostBlacklist = [
			/edu$/,
			/doi\.org$/,
			/google\.com$/,
			/wikipedia\.org$/,
			/^[^.]*$/,
			/doubleclick\.net$/,
			/^eutils.ncbi.nlm.nih.gov$/
		];
		const hostWhitelist = [
			/^scholar\.google\.com$/,
			/^muse\.jhu\.edu$/,
			/^(www\.)?journals\.uchicago\.edu$/
		]

		for (var blackPattern of hostBlacklist) {
			if (blackPattern.test(host)) {
				for (var whitePattern of hostWhitelist) {
					if (whitePattern.test(host)) {
						return false;
					}
				}
				return true;
			}
		}
		return false;
	}

	this.showNotification = function(title, message, actions, tabId, timeout) {
		Zotero.debug(`Proxy notification: ${message}`);
		actions = actions && actions.map((a) => {return {title: a, dismiss: true}});
		return Zotero.Connector_Browser.notify(message, actions, timeout, tabId);
	}

};

const Zotero_Proxy_schemeParameters = {
	"%p": "(.*?)",
	"%h": "([a-zA-Z0-9]+[.\\-][a-zA-Z0-9.\\-]+)",
	"%u": "(.*?)",
};

const Zotero_Proxy_schemeParameterRegexps = {
	"%p": /([^%])%p/,
	"%h": /([^%])%h/,
	"%u": /([^%])%u/,
};


Zotero.Proxy = class {
	constructor(json={}) {
		this.id = json.id || Date.now();
		this.autoAssociate = json.autoAssociate !== false;
		this.toProperScheme = json.toProperScheme || json.scheme;
		this.toProxyScheme = json.toProxyScheme;
		this.scheme = this.toProperScheme;
		this.hosts = json.hosts || [];
		if (this.toProperScheme) {
			this.compileRegexp();
		}
	}

	validate() {
		for (let host of this.hosts) {
			host = host.trim();
			var oldProxy = Zotero.Proxies.hosts[host];
			if (oldProxy && oldProxy.id != this.id) {
				return ["proxy_validate_hostProxyExists", host];
			}
		}

		if (this.toProxyScheme) {
			let scheme = this.toProxyScheme.trim();
			for (let p of Zotero.Proxies.proxies) {
				if (!p || p.id == this.id) continue;
				if ((p.toProxyScheme || '').trim() && (p.toProxyScheme || '').trim() == scheme) {
					return ["proxy_validate_schemeDuplicate"];
				}
			}
		}
		
		if (!this.toProperScheme) return false;

		if (this.toProperScheme == '%h.example.com/%p' || this.toProxyScheme == 'proxy.example.com/login?qurl=%s') {
			return ["proxy_validate_schemeUnmodified"];
		}

		if (
			this.toProperScheme.length <= "%h.-.--/%p".length 
				|| this.toProperScheme.includes('%h/')
				|| this.toProperScheme == '%h/%p'
				|| this.toProperScheme == '%h%p'
		) {
			return ["proxy_validate_schemeInvalid"];
		}

		if (!Zotero_Proxy_schemeParameterRegexps["%p"].test(this.toProperScheme)) {
			return ["proxy_validate_schemeNoPath"];
		}
		return false;
	}

	compileRegexp() {
		var indices = this.indices = {};
		this.parameters = [];
		for (var param in Zotero_Proxy_schemeParameters) {
			var index = this.toProperScheme.indexOf(param);

			while (this.toProperScheme[index-1] && (this.toProperScheme[index-1] == "%")) {
				this.toProperScheme = this.toProperScheme.substr(0, index-1)+this.toProperScheme.substr(index);
				index = this.toProperScheme.indexOf(param, index+1);
			}

			if (index != -1) {
				this.indices[param] = index;
				this.parameters.push(param);
			}
		}

		this.parameters = this.parameters.sort(function(a, b) {
			return indices[a]-indices[b];
		});

		var re;
		if (this.toProperScheme.includes('://')) {
			re = "^"+Zotero.Utilities.quotemeta(this.toProperScheme)+"$";
		} else {
			re = "^https?"+Zotero.Utilities.quotemeta('://'+this.toProperScheme)+"$";
		}
		for(var i=this.parameters.length-1; i>=0; i--) {
			var param = this.parameters[i];
			re = re.replace(Zotero_Proxy_schemeParameterRegexps[param], "$1"+Zotero_Proxy_schemeParameters[param]);
		}

		this.regexp = new RegExp(re);
	}


	toJSON() {
		return {
			id: this.id,
			autoAssociate: this.autoAssociate,
			scheme: this.toProperScheme,
			toProxyScheme: this.toProxyScheme,
			toProperScheme: this.toProperScheme,
			hosts: this.hosts,
			type: this.type,
		}
	}

	toProper(m) {
		if (!this.toProperScheme) return m;
		if (!Array.isArray(m)) {
			m = new URL(m).href;
			let match = this.regexp.exec(m);
			if (!match) {
				return m
			} else {
				m = match;
			}
		}
		let hostIdx = this.parameters.indexOf("%h");
		let protocol = m[0].indexOf('https') == 0 ? 'https://' : 'http://';
		if (hostIdx != -1) {
			var properURL = protocol+m[hostIdx+1]+"/";
		} else {
			var properURL = protocol+this.hosts[0]+"/";
		}
		
		if (protocol == "https://" ||
			!properURL.includes('.')) {
			properURL = properURL.replace(/-/g, '.');
		}

		if (this.indices["%p"]) {
			properURL += m[this.parameters.indexOf("%p")+1];
		} else {
			var dir = m[this.parameters.indexOf("%d")+1];
			var file = m[this.parameters.indexOf("%f")+1];
			if (dir !== "") properURL += dir+"/";
			properURL += file;
		}

		return properURL;
	}

	toProxy(uri) {
		if (typeof uri == "string") {
			uri = new URL(uri);
			uri.pathname = uri.pathname || '';
		}
		if (this.regexp?.exec(uri.href) || Zotero.Proxies._isBlacklisted(uri.hostname)) {
			return uri.href;
		}
		if (this.toProxyScheme) {
			return this.toProxyScheme.replace('%u', encodeURIComponent(uri.href));
		}
		var proxyURL = this.toProperScheme;

		for(var i=this.parameters.length-1; i>=0; i--) {
			var param = this.parameters[i];
			var value = "";
			if (param == "%h") {
				value = (uri.protocol == 'https:') ? uri.hostname.replace(/\./g, '-') : uri.hostname;
			} else if (param == "%p") {
				value = uri.pathname.substr(1) + uri.search;
			}

			proxyURL = proxyURL.substr(0, this.indices[param])+value+proxyURL.substr(this.indices[param]+2);
		}

		if (proxyURL.includes('://')) {
			return proxyURL;
		}
		return uri.protocol + '//' + proxyURL;
	}

	maybeAddHost(details) {
		if (!this.regexp || !this.autoAssociate) return;
		var m = this.regexp.exec(details.url);
		if (!m) return;
		
		let hostParamIndex = this.parameters ? this.parameters.indexOf("%h") : -1;
		if (hostParamIndex === -1) return;
		
		let host = m[hostParamIndex + 1];
		if (!host) return;
		if (!host.includes('.')) {
			host = host.replace(/-/g, '.');
		}

		if (this.hosts.includes(host) || Zotero.Proxies._isBlacklisted(host)) return;

		let otherProxy = Zotero.Proxies.hosts[host];
		let shouldMapHost = !otherProxy;
		if (otherProxy && otherProxy.toProperScheme && otherProxy.toProperScheme.substr(0, 5) != 'https') {
			let httpsOtherProxyScheme = otherProxy.toProperScheme.replace(/^http/, 'https');
			shouldMapHost = httpsOtherProxyScheme == this.toProperScheme
		}
		if (!shouldMapHost) return;

		if (otherProxy) {
			otherProxy.hosts = otherProxy.hosts.filter(h => h != host);
			Zotero.Proxies.save(otherProxy);
		}
		this.hosts.push(host);
		Zotero.Proxies.save(this);
		Zotero.Proxies.toggleRedirectLoopPrevention(false);

		Zotero.Proxies.showNotification(
			Zotero.getString('proxy_newHost_title'),
			Zotero.getString('proxy_newHost_message', [ZOTERO_CONFIG.CLIENT_NAME, host, this.toDisplayName()]),
			["✕", Zotero.getString('proxy_settings'), Zotero.getString('proxy_dontProxy')],
			details.tabId
		)
		.then((response) => {
			if (response == 1) Zotero.Connector_Browser.openPreferences("proxies");
			if (response == 2) {
				this.hosts = this.hosts.filter((h) => h != host);
				Zotero.Proxies.save(this);
				return browser.tabs.update(details.tabId, {url: this.toProper(details.url)})
			}
		});
	}

	maybeRedirect(details) {
		let uri = new URL(details.url);
		if (Zotero.Proxies.hosts[uri.host] !== this) return;
		let proxied = this.toProxy(uri);
		if (!proxied) return;
		if (details.url.substr(0, 5) == 'https' && proxied.substr(0, 5) != 'https') return;
		
		var proxiedURI = new URL(proxied);

		const top2DomainsRe = /[^\.]+\.[^\.]+$/;
		let top21 = top2DomainsRe.exec(uri.hostname);
		let top22 = top2DomainsRe.exec(proxiedURI.hostname);
		if (!top21 || !top22 || top21[0] == top22[0]) {
			Zotero.debug("Proxies: skipping redirect; redirect URI and URI have same top 2 domains");
			return;
		}

		if (Zotero.Proxies.showRedirectNotification && details.frameId === 0) {
			Zotero.Proxies.showNotification(
				Zotero.getString('proxy_redirect_title', ZOTERO_CONFIG.CLIENT_NAME),
				Zotero.getString('proxy_redirect_message', [ZOTERO_CONFIG.CLIENT_NAME, uri.host, this.toDisplayName()]),
				['✕', Zotero.getString('proxy_settings'), Zotero.getString('proxy_dontProxy')],
				details.tabId
			).then((response) => {
				if (response == 1) Zotero.Connector_Browser.openPreferences("proxies");
				if (response == 2) {
					this.hosts = this.hosts.filter((h) => h != uri.host);
					Zotero.Proxies.save(this);
					return browser.tabs.update(details.tabId, {url: details.url})
				}
			});
		}

		return {redirectUrl: proxied};
	}

	toDisplayName() {
		if (this.type === 'openathens') {
			return this.toProxyScheme.match(/\/redirector\/([^?]+)/)?.[1] || this.toProxyScheme;
		}
		try {
			var parts = this.toProperScheme.match(/^(?:(?:[^:]+):\/\/)?([^\/]+)/);
			var domain = parts[1]
				.split('%h').pop()
				.match(/\W(.+)/)[1];
			return domain;
		}
		catch (e) {
			Zotero.logError(`Invalid proxy ${this.toProperScheme}: ${e}`);
			return this.toProperScheme;
		}
	}
}

Zotero.Proxy.OpenAthensProxy = class extends Zotero.Proxy {
	constructor(json={}) {
		super(json);
		this.type = 'openathens';
		this.toProxyRegexp = new RegExp(XRegExp.escape(this.toProxyScheme).replace('%u', '([^&]+)'));
	}

	get domain() {
		return this.toProxyScheme.match(/\/redirector\/([^?]+)/)?.[1] || "";
	}

	maybeAddHost(details) {
		if (!this.toProxyScheme || !this.autoAssociate) return;
		let m = this.toProxyRegexp.exec(details.url);
		if (!m) return;
		
		let redirectURL = decodeURIComponent(m[1]);
		let uri = new URL(redirectURL);
		let host = uri.host;
		if (!host || this.hosts.includes(host) || Zotero.Proxies._isBlacklisted(host)) return;

		let otherProxy = Zotero.Proxies.hosts[host];
		if (otherProxy) {
			otherProxy.hosts = otherProxy.hosts.filter((h) => h != host);
			Zotero.Proxies.save(otherProxy);
		}
		this.hosts.push(host);
		Zotero.Proxies.save(this);
		Zotero.Proxies.toggleRedirectLoopPrevention(false);

		Zotero.Proxies.showNotification(
			Zotero.getString('proxy_newHost_title'),
			Zotero.getString('proxy_newHost_message', [ZOTERO_CONFIG.CLIENT_NAME, host, this.toDisplayName()]),
			["✕", Zotero.getString('proxy_settings'), Zotero.getString('proxy_dontProxy')],
			details.tabId
		)
		.then((response) => {
			if (response == 1) Zotero.Connector_Browser.openPreferences("proxies");
			if (response == 2) {
				this.hosts = this.hosts.filter((h) => h != host);
				Zotero.Proxies.save(this);
			}
		});
	}

	maybeRedirect(details) {
		let uri = new URL(details.url);
		if (Zotero.Proxies.hosts[uri.host] !== this) return;
		let last = Zotero.Proxies.openAthensHostRedirectTime[uri.host] || 0;
		if (Date.now() - last < OPENATHENS_REDIRECT_INTERVAL) return;
		
		Zotero.Proxies.openAthensHostRedirectTime[uri.host] = Date.now();

		if (Zotero.Proxies.showRedirectNotification && details.frameId === 0) {
			Zotero.Proxies.showNotification(
				Zotero.getString('proxy_redirect_title', ZOTERO_CONFIG.CLIENT_NAME),
				Zotero.getString('proxy_redirect_message', [ZOTERO_CONFIG.CLIENT_NAME, uri.host, this.toDisplayName()]),
				['✕', Zotero.getString('proxy_settings'), Zotero.getString('proxy_dontProxy')],
				details.tabId
			).then((response) => {
				if (response == 1) Zotero.Connector_Browser.openPreferences("proxies");
				if (response == 2) {
					this.hosts = this.hosts.filter((h) => h != uri.host);
					Zotero.Proxies.save(this);
				}
			});
		}
		return {redirectUrl: this.toProxy(details.url)};
	}

	validate() {
		if (this.domain.length <= 0) return;
		let tld = this.domain.split('.')[1];
		if (!tld || tld.length < 2) return ["proxy_validate_openAthens_domainInvalid"];
		return super.validate();
	}
}

Zotero.Proxies.Detectors = {};

Zotero.Proxies.Detectors.EZProxy = function(details) {
	if (details.responseHeadersObject["server"] != "EZproxy") return false;
	let loginURI = new URL(details.url);
	var m =  /(url|qurl)=([^&]+)/i.exec(loginURI.search);
	if (loginURI.pathname !== "/login" || !m) return false;
	
	var properURL = (m[1].toLowerCase() == "qurl" ? decodeURIComponent(m[2]) : m[2]);
	try {
		var properURI = new URL(properURL);
	}
	catch (e) {
		return false;
	}

	let proxiedURL = details.responseHeadersObject['location'];
	for (let proxy of Zotero.Proxies.proxies) {
		if (proxy.toProxyScheme) {
			let proxyURI = new URL(proxy.toProxyScheme);
			if (loginURI.origin == proxyURI.origin) {
				return false;
			}
		}
		else if (proxiedURL && proxy.regexp.test(proxiedURL)) {
			proxy.toProxyScheme = `${loginURI.origin}${loginURI.pathname}?qurl=%u`;
			Zotero.Proxies.save(proxy)
			return false;
		}
	}
	
	if (proxiedURL) {
		let proxiedURI = new URL(proxiedURL);
		let redirectingToProxiedHost = (proxiedURI.host.indexOf(properURI.host) != -1);
		if (!redirectingToProxiedHost && properURI.protocol == 'https:') {
			if (properURI.host != properURI.host.replace(/\./g, '-')) {
				properURI.host = properURI.host.replace(/\./g, '-');
			}
			redirectingToProxiedHost = (proxiedURI.host.indexOf(properURI.host) != -1);
		}
		if (redirectingToProxiedHost && !Zotero.Proxies.proxyToProper(proxiedURL, true)) {
			return new Zotero.Proxy({
				autoAssociate: true,
				toProperScheme: proxiedURI.host.replace(properURI.host, "%h")+"/%p",
				toProxyScheme: `${loginURI.origin}${loginURI.pathname}?qurl=%u`,
				hosts: [properURI.host.replace(/-/g, '.')]
			});
		}
	}
	new Zotero.Proxies.Detectors.EZProxy.Listener(details, properURL, `${loginURI.origin}${loginURI.pathname}?qurl=%u`);
}

Zotero.Proxies.Detectors.EZProxy.listeners = new Set();
Zotero.Proxies.Detectors.EZProxy.Listener = function(details, properURL, toProxy) {
	if (Zotero.Proxies.Detectors.EZProxy.listeners.has(details.tabId)) return;
	Zotero.Proxies.Detectors.EZProxy.listeners.add(details.tabId)
	this.tabId = details.tabId;
	this.properURI = new URL(properURL);
	this.toProxy = toProxy;
	this.sniffingLimit = 20;
	this.listeners = {
		headersReceived: this.onHeadersReceived.bind(this),
	};
	for (let listenerType in this.listeners) {
		Zotero.WebRequestIntercept.addListener(listenerType, this.listeners[listenerType]);
	}
};
Zotero.Proxies.Detectors.EZProxy.Listener.prototype.deregister = function() {
	for (let listenerType in this.listeners) {
		Zotero.WebRequestIntercept.removeListener(listenerType, this.listeners[listenerType]);
	}
	Zotero.Proxies.Detectors.EZProxy.listeners.delete(this.tabId)
};
Zotero.Proxies.Detectors.EZProxy.Listener.prototype.onHeadersReceived = function(details) {
	if (details.tabId !== this.tabId || details.frameId !== 0) return;
	if (this.sniffingLimit <= 0) {
		this.deregister();
	}
	this.sniffingLimit--;
	
	let proxiedURI = new URL(details.url);
	let isProxiedHost = (proxiedURI.host.indexOf(this.properURI.host) != -1);
	if (!isProxiedHost && this.properURI.protocol == 'https:') {
		if (this.properURI.host != this.properURI.host.replace(/\./g, '-')) {
			this.properURI.host = this.properURI.host.replace(/\./g, '-');
		}
		isProxiedHost = (proxiedURI.host.indexOf(this.properURI.host) != -1);
	}
	if (isProxiedHost) {
		let isExisting;
		for (let proxy of Zotero.Proxies.proxies) {
			if (proxy.regexp && proxy.regexp.test(details.url)) {
				isExisting = true;
				if (!proxy.toProxyScheme) {
					proxy.toProxyScheme = this.toProxy;
					Zotero.Proxies.save(proxy)
				}
			}
		}
		if (!isExisting) {
			let proxy = new Zotero.Proxy({
				autoAssociate: true,
				toProperScheme: proxiedURI.host.replace(this.properURI.host, "%h")+"/%p",
				toProxyScheme: this.toProxy,
				hosts: [this.properURI.host.replace(/-/g, '.')]
			});
			if (!proxy.validate()) {
				Zotero.Proxies.notifyNewProxy(proxy.toJSON(), details.tabId)
			}
		}
		this.deregister();
	}
};

Zotero.Proxies.Detectors.OpenAthens = function(details) {
	var m = /^https?:\/\/go\.openathens\.net\/redirector\/([^?]*)\?url=([^&]+)/i.exec(details.url);
	if (!m) return false;
	
	var name = m[1];
	var properURL = decodeURIComponent(m[2]);
	try {
		var properURI = new URL(properURL);
	}
	catch (e) {
		return false;
	}
	
	var toProxyScheme = `https://go.openathens.net/redirector/${name}?url=%u`;
	
	for (let proxy of Zotero.Proxies.proxies) {
		if (proxy.toProxyScheme == toProxyScheme) {
			return false;
		}
	}
	
	let proxy = new Zotero.Proxy.OpenAthensProxy({
		autoAssociate: true,
		toProxyScheme: toProxyScheme,
		hosts: [properURI.host],
		type: "openathens"
	});
	return proxy;
};

Zotero.Proxies.DNS = new function() {
	this.getHostnames = function() {
		return Zotero.Connector.callMethod('getClientHostnames', null).then(function(hostnames) {
			Zotero.Proxies._clientHostnames = hostnames;
			return hostnames;
		});
	}
};

})();
