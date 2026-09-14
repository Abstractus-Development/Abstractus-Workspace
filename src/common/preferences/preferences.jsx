/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2011 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/


/**
 * Sets or removes the "disabled" attribute on an element.
 */
function toggleDisabled(element, status) {
	if(status) {
		element.setAttribute("disabled", "true");
	} else if(element.hasAttribute("disabled")) {
		element.removeAttribute("disabled");
	}
}

var Zotero_Preferences = {
	PROXIES_ENABLED: false,
	pane: {},
	content: {},
	visiblePaneName: null,
	init: async function() {
		Zotero.isPreferences = true;
		// Resolved once the pane's host-permission prompt has been dismissed (immediately on
		// browsers where no prompt is displayed)
		Zotero_Preferences.permissionsPromptDeferred = Zotero.Promise.defer();
		Zotero.Messaging.init();
		Zotero.Messaging.addMessageListener('confirm', props => Zotero.ModalPrompt.confirm(props));
		await Zotero.i18n.init();
		Zotero.i18n.translateFragment(document);
		document.getElementById('connector-version').textContent = Zotero.version;

		var panesDiv = document.getElementById("panes");
		var id;
		for(var i in panesDiv.childNodes) {
			var paneDiv = panesDiv.childNodes[i];
			id = paneDiv.id;
			if(id) {
				if(id.substr(0, 5) === "pane-") {
					var paneName = id.substr(5);
					Zotero_Preferences.pane[paneName] = paneDiv;
					Zotero_Preferences.content[paneName] = document.getElementById("content-"+paneName);
					paneDiv.addEventListener("click", Zotero_Preferences.onPaneClick, false);
				}
			}
		}
		
		let hashPane = window.location.hash && window.location.hash.substr(1);
		if (hashPane in Zotero_Preferences.pane) {
			Zotero_Preferences.selectPane(hashPane);
		} else {
			Zotero_Preferences.selectPane("general");
		}

		var checkboxes = document.querySelectorAll('[type="checkbox"][data-pref]');
		for (let checkbox of checkboxes) {
			checkbox.addEventListener('change', Zotero_Preferences.onPrefCheckboxChange);
			checkbox.checked = await Zotero.Prefs.getAsync(checkbox.dataset.pref);
		}		
		
		Zotero_Preferences.General.init();
		Zotero_Preferences.Advanced.init();

		// Abstractus: the proxy pane stays hidden until proxy support ships in Desktop.
		if (Zotero_Preferences.PROXIES_ENABLED) {
			Zotero.Prefs.loadNamespace('proxies').then(function() {
				Zotero_Preferences.Proxies.init();
			});
		}


		Zotero.initDeferred.resolve();
		Zotero.isInject = true;

		Zotero_Preferences.refreshData();
		window.setInterval(() => Zotero_Preferences.refreshData(), 1000);

		if (Zotero.isSafari) {
			// Let the initialized preferences pane render before displaying a modal over it.
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			try {
				// A single combined prompt covers missing localhost access and the all-hosts
				// recommendation. The client status check suppresses its own localhost prompt.
				await Zotero.HostPermissions.prompt({domains: ['127.0.0.1'], recommendAllHosts: true});
			}
			finally {
				Zotero_Preferences.permissionsPromptDeferred.resolve();
			}
		}
		else {
			Zotero_Preferences.permissionsPromptDeferred.resolve();
		}
	},

	/**
	 * Called when a pane is clicked.
	 */
	onPaneClick: function(e) {
		e.preventDefault();
		let paneName = e.currentTarget.id.substr(5);
		history.replaceState(null, "", `#${paneName}`);
		Zotero_Preferences.selectPane(paneName);
	},
	
	onPrefCheckboxChange: function(event) {
		Zotero.Prefs.set(event.target.dataset.pref, event.target.checked);
	},
	
	/**
	 * Selects a pane.
	 */
	selectPane: function(paneName) {
		if(this.visiblePaneName === paneName) return;
		
		if(this.visiblePaneName) {
			this.pane[this.visiblePaneName].classList.toggle('selected', false);
			this.content[this.visiblePaneName].classList.toggle('selected', false);
		}
		
		this.visiblePaneName = paneName;

		this.pane[paneName].classList.toggle('selected', true);
		this.content[paneName].classList.toggle('selected', true);
	},
	
	/**
	 * Refreshes data that may have changed while the options window is open
	 */
	refreshData: function() {
		// get errors
		return Zotero.Errors.getErrors().then(function(errors) {
			errors = errors.filter(error => !/^Info: Service worker starts:/.test(String(error)));
			if(errors.length) {
				document.getElementById('advanced-no-errors').style.display = "none";
				document.getElementById('advanced-have-errors').style.display = "block";
				document.getElementById('advanced-textarea-errors').textContent = errors.join("\n\n");
			}
			// get debug logging info
			return Zotero.Connector_Debug.count();
		}).then(function(count) {
			document.getElementById('advanced-span-lines-logged').textContent
				= Zotero.getString('preferences_debugOutput_linesLogged', count);
			toggleDisabled(document.getElementById('advanced-button-view-output'), !count);
			toggleDisabled(document.getElementById('advanced-button-copy-output'), !count);
			toggleDisabled(document.getElementById('advanced-button-clear-output'), !count);
		});
	},

	/**
	 * Copies text to the clipboard and briefly confirms on the button
	 */
	copyToClipboard: async function(button, text) {
		await navigator.clipboard.writeText(text);
		let label = button.value;
		button.value = Zotero.getString('general_copied');
		setTimeout(() => button.value = label, 1500);
	}
};

Zotero_Preferences.General = {
	init: function() {
		ReactDOM.render(React.createElement(Zotero_Preferences.Components.ClientStatus, null),
			document.getElementById("client-status"));

		// Appearance: the pref is the source of truth; theme.js keeps a copy in localStorage so
		// pages can paint correctly before prefs load. Frames get it from the content script.
		let appearance = document.getElementById('appearance-select');
		appearance.value = AbstractusTheme.mode;
		Zotero.Prefs.getAsync('appearance').then((mode) => {
			if (!AbstractusTheme.MODES.includes(mode)) mode = 'contrast';
			appearance.value = mode;
			if (AbstractusTheme.mode !== mode) AbstractusTheme.set(mode);
		});
		appearance.addEventListener('change', () => {
			Zotero.Prefs.set('appearance', appearance.value);
			AbstractusTheme.set(appearance.value);
		});

		// A for Abstractus (Zotero uses S); keep in sync with "commands" in the manifests
		let shortcut = Zotero.isMac ? '⌘⇧A' : 'Ctrl+Shift+A';
		document.getElementById('saving-how-to').innerHTML = Zotero.getString('preferences_saving_howTo',
			`<kbd>${shortcut}</kbd>`);

		document.getElementById("advanced-button-reset-translators").addEventListener('click', async (event) => {
			event.target.value = Zotero.getString('preferences_translators_resetting');
			try {
				// Otherwise "Resetting translators..." flash-appears and it looks glitchy
				await Promise.all([Zotero.Promise.delay(1000), (async () => {
					await Zotero.Prefs.removeAllCachedTranslators();
					return Zotero.Translators.updateFromRemote(true)
				})()]);
				event.target.value = Zotero.getString('preferences_translators_updated');
			} catch (e) {
				event.target.value = Zotero.getString('preferences_translators_updateFailed');
			}
		});

		var openTranslatorTesterButton = document.getElementById("advanced-button-open-translator-tester");
		if (openTranslatorTesterButton) openTranslatorTesterButton.onclick = Zotero_Preferences.General.openTranslatorTester;
	},

	/**
	 * Opens the translator tester in a new window.
	 */
	openTranslatorTester: function() {
		window.open(Zotero.getExtensionURL("tools/testTranslators/testTranslators.html"), "translatorTester");
	}
};

Zotero_Preferences.Proxies = {
	init: function() {
		document.getElementById('pane-proxies').style.display = null;
		this.proxiesComponent = React.createElement(Zotero_Preferences.Components.ProxySettings, null);
		ReactDOM.render(this.proxiesComponent, document.getElementById('content-proxies'));
	}
};


Zotero_Preferences.Advanced = {
	init: function() {
		
		document.getElementById("advanced-checkbox-enable-logging").onchange =
			function() { Zotero.Debug.setStore(this.checked); };
		document.getElementById("advanced-checkbox-enable-at-startup").onchange =
			function() { Zotero.Prefs.set('debug.store', this.checked); };
		document.getElementById("advanced-button-view-output").onclick = Zotero_Preferences.Advanced.viewDebugOutput;
		document.getElementById("advanced-button-clear-output").onclick = Zotero_Preferences.Advanced.clearDebugOutput;
		document.getElementById("advanced-button-copy-output").onclick = async function() {
			Zotero_Preferences.copyToClipboard(this, await Zotero.Connector_Debug.get());
		};
		document.getElementById("advanced-button-copy-errors").onclick = async function() {
			let errors = await Zotero.Errors.getErrors();
			let sysInfo = await Zotero.Errors.getSystemInfo();
			Zotero_Preferences.copyToClipboard(this, `${errors.join('\n\n')}\n\n${sysInfo}`);
		};

		var testRunnerButton = document.getElementById("advanced-button-open-test-runner");
		if (testRunnerButton) testRunnerButton.onclick = function() {
			Zotero.Connector_Browser.openTab(Zotero.getExtensionURL(`test/test.html`));
		};
		document.getElementById("advanced-button-config-editor").onclick = function() {
			if (confirm(Zotero.getString('preferences_configEditor_description'))) {
				Zotero.Connector_Browser.openConfigEditor();
			}
		};

		// get preference values
		Zotero.Connector_Debug.storing(function(status) {
			document.getElementById('advanced-checkbox-enable-logging').checked = !!status;
		});
		Zotero.Prefs.getAsync("debug.store").then(function(status) {
			document.getElementById('advanced-checkbox-enable-at-startup').checked = !!status;
		});
	},
		
	/**
	 * Opens a new window to view debug output.
	 */
	viewDebugOutput: function() {
		Zotero.Connector_Debug.get(function(log) {
			var textarea = document.getElementById("advanced-textarea-debug");
			textarea.textContent = log;
			textarea.style.display = "";
		});
	},

	/**
	 * Clears stored debug output.
	 */
	clearDebugOutput: function() {
		Zotero.Debug.clear();
		Zotero_Preferences.refreshData();
		var textarea = document.getElementById("advanced-textarea-debug");
		textarea.style.display = 'none';
	}
};

Zotero_Preferences.Components = {};

/**
 * Desktop connection status. Distinguishes "app not running" from "app running but this
 * browser isn't connected yet", which the plain ping check cannot.
 */
Zotero_Preferences.Components.ClientStatus = class ClientStatus extends React.Component {
	constructor(props) {
		super(props);
		this.state = { state: 'checking', checking: true };
		this.checkStatus = this.checkStatus.bind(this);
		this.onConnectionChanged = this.onConnectionChanged.bind(this);
		// Run the initial status check only after the pane's host-permission prompt has been
		// dismissed, so the request cannot trigger Safari's native permission dialog while the
		// explanation is still displayed
		Zotero_Preferences.permissionsPromptDeferred.promise.then(this.checkStatus);
	}

	componentDidMount() {
		// Connect/disconnect buttons (pairing-settings.js) report their outcome here
		document.addEventListener('abstractus-connection-changed', this.onConnectionChanged);
		this.timer = window.setInterval(() => { if (!document.hidden) this.checkStatus(); }, 5000);
	}

	componentWillUnmount() {
		document.removeEventListener('abstractus-connection-changed', this.onConnectionChanged);
		window.clearInterval(this.timer);
	}

	componentDidUpdate() {
		let actions = document.getElementById('connect-actions');
		if (actions) actions.dataset.state = this.state.state;
	}

	onConnectionChanged(event) {
		this.setState(this.fromResult(event.detail));
	}

	fromResult(result) {
		return { state: result.connected ? 'connected' : (result.state || 'unverified'), checking: false };
	}

	async checkStatus() {
		this.setState({checking: true});
		try {
			// The pairing credential lives in the background page; only it can verify the desktop
			let result = await browser.runtime.sendMessage({type: 'abstractus-pair', action: 'status'});
			this.setState(this.fromResult(result));
		}
		catch (e) {
			this.setState({state: 'offline', checking: false});
		}
	}

	render() {
		let clientName = ZOTERO_CONFIG.CLIENT_NAME;
		let copy = {
			checking: ['is-checking', Zotero.getString('general_pleaseWait'), ''],
			connected: ['is-online', 'Connected',
				`${clientName} Desktop is running and this browser is connected. Papers you save go straight to your Library.`],
			pairing_required: ['is-warning', 'Not connected',
				`${clientName} Desktop is running. Connect this browser once to start saving.`],
			unverified: ['is-warning', 'Reconnect needed',
				`This browser's connection could not be verified. Disconnect it, then connect again.`],
			desktop_update_required: ['is-warning', 'Update needed',
				`The app answering on the desktop port doesn't support secure browser connections. Update ${clientName} Desktop.`],
			offline: ['', 'Not running',
				`${clientName} Desktop isn't reachable. Open the app, then check again.`]
		};
		let [pillClass, pillText, description] = copy[this.state.state] || copy.unverified;
		return (<div className="status">
			<div className="status-text">
				<span className={`status-pill ${pillClass}`} role="status">{pillText}</span>
				<p>{description}</p>
			</div>
			<input type="button" className="button" value={Zotero.getString('preferences_zoteroStatus_update')}
				onClick={this.checkStatus} disabled={this.state.checking}/>
		</div>)
	}
};


Zotero_Preferences.Components.ProxySettings = class ProxySettings extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			transparent: Zotero.Prefs.get('proxies.transparent')
		};
		
		this.handleTransparentChange = this.handleTransparentChange.bind(this);
	}

	handleTransparentChange(transparent) {
		this.setState({transparent});
	}

	render() {
		return (
			<div>
				<div className="group">
					<div className="group-title">{Zotero.getString('preferences_proxySettings')}</div>
					<div className="group-content">
						<p className="muted" dangerouslySetInnerHTML={{__html: Zotero.getString(
							'preferences_proxySettings_description', ZOTERO_CONFIG.CLIENT_NAME)
						}}/>
						<Zotero_Preferences.Components.ProxyPreferences onTransparentChange={this.handleTransparentChange}/>
					</div>
				</div>
				<div className="group">
					<label className="group-title" htmlFor="proxies-proxy-select">{Zotero.getString('preferences_proxySettings_configured')}</label>
					<div className="group-content">
						<Zotero_Preferences.Components.Proxies transparent={this.state.transparent}/>
					</div>
				</div>
			</div>
		)
	}
};


Zotero_Preferences.Components.ProxyPreferences = class ProxyPreferences extends React.Component {
	constructor(props) {
		super(props);
		let state = {};
		let settings = ['transparent', 'autoRecognize', 'showRedirectNotification',
			 'disableByDomain', 'disableByDomainString', 'loopPreventionTimestamp'];
		for (let setting of settings) {
			state[setting] = Zotero.Prefs.get('proxies.'+setting);
		}
		this.state = state;
		
		this.handleCheckboxChange = this.handleCheckboxChange.bind(this);
		this.handleTextInputChange = this.handleTextInputChange.bind(this);
	}
	
	handleCheckboxChange(event) {
		this.updateState(event.target.name, event.target.checked);
	}
	
	handleTextInputChange(event) {
		this.updateState(event.target.name, event.target.value);
	}
	
	reenableProxyRedirection = () => {
		Zotero.Proxies.toggleRedirectLoopPrevention(false);
		this.setState({ loopPreventionTimestamp: 0 });
	}
	
	updateState(name, value) {
		let newState = {};
		newState[name] = value;
		this.setState(newState);
		Zotero.Prefs.set('proxies.'+name, value);
		// Refresh prefs in the background page
		Zotero.Proxies.loadPrefs();
		if (name === 'transparent') {
			this.props.onTransparentChange(value);
		}
	}
	
	render() {
		let autoRecognise = <label><input type="checkbox" disabled={!this.state.transparent} onChange={this.handleCheckboxChange} name="autoRecognize" defaultChecked={this.state.autoRecognize}/>&nbsp;{Zotero.getString('preferences_proxySettings_autoRecognize')}</label>;
		let redirectLoopPrevention = ''
		if (this.state.loopPreventionTimestamp > Date.now() && this.state.transparent) {
			redirectLoopPrevention = (
				<div className="group">
					<b>{Zotero.getString('preferences_proxySettings_redirectLoop', ZOTERO_CONFIG.CLIENT_NAME)}</b> <input type="button" onClick={this.reenableProxyRedirection} value={Zotero.getString('preferences_proxySettings_reenable')}/>
				</div>
			)
		}
		return (
			<div>
				{redirectLoopPrevention}
				<div>
					<label><input type="checkbox" name="transparent" onChange={this.handleCheckboxChange} defaultChecked={this.state.transparent}/>&nbsp;{Zotero.getString('preferences_proxySettings_enable')}</label>
					<div style={{marginLeft: "1em"}}>
						<label><input type="checkbox" disabled={!this.state.transparent} onChange={this.handleCheckboxChange} name="showRedirectNotification" defaultChecked={this.state.showRedirectNotification}/>&nbsp;{Zotero.getString('preferences_proxySettings_showRedirectNotification')}</label>
						<br/>
						{autoRecognise}
						<p>
							<label><input type="checkbox" disabled={!this.state.transparent} onChange={this.handleCheckboxChange} name="disableByDomain" defaultChecked={this.state.disableByDomain}/>&nbsp;{Zotero.getString('preferences_proxySettings_disableByDomain', ZOTERO_CONFIG.CLIENT_NAME)}</label>
							<br/>
							<input style={{marginTop: "0.5em", marginLeft: "1.5em"}} type="text" onChange={this.handleTextInputChange} disabled={!this.state.transparent || !this.state.disableByDomain} name="disableByDomainString" defaultValue={this.state.disableByDomainString}/>
						</p>
					</div>
				</div>
			</div>
		);
	}
};


Zotero_Preferences.Components.ProxyDetails = function ProxyDetails(props) {
	const { transparent, proxy, onProxyChange } = props;

	if (!transparent || !proxy) {
		return "";
	}

	const [toProxyScheme, setToProxyScheme] = React.useState(proxy.toProxyScheme);
	const [toProperScheme, setToProperScheme] = React.useState(proxy.toProperScheme);
	const [hosts, setHosts] = React.useState(proxy.hosts);
	const [currentHostIdx, setCurrentHostIdx] = React.useState(-1);
	const [autoAssociate, setAutoAssociate] = React.useState(proxy.autoAssociate);
	const [isOpenAthens, setIsOpenAthens] = React.useState(proxy.type === 'openathens');
	const [error, setError] = React.useState(null);

	const hostInputRef = React.useRef(null);
	const toProxyInputRef = React.useRef(null);
	const debouncedSetError = React.useRef(
		Zotero.Utilities.debounce(setError, 500)
	).current;

	React.useEffect(() => {
		setToProxyScheme(proxy.toProxyScheme);
		setToProperScheme(proxy.toProperScheme);
		setHosts(proxy.hosts);
		setCurrentHostIdx(-1);
		setAutoAssociate(proxy.autoAssociate);
		setIsOpenAthens(proxy.type === 'openathens');
	}, [proxy?.id]);

	React.useLayoutEffect(() => {
		// Focus the toProxyScheme input if proxy is new
		toProxyScheme.includes('example.com') && toProxyInputRef.current?.focus();
	}, [toProxyScheme])

	React.useLayoutEffect(() => {
		// Focus the host input if host is new
		hosts[currentHostIdx]?.length === 0 && hostInputRef.current?.focus();
	}, [currentHostIdx])

	React.useEffect(() => {
		(async () => {
			let updatedProxy = Object.assign(
				{},
				proxy,
				{
					toProxyScheme: toProxyScheme,
					toProperScheme: toProperScheme,
					hosts: hosts.filter(h => h.length),
					autoAssociate: autoAssociate
				}
			);
			if (isOpenAthens) {
				updatedProxy.type = 'openathens';
			} else {
				delete updatedProxy.type;
			}
			let error = await Zotero.Proxies.validate(updatedProxy);
			if (error?.[0] === "proxy_validate_schemeUnmodified") error = null;

			// Debounce showing errors, but clear them immediately when valid
			if (error) {
				debouncedSetError(error);
			} else {
				// But we still need to call it, otherwise the debounced function with the error
				// is called after the timeout
				debouncedSetError(null);
				setError(null);
			}
			if (error?.[0] === "proxy_validate_hostProxyExists") {
				updatedProxy.hosts = updatedProxy.hosts.filter(h => h != error[1]);
			}
			else if (error) return;

			saveProxy(updatedProxy);
			onProxyChange(updatedProxy);
		})();
	}, [toProxyScheme, toProperScheme, hosts, autoAssociate, isOpenAthens])

	var multiHost = toProperScheme?.includes('%h') || toProxyScheme?.includes('%u');

	const saveProxy = React.useRef(
		Zotero.Utilities.debounce(Zotero.Proxies.save.bind(Zotero.Proxies), 200)
	).current;

	let disableRemoveHost = currentHostIdx == -1;

	function handleSchemeChange(event) {
		var value = event.target.value;
		var name = event.target.name;
		if (name == 'toProxyScheme') {
			setToProxyScheme(value);
		}
		else if (name == 'toProperScheme') {
			setToProperScheme(value);
		}
	}

	function handleOpenAthensDomainChange(event) {
		var domain = event.target.value;
		var newToProxyScheme = domain ? `https://go.openathens.net/redirector/${domain}?url=%u` : '';
		setToProxyScheme(newToProxyScheme);
	}

	function handleCheckboxChange(event) {
		var target = event.target;
		setAutoAssociate(target.checked);
		
	}

	function handleTypeChange(event) {
		var value = event.target.value;
		const isOpenAthens = value === 'openathens';
		setIsOpenAthens(isOpenAthens);
		if (isOpenAthens) {
			setToProxyScheme('https://go.openathens.net/redirector/?url=%u');
		} else {
			setToProxyScheme('https://www.example.com/login?qurl=%u');
		}
	}

	function handleHostSelectChange(event) {
		setCurrentHostIdx(event.target.value !== "" ? parseInt(event.target.value) : -1);
	}

	function handleAddHost() {
		setHosts(hosts.concat(['']));
		setCurrentHostIdx(hosts.length);
	}

	function handleRemoveHost() {
		setHosts(hosts.filter((h, i) => i != currentHostIdx));
		if (hosts.length - 1) {
			setCurrentHostIdx(Math.max(0, currentHostIdx - 1));
		}
		else {
			setCurrentHostIdx(-1);
		}
	}

	function handleHostnameChange(event) {
		var value = event.target.value;
		setHosts(hosts.map((h, i) => i == currentHostIdx ? value : h));
	}

	function getOpenAthensDomain() {
		if (!toProxyScheme) return '';
		var match = toProxyScheme.match(/\/redirector\/([^?]+)/);
		return match ? match[1] : '';
	}
	function _renderProxyInput() {
		return (
			<div className="proxy-grid">
				<label htmlFor="to-proxy-scheme-input">{Zotero.getString('preferences_proxySettings_loginURLScheme')}</label>
				<input id="to-proxy-scheme-input" style={{flexGrow: "1"}} type="text" name="toProxyScheme" onChange={handleSchemeChange} value={toProxyScheme || ""} ref={toProxyInputRef}/>
				<label htmlFor="to-proper-scheme-input">{Zotero.getString('preferences_proxySettings_proxiedURLScheme')}</label>
				<input id="to-proper-scheme-input" style={{flexGrow: "1"}} type="text" name="toProperScheme" onChange={handleSchemeChange} value={toProperScheme || ""}/>
			</div>
		)
	}

	function _renderOpenAthensInput() {
		return (
			<div className="proxy-grid">
				<label htmlFor="openathens-domain-input">{Zotero.getString('preferences_proxySettings_openAthensDomain')}</label>
				<input id="openathens-domain-input" style={{flexGrow: "1"}} type="text" name="openathensDomain" onChange={handleOpenAthensDomainChange} value={getOpenAthensDomain() || ""} placeholder="yourinstitution.ac.uk"/>
			</div>
		)
	}

	return (
		<div className="group" style={{marginTop: "10px"}}>
			<p>
				<label><input type="radio" name="proxyType" value="ezproxy" checked={!isOpenAthens} onChange={handleTypeChange}/>{Zotero.getString('preferences_proxySettings_urlRewritingProxy')}</label>
				<label><input type="radio" name="proxyType" value="openathens" checked={isOpenAthens} onChange={handleTypeChange}/>{Zotero.getString('preferences_proxySettings_openAthens')}</label>
			</p>

			{multiHost && !isOpenAthens &&
				<p>
					<label><input type="checkbox" name="autoAssociate" onChange={handleCheckboxChange} checked={autoAssociate}/>&nbsp;{Zotero.getString('preferences_proxySettings_autoAssociate')}</label>
				</p>
			}
			{isOpenAthens ? _renderOpenAthensInput() : _renderProxyInput()}

			{error && <p style={{color: "red"}}>{Zotero.getString(error[0], error.slice(1))}</p>}

			{!isOpenAthens &&
				<p>
					{Zotero.getString('preferences_proxySettings_variables')}<br/>
					{Zotero.getString('preferences_proxySettings_variableHost')}<br/>
					{Zotero.getString('preferences_proxySettings_variablePath')}<br/>
					{Zotero.getString('preferences_proxySettings_variableURL')}
				</p>
			}
			
			<div style={{display: "flex", flexDirection: "column", marginTop: "10px"}}>
				<label htmlFor="proxies-host-select">{Zotero.getString('preferences_proxySettings_hostnames')}</label>
				<select id="proxies-host-select" className="Preferences-Proxies-hostSelect" size="8" multiple
						value={[currentHostIdx != -1 ? currentHostIdx : '']}
						onChange={handleHostSelectChange}>
					{hosts.map((host, i) =>
						<option key={i} value={i}>{host}</option>)}
				</select>
				<p>
					<input style={{minWidth: "80px", marginRight: "10px"}} type="button" onClick={handleAddHost} value="+" aria-label={Zotero.getString('preferences_proxySettings_addHostname')}/>
					<input style={{minWidth: "80px", marginRight: "10px"}} type="button" onClick={handleRemoveHost} disabled={disableRemoveHost} value="-" aria-label={Zotero.getString('preferences_proxySettings_removeHostname')}/>
				</p>
				
				<p style={{display: currentHostIdx === -1 ? 'none' : 'flex'}}>
					<label>{Zotero.getString('preferences_proxySettings_hostname')}
						<input style={{flexGrow: '1'}}
							type="text"
							value={hosts[currentHostIdx] || ""}
							onChange={handleHostnameChange} ref={hostInputRef}/>
					</label>
				</p>
			</div>
		</div>
	);
};


Zotero_Preferences.Components.Proxies = function Proxies(props) {
	const [proxies, setProxies] = React.useState(() =>
		Zotero.Prefs.get('proxies.proxies').map((proxy) => {
			proxy.toProperScheme = proxy.toProperScheme || proxy.scheme;
			return proxy;
		})
	);
	const [currentProxyIdx, setCurrentProxyIdx] = React.useState(-1);

	function onProxyChange(updatedProxy) {
		setProxies((prev) => prev.map((p, i) => i == currentProxyIdx ? updatedProxy : p));
	}

	function handleProxySelectChange(event) {
		var target = event.target;
		setCurrentProxyIdx(proxies.findIndex(p => p.id == target.value));
	}

	function handleProxyAdd() {
		setProxies((prev) => prev.concat([{
			id: Date.now(),
			toProxyScheme: 'https://www.example.com/login?qurl=%u',
			toProperScheme: '%h.example.com/%p',
			autoAssociate: true,
			hosts: []
		}]));
		setCurrentProxyIdx(proxies.length);
	}

	function handleProxyRemove() {
		if (currentProxyIdx == -1 || !proxies[currentProxyIdx]) return;
		let proxyToRemove = proxies[currentProxyIdx];
		setProxies((prev) => prev.filter((p, i) => i != currentProxyIdx));
		setCurrentProxyIdx(proxies.length > 1 ? Math.max(0, currentProxyIdx - 1) : -1);
		Zotero.Proxies.remove(proxyToRemove);
	}

	let canRemoveProxy = currentProxyIdx != -1 && !!proxies[currentProxyIdx];

	return (
		<div style={{display: "flex", flexDirection: "column"}}>
			<select id="proxies-proxy-select" className="Preferences-Proxies-proxySelect" size="8" multiple
					value={[canRemoveProxy ? proxies[currentProxyIdx].id : '']}
					onChange={handleProxySelectChange}
					disabled={!props.transparent}>
				{proxies.length && proxies.map((proxy, i) => {
					return <option key={i} value={proxy.id}>{proxy.toProxyScheme || proxy.toProperScheme}</option>;
				})}
			</select>
			<p style={{display: props.transparent ? null : 'none'}}>
				<input style={{minWidth: "80px", marginRight: "10px"}} type="button" onClick={handleProxyAdd} value="+" aria-label={Zotero.getString('preferences_proxySettings_addProxy')}/>
				<input style={{minWidth: "80px", marginRight: "10px"}} type="button" onClick={handleProxyRemove} disabled={!canRemoveProxy} value="-" aria-label={Zotero.getString('preferences_proxySettings_removeProxy')}/>
			</p>
			
			<Zotero_Preferences.Components.ProxyDetails
				transparent={props.transparent}
				proxy={proxies[currentProxyIdx]}
				onProxyChange={onProxyChange}
			/>
		</div>
	);
};


window.addEventListener("load", Zotero_Preferences.init, false);
