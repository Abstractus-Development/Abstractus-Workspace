Zotero.HostPermissions = new function() {
	const LOCALHOST_DOMAIN = '127.0.0.1';
	const REPOSITORY_DOMAIN = 'repo.zotero.org';
	const DOMAIN_CONFIG = {
		[LOCALHOST_DOMAIN]: {
			origin: 'http://127.0.0.1/*',
			message: 'permissions_siteAccess_message_localhost_required'
		},
		[REPOSITORY_DOMAIN]: {
			origin: 'https://repo.zotero.org/*',
			message: 'permissions_siteAccess_message_repo_required'
		}
	};

	this._permissionsPromptDisplayed = false;
	this._localhostPromptDisplayed = false;
	this._repoPromptDisplayed = false;
	this.localhostRequestBlocked = false;
	this.permissionsGrantedAt = 0;

	let promptQueues = new Map();
	let knownPermissions = null;

	async function hasPermission(domain) {
		const config = DOMAIN_CONFIG[domain];
		if (!config) throw new Error(`Unknown host-permission domain ${domain}`);
		return browser.permissions.contains({ origins: [config.origin] });
	}
	this.hasPermission = hasPermission;

	async function updateTrackedPermissions() {
		const current = {
			localhost: await hasPermission(LOCALHOST_DOMAIN),
			allHosts: await browser.permissions.contains({ origins: ["https://*/*"] })
		};
		if (knownPermissions
				&& ((current.localhost && !knownPermissions.localhost)
				|| (current.allHosts && !knownPermissions.allHosts))) {
			Zotero.HostPermissions.permissionsGrantedAt = Date.now();
			if (current.localhost) {
				Zotero.HostPermissions.localhostRequestBlocked = false;
			}
		}
		knownPermissions = current;
	}
	if (Zotero.isSafari) {
		updateTrackedPermissions();
		setInterval(updateTrackedPermissions, 15e3);
	}

	browser.permissions.onAdded?.addListener(() => {
		this.permissionsGrantedAt = Date.now();
	});

	Zotero.Messaging.addMessageListener('reinjectGuard.shouldReload', async () => {
		if (Date.now() - this.permissionsGrantedAt < 60e3) return true;
		await updateTrackedPermissions();
		return Date.now() - this.permissionsGrantedAt < 60e3;
	});

	this.prompt = async function(options={}, tab) {
		if (!Zotero.isSafari) return false;

		let key = tab?.id ?? null;
		let queue = promptQueues.get(key) || Promise.resolve();
		let promise = queue.then(() => showPrompt(options, tab));
		let tail = promise.then(() => {}, () => {});
		promptQueues.set(key, tail);
		tail.then(() => {
			if (promptQueues.get(key) === tail) {
				promptQueues.delete(key);
			}
		});
		return promise;
	}

	async function showPrompt({domains=[], recommendAllHosts=false, nativePromptToFollow=false}={}, tab) {
		const permissionChecks = domains.map(domain => hasPermission(domain));
		if (recommendAllHosts) {
			permissionChecks.push(browser.permissions.contains({ origins: ["https://*/*"] }));
		}
		const results = await Promise.all(permissionChecks);
		const missingDomains = domains.filter((domain, index) => !results[index]);
		const missingAllHosts = recommendAllHosts && !results[results.length - 1];
		if (!missingDomains.length) {
			if (!missingAllHosts) return false;
			if (Zotero.Prefs.get('suppressAllHostsRecommendation')) return false;
		}

		let message = missingDomains
			.map(domain => Zotero.getString(DOMAIN_CONFIG[domain].message))
			.join('');
		let connectorName = Zotero.getString('appConnector', ZOTERO_CONFIG.CLIENT_NAME);
		let domainList = new Intl.ListFormat(browser.i18n.getUILanguage(), { type: 'conjunction' })
			.format(missingDomains.map(domain => `<b>${domain}</b>`));
		if (nativePromptToFollow && missingDomains.length) {
			message += Zotero.getString("permissions_siteAccess_message_nativePrompt_safari");
			if (missingAllHosts) {
				message += Zotero.getString("permissions_siteAccess_message_allHosts_nativePrompt_safari");
			}
		}
		else if (missingDomains.length && missingAllHosts) {
			message += Zotero.getString("permissions_siteAccess_message_safari_functionality");
			message += Zotero.getString(
				"permissions_siteAccess_message_domains_allHosts_safari",
				[connectorName, domainList]
			);
		}
		else if (missingDomains.length) {
			message += Zotero.getString(
				missingDomains.length > 1
					? "permissions_siteAccess_message_domains_safari"
					: "permissions_siteAccess_message_domain_safari",
				[connectorName, domainList]
			);
		}
		else {
			message += Zotero.getString("permissions_siteAccess_message_safari_functionality");
			message += Zotero.getString("permissions_siteAccess_message_safari", connectorName);
		}

		const recommendationOnly = !missingDomains.length;
		let response = await Zotero.Messaging.sendMessage('confirm', {
			title: Zotero.getString(recommendationOnly
				? "permissions_siteAccess_recommendation_title"
				: "permissions_siteAccess_title"),
			button2Text: "",
			message,
			checkbox: recommendationOnly,
			checkboxText: Zotero.getString("general_dontShowAgain")
		}, tab);
		if (recommendationOnly && response && response.checkboxChecked) {
			Zotero.Prefs.set('suppressAllHostsRecommendation', true);
		}
		return true;
	}

	this.onPageLoad = async function(tab) {
		if (!Zotero.isSafari || this._permissionsPromptDisplayed) return;
		this._permissionsPromptDisplayed = true;
		let markLocalhostPromptShown = false;
		let markRepoPromptShown = false;

		try {
			const hasLocalhostPermission = await hasPermission(LOCALHOST_DOMAIN);
			const showLocalhostPrompt = !hasLocalhostPermission && !this._localhostPromptDisplayed;

			if (showLocalhostPrompt) {
				this._localhostPromptDisplayed = true;
				markLocalhostPromptShown = true;
			}
			await this.prompt({
				domains: showLocalhostPrompt ? [LOCALHOST_DOMAIN] : [],
				recommendAllHosts: true,
				nativePromptToFollow: showLocalhostPrompt
			}, tab);

			let localhostAllowed = hasLocalhostPermission;
			let zoteroOnline = null;
			if (showLocalhostPrompt) {
				try {
					await Zotero.Connector.ping({}, {
						active: true,
						permissionPromptShown: true
					}, tab);
					zoteroOnline = true;
				}
				catch (e) {
					zoteroOnline = false;
				}
				localhostAllowed = await hasPermission(LOCALHOST_DOMAIN);
			}
			else if (localhostAllowed) {
				zoteroOnline = await Zotero.Connector.checkIsOnline();
			}

			if (localhostAllowed && zoteroOnline === false && !this._repoPromptDisplayed) {
				this._repoPromptDisplayed = true;
				markRepoPromptShown = true;
				await this.prompt({domains: [REPOSITORY_DOMAIN]}, tab);
			}
		}
		catch (e) {
			if (markLocalhostPromptShown) this._localhostPromptDisplayed = false;
			if (markRepoPromptShown) this._repoPromptDisplayed = false;
			this._permissionsPromptDisplayed = false;
			Zotero.debug('Error checking host permissions: ' + e.message);
		}
	}

	this.checkChromiumActionPermissions = async function(tab) {
		if (!Zotero.isChromium) return true;

		try {
			const hasPermissions = await browser.permissions.contains({
				origins: ["https://*/*"]
			});
			if (hasPermissions) return true;

			const result = await Zotero.Messaging.sendMessage('confirm', {
				title: Zotero.getString("permissions_siteAccess_title"),
				button1Text: Zotero.getString("permissions_siteAccess_openPreferences"),
				button2Text: Zotero.getString("general_cancel"),
				button3Text: Zotero.getString("general_continueAnyway"),
				message: Zotero.getString("permissions_siteAccess_message_intro")
					+ Zotero.getString("permissions_siteAccess_message")
			}, tab);
			if (result?.button === 1) {
				browser.tabs.create({
					url: `about:extensions/?id=${browser.runtime.id}`
				});
			}
			return result?.button === 3;
		}
		catch (e) {
			Zotero.debug('Error checking Chromium permissions: ' + e.message);
			return true;
		}
	}
}
