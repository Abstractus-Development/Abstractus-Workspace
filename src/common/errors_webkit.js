Zotero.Errors = new function() {
	var _output = [];
	
	this.init = async function() {
		if (Zotero.isManifestV3) {
			let storedData = await browser.storage.session.get({'loggedErrors': []});
			_output = storedData.loggedErrors.concat(_output);
			if (!_output.length) {
				_output.push('Info: Service worker starts: ');
			}
		}
	}
	
	this.logServiceWorkerStarts = function(time) {
		_output[0] = _output[0] += ` ${time}`
	}
	
	this.log = function(string, url, line) {
		var err;
		err = [`[JavaScript Error: "${string}"`];
		if(url || line) {
			var info = [];
			if(url) info.push('file: "'+url+'"');
			if(line) info.push('line: '+line);
			err.push(" {"+info.join(" ")+"}");
		}
		err.push("]");
		err = err.join("");
		_output.push(err);
		if (Zotero.isManifestV3) {
			browser.storage.session.set({'loggedErrors': _output});
		}
	}
	
	this.getErrors = async function() {
		return _output.slice();
	}

	this.getSystemInfo = async function () {
		var info = {
			connector: "true",
			version: Zotero.version,
			platform: navigator.platform,
			locale: navigator.language,
			userAgent: navigator.userAgent,
			isManifestV3: Zotero.isManifestV3
		};
		
		info.appName = Zotero.appName;
		info.zoteroAvailable = !!(await Zotero.Connector.checkIsOnline());
		
		
		if (Zotero.isBackground && !Zotero.isSafari) {
			let granted = await browser.permissions.contains({permissions: ['management']});
			if (granted) {
				if (!Zotero.isChromium || chrome.management.getAll) {
					let extensions = await browser.management.getAll();
					info.extensions = extensions
						.filter(extension => extension.enabled && extension.name != Zotero.appName)
						.map(extension => {
							return `${extension.name}: ${extension.version}, ${extension.type}`;
						}).join(', ')
				}
			}
		}
		return JSON.stringify(info, null, 2);
	}
}

if (typeof Zotero.Debug != "undefined") {
	Zotero.Debug.bgInit = Zotero.Debug.init;
}
