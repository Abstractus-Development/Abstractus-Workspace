// Abstractus: sites the extension never touches, and the narrow set automatic retrieval may open.
// Pure functions, no browser APIs. Matching is always on the PARSED hostname, never on substrings.
//
// Layer 1 (blocklist): no content scripts, no translators, no saves, nothing sent to the desktop.
//   Enforced three ways: manifest exclude_matches (generated from BLOCKED_DOMAINS and friends by
//   the build), the background guard (messaging, save, attachment fetch), and the retrieval queue.
// Layer 2 (allowlist): only for AUTOMATIC retrieval. Manual saves are unaffected except by Layer 1.
(function (root) {
	// ---------------- Layer 1: the blocklist (single source of truth) ----------------

	// Every entry blocks the host itself and all of its subdomains. One line per category says what is
	// blocked and why; the preferences page and the toolbar notice are generated from these.
	const BLOCKED_DOMAINS = {
		// Sign-in pages: credentials and session cookies must never pass through the extension.
		'Auth and single sign-on': [
			'accounts.google.com', 'myaccount.google.com', 'accounts.youtube.com',
			'login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'account.microsoft.com',
			'okta.com', 'oktapreview.com', 'okta-emea.com', 'auth0.com',
			'appleid.apple.com', 'idmsa.apple.com', 'id.atlassian.com', 'login.salesforce.com',
			'signin.aws.amazon.com', 'accounts.firefox.com', 'duosecurity.com', 'onelogin.com',
			'pingidentity.com', 'pingone.com', 'login.gov'
		],
		// Personal mail: private correspondence, often with health or account details.
		'Email and webmail': [
			'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.com',
			'mail.yahoo.com', 'login.yahoo.com', 'mail.proton.me', 'account.proton.me', 'protonmail.com',
			'mail.aol.com', 'mail.zoho.com', 'fastmail.com', 'tuta.com', 'tutanota.com', 'mail.ru'
		],
		// Money: account numbers, balances and card details.
		'Banking, payments and finance': [
			// payments and brokers
			'paypal.com', 'paypal.me', 'stripe.com', 'wise.com', 'venmo.com', 'cash.app', 'squareup.com',
			'braintreegateway.com', 'braintreepayments.com', 'adyen.com', 'klarna.com', 'payoneer.com',
			'zellepay.com', 'revolut.com', 'monzo.com', 'chime.com',
			'skrill.com', 'neteller.com', 'afterpay.com', 'affirm.com', 'sezzle.com', 'zip.co',
			'schwab.com', 'fidelity.com', 'vanguard.com', 'etrade.com', 'robinhood.com', 'interactivebrokers.com',
			'coinbase.com', 'binance.com', 'kraken.com', 'intuit.com', 'turbotax.com',
			// United States and Canada
			'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'capitalone.com',
			'usbank.com', 'pnc.com', 'tdbank.com', 'truist.com', 'ally.com', 'discover.com', 'americanexpress.com',
			'rbc.com', 'rbcroyalbank.com', 'td.com', 'scotiabank.com', 'bmo.com',
			'cibc.com', 'desjardins.com', 'tangerine.ca',
			// United Kingdom and Switzerland
			'hsbc.com', 'hsbc.co.uk', 'barclays.co.uk', 'lloydsbank.com', 'natwest.com', 'santander.com',
			'santander.co.uk', 'nationwide.co.uk', 'halifax.co.uk', 'starlingbank.com', 'ubs.com', 'credit-suisse.com',
			// euro area and Nordics
			'ing.com', 'ing.nl', 'ing.de', 'ing.be', 'ing.es', 'ing.fr', 'ing.it', 'ing.pl', 'ing.ro', 'ing.lu', 'ing.at',
			'ing.com.au', 'ing.com.tr',
			'db.com', 'deutsche-bank.de', 'commerzbank.de', 'commerzbank.com', 'hypovereinsbank.de',
			'bnpparibas.com', 'bnpparibas.fr', 'bnpparibasfortis.be', 'societegenerale.com', 'societegenerale.fr',
			'credit-agricole.fr', 'credit-agricole.com', 'unicredit.it', 'intesasanpaolo.com',
			'bbva.com', 'bbva.es', 'caixabank.com', 'caixabank.es', 'bancosantander.es', 'santander.de', 'santander.pl',
			'santander.pt', 'abnamro.nl', 'abnamro.com', 'rabobank.nl', 'rabobank.com',
			'nordea.com', 'nordea.fi', 'nordea.se', 'nordea.dk', 'nordea.no', 'danskebank.com', 'danskebank.dk',
			'seb.se', 'swedbank.se', 'swedbank.com', 'handelsbanken.se', 'handelsbanken.com',
			'kbc.be', 'kbc.com', 'erstegroup.com', 'erstebank.at', 'sparkasse.at', 'n26.com', 'bunq.com',
			// Australia and New Zealand
			'commbank.com.au', 'westpac.com.au', 'westpac.co.nz', 'anz.com', 'anz.com.au', 'anz.co.nz', 'nab.com.au',
			'asb.co.nz',
			// Asia (HSBC national sites included)
			'sbi.co.in', 'onlinesbi.sbi', 'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'kotak.com',
			'mufg.jp', 'smbc.co.jp', 'mizuhobank.co.jp', 'dbs.com', 'dbs.com.sg', 'dbs.com.hk', 'ocbc.com', 'uob.com.sg',
			'sc.com', 'bankofchina.com', 'boc.cn', 'icbc.com.cn', 'icbc-ltd.com', 'ccb.com',
			'hsbc.ca', 'hsbc.com.hk', 'hsbc.com.au', 'hsbc.com.cn', 'hsbc.com.sg', 'hsbc.co.in', 'hsbc.com.mx',
			'hsbc.fr', 'hsbc.de', 'hsbc.ae', 'hsbc.com.my',
			// Brazil and Mexico
			'itau.com.br', 'bradesco.com.br', 'bb.com.br', 'nubank.com.br', 'nu.com.mx', 'bbva.mx', 'santander.com.mx',
			'santander.com.br', 'banorte.com'
		],
		// Secrets: every stored password.
		'Password managers and vaults': [
			'1password.com', '1password.eu', '1password.ca', 'bitwarden.com', 'bitwarden.eu', 'lastpass.com',
			'dashlane.com', 'keepersecurity.com', 'nordpass.com', 'roboform.com'
		],
		// Admin consoles: keys, servers and user data.
		'Cloud consoles and admin': [
			'console.aws.amazon.com', 'portal.azure.com', 'console.cloud.google.com', 'console.firebase.google.com',
			'admin.google.com', 'admin.microsoft.com', 'entra.microsoft.com', 'dashboard.render.com',
			'dash.cloudflare.com', 'cloud.digitalocean.com', 'dashboard.heroku.com',
			'console.anthropic.com', 'platform.openai.com'
		],
		// Code hosting and app hosting: tokens, private repos and deploy secrets. Blocked on the whole site.
		'Code hosting and app deployment': [
			'github.com', 'gist.github.com', 'githubusercontent.com', 'github.io', 'githubassets.com',
			'gitlab.com', 'gitlab.io', 'bitbucket.org', 'vercel.com', 'vercel.app', 'supabase.com', 'supabase.co',
			'netlify.app', 'netlify.com', 'pages.dev', 'workers.dev', 'glitch.me', 'replit.com', 'repl.co',
			'codepen.io', 'jsfiddle.net', 'codesandbox.io', 'herokuapp.com'
		],
		// Institution sign-in and federation: university credentials. Login pages only, never the publisher
		// pages reached through a library proxy.
		'University and library sign-in': [
			'login.openathens.net', 'my.openathens.net', 'wayf.openathens.net', 'connect.openathens.net',
			'shibboleth.net', 'incommon.org', 'wayf.incommonfederation.org', 'eduroam.org'
		],
		// Clinical-trial systems: subject-level data, safety cases and ethics-board files.
		'Patient data: trials, safety and ethics boards': [
			'mdsol.com', 'imedidata.com', 'veevavault.com', 'login.veeva.com', 'openclinica.io', 'openclinica.com',
			'castoredc.com', 'medrio.com', 'viedoc.net', 'viedoc.com', 'clario.com', 'ert.com', 'bioclinica.com',
			'signanthealth.com', 'florencehc.com', 'suvoda.com',
			'arisglobal.com',
			'advarra.com', 'wcgirb.com', 'wcgclinical.com', 'irbnet.org'
		],
		// Health records, patient portals and telehealth: protected health information.
		'Patient data: health records and portals': [
			'mychart.com', 'followmyhealth.com', 'healow.com', 'patientportal.athenahealth.com', 'myuhc.com',
			'mycigna.com', 'kp.org',
			'epic.com', 'cerner.com', 'cernerworks.com', 'athenahealth.com', 'eclinicalworks.com', 'nextgen.com',
			'veradigm.com', 'allscripts.com', 'meditech.com', 'practicefusion.com', 'drchrono.com', 'kareo.com',
			'tebra.com', 'simplepractice.com', 'doxy.me', 'teladoc.com', 'amwell.com',
			'patient.labcorp.com', 'myquest.questdiagnostics.com', 'nhsapp.service.nhs.uk', 'patientaccess.com'
		],
		// Regulator submission portals (sponsor and authority sign-in); the public data pages stay open.
		'Patient data: regulatory submission portals': [
			'register.clinicaltrials.gov', 'register.ema.europa.eu', 'esg.fda.gov', 'eudravigilance.ema.europa.eu',
			'iris.ema.europa.eu', 'submissions.mhra.gov.uk'
		],
		// Where trial and patient files are shared: documents, chat, calls and boards.
		'Team files and messaging': [
			'drive.google.com', 'docs.google.com', 'sharepoint.com', 'onedrive.live.com', '1drv.ms', 'dropbox.com',
			'box.com', 'egnyte.com', 'slack.com', 'teams.microsoft.com', 'zoom.us', 'webex.com', 'notion.so',
			'notion.site', 'airtable.com', 'smartsheet.com', 'monday.com', 'asana.com', 'atlassian.net', 'trello.com'
		],
		// Our own sites.
		'Our own properties': ['abstractus.ai'],
		// Private networks: intranets, routers and cloud metadata.
		'Local and private network': [
			'localhost', 'local', 'internal', 'lan', 'home.arpa', 'intranet', 'corp', 'localdomain', 'home'
		],
		// Pastebins, link shorteners and anonymous file drops: content of unknown ownership.
		'Paste, shortener and anonymous hosting': [
			'pastebin.com', 'paste.ee', 'hastebin.com', 'ghostbin.com', 'ghostbin.co', 'dpaste.org', 'dpaste.com',
			'rentry.co', 'justpaste.it', 'controlc.com', 'privatebin.net', 'ix.io', 'termbin.com', '0x0.st', 'pastes.io',
			'bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'v.gd', 'rb.gy', 'ow.ly', 'buff.ly', 'cutt.ly', 'tiny.cc',
			'shorturl.at', 'goo.gl',
			'transfer.sh', 'file.io', 'anonfiles.com', 'bayfiles.com', 'gofile.io', 'catbox.moe', 'wetransfer.com'
		]
	};

	// One line per category: why the extension stays off.
	const BLOCK_REASONS = {
		'Auth and single sign-on': 'Sign-in pages: passwords and session cookies.',
		'Email and webmail': 'Personal mail.',
		'Banking, payments and finance': 'Banks and payment services: accounts and card details.',
		'Password managers and vaults': 'Stored passwords.',
		'Cloud consoles and admin': 'Admin consoles: keys, servers and user data.',
		'Code hosting and app deployment': 'Code hosts and app hosting: tokens, private repositories and deploy secrets.',
		'University and library sign-in': 'University and library sign-in pages (login pages only).',
		'Patient data: trials, safety and ethics boards': 'Clinical-trial, safety and ethics-board systems: subject-level data.',
		'Patient data: health records and portals': 'Health records, patient portals and telehealth: protected health information.',
		'Patient data: regulatory submission portals': 'Regulator submission portals (public data pages stay open).',
		'Team files and messaging': 'Shared files, chat, calls and boards where trial and patient files live.',
		'Our own properties': 'Our own sites.',
		'Local and private network': 'Your network: intranets, routers and local services.',
		'Paste, shortener and anonymous hosting': 'Pastebins, link shorteners and anonymous file drops.'
	};

	// Blocked only under a path (the rest of the host is ordinary). Path matches on whole segments.
	const BLOCKED_PATHS = [
		{host: 'proton.me', paths: ['/mail', '/pass', '/drive'], category: 'Email and webmail'},
		{host: 'icloud.com', paths: ['/mail'], category: 'Email and webmail'},
		{host: 'www.icloud.com', paths: ['/mail'], category: 'Email and webmail'},
		// CTIS sponsor and authority workspaces; the public search (/search-for-clinical-trials, /ctis-public) is open.
		{host: 'euclinicaltrials.eu', paths: ['/ct-sponsor-services', '/ct-authority-services'],
			category: 'Patient data: regulatory submission portals'}
	];

	// Blocked under these paths on ANY host (single-sign-on endpoints and REDCap installs).
	const BLOCKED_ANY_HOST_PATHS = [
		{paths: ['/Shibboleth.sso', '/idp/profile', '/cas/login', '/adfs/ls', '/saml2'], category: 'University and library sign-in'},
		{paths: ['/redcap'], category: 'Patient data: trials, safety and ethics boards'}
	];

	// Hostname FIRST label that marks a login, webmail or banking front end (login.example.org, mail.example.org).
	// Labels with a category in LABEL_CATEGORY_NEW only count on hosts with three or more labels, so a bare
	// "cas.org" or "saml.org" is not caught.
	const FIRST_LABEL_RULES = {
		'Email and webmail': ['mail', 'webmail'],
		'Auth and single sign-on': ['login', 'signin', 'sso', 'auth', 'accounts'],
		'Banking, payments and finance': ['bank', 'banking', 'onlinebanking', 'ebanking'],
		'Patient data: health records and portals': ['mychart', 'patientportal'],
		'Password managers and vaults': ['vault', 'passwords']
	};
	const FIRST_LABEL_RULES_3PLUS = {
		'University and library sign-in': ['idp', 'shibboleth', 'cas', 'weblogin', 'wayf', 'saml', 'adfs', 'sts'],
		'Patient data: health records and portals': ['epiccare'],
		'Patient data: trials, safety and ethics boards': ['redcap', 'irb']
	};
	const BLOCKED_FIRST_LABELS = [].concat(...Object.values(FIRST_LABEL_RULES));
	const BLOCKED_FIRST_LABELS_3PLUS = [].concat(...Object.values(FIRST_LABEL_RULES_3PLUS));
	// Any label in the hostname (mychart.example.org, example.mychart.com, mychart.hospital.org).
	const BLOCKED_ANY_LABELS = ['mychart'];
	// EZproxy login pages (/login?url=, /login?qurl=) on hosts with an "ezproxy" label. The proxy's content
	// hosts are not login pages and stay open.
	const EZPROXY_LOGIN = {category: 'University and library sign-in'};

	const BLOCKED_CATEGORIES = Object.keys(BLOCKED_DOMAINS);

	// ---------------- hostname handling ----------------

	// Parse with the same URL parser the browser uses, so userinfo, backslashes, case, IDNs (punycode),
	// decimal/hex/octal IPv4 and IPv6 are normalised the way the browser itself reads them.
	// Returns {url, host, hostname} or null. host: lower case, no trailing dots, IPv6 without brackets.
	function parse(raw) {
		let u;
		try { u = new URL(String(raw)); }
		catch { return null; }
		let host = u.hostname.toLowerCase();
		if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
		host = host.replace(/\.+$/, '');
		return {url: u, host, ipv6: host.includes(':')};
	}

	// "localhost." / "LOCALHOST" / "user@host" style input, as a bare hostname. '' if unparseable.
	function normalizeHost(raw) {
		raw = String(raw || '').trim();
		if (!raw) return '';
		const p = parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw);
		return p ? p.host : '';
	}

	function isIPv4(host) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(host); }

	function ipv4Private(host) {
		const [a, b] = host.split('.').map(Number);
		return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
			|| (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
	}

	// Expand an IPv6 literal (already normalised by URL) into 8 numbers, or null.
	function ipv6Groups(host) {
		let h = host.toLowerCase().split('%')[0];
		let tailV4 = null;
		const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(h);
		if (m) {
			const o = m[2].split('.').map(Number);
			if (o.some(n => n > 255)) return null;
			tailV4 = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
			h = m[1] + '0:0';
		}
		const halves = h.split('::');
		if (halves.length > 2) return null;
		const left = halves[0] ? halves[0].split(':') : [];
		const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
		let groups;
		if (halves.length === 2) {
			const fill = 8 - left.length - right.length;
			if (fill < 1) return null;
			groups = left.concat(Array(fill).fill('0'), right);
		}
		else groups = left;
		if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
		const nums = groups.map(g => parseInt(g, 16));
		if (tailV4) { nums[6] = tailV4[0]; nums[7] = tailV4[1]; }
		return nums;
	}

	function ipv6Private(host) {
		const g = ipv6Groups(host);
		if (!g) return true; // cannot read it: treat as blocked
		if (g.every(n => n === 0)) return true; // ::
		if (g.slice(0, 7).every(n => n === 0) && g[7] === 1) return true; // ::1
		if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
		if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
		if ((g[0] & 0xff00) === 0xff00) return true; // multicast
		// IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96)
		const mapped = g.slice(0, 5).every(n => n === 0) && (g[5] === 0xffff || g[5] === 0);
		const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(n => n === 0);
		if (mapped || nat64) return ipv4Private([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.'));
		return false;
	}

	function isPrivateHost(host) {
		if (!host) return true;
		if (host.includes(':')) return ipv6Private(host);
		if (isIPv4(host)) return ipv4Private(host);
		return false;
	}

	function inDomains(host, domains) {
		for (const d of domains) if (host === d || host.endsWith('.' + d)) return true;
		return false;
	}

	const ALL_DOMAINS = [].concat(...Object.values(BLOCKED_DOMAINS));

	function categoryOfDomain(host) {
		for (const [category, domains] of Object.entries(BLOCKED_DOMAINS)) if (inDomains(host, domains)) return category;
		return '';
	}

	// The one rule engine: {reason, category} for a bare hostname plus optional path and query.
	// reason is a short code ('' when allowed). opts.navigation: the retrieval queue is following a hop of
	// its own paper, so an EZproxy login page is not refused as a destination (it is still never read or saved).
	function classify(host, pathname, search, opts) {
		const hit = (reason, category) => ({reason, category: category || ''});
		if (!host) return hit('unparseable');
		if (host.includes(':')) return ipv6Private(host) ? hit('private_address', 'Local and private network') : hit('');
		if (isIPv4(host)) return ipv4Private(host) ? hit('private_address', 'Local and private network') : hit('');
		if (!host.includes('.')) return hit('private_name', 'Local and private network'); // single-label intranet name
		if (/[^a-z0-9.\-_]/.test(host)) return hit('unparseable'); // URL left something odd in the host
		if (inDomains(host, ALL_DOMAINS)) return hit('blocked_domain', categoryOfDomain(host));
		const labels = host.split('.');
		for (const [category, list] of Object.entries(FIRST_LABEL_RULES)) {
			if (list.includes(labels[0])) return hit('blocked_label', category);
		}
		if (labels.length >= 3) {
			for (const [category, list] of Object.entries(FIRST_LABEL_RULES_3PLUS)) {
				if (list.includes(labels[0])) return hit('blocked_label', category);
			}
		}
		if (labels.some(l => BLOCKED_ANY_LABELS.includes(l))) return hit('blocked_label', 'Patient data: health records and portals');
		if (pathname !== undefined) {
			const path = String(pathname).toLowerCase().replace(/\/+/g, '/');
			for (const rule of BLOCKED_PATHS) {
				if (host !== rule.host) continue;
				if (rule.paths.some(p => path === p || path.startsWith(p + '/'))) return hit('blocked_path', rule.category);
			}
			for (const rule of BLOCKED_ANY_HOST_PATHS) {
				if (rule.paths.some(p => { p = p.toLowerCase(); return path === p || path.startsWith(p + '/') || path.startsWith(p + '.'); })) {
					return hit('blocked_path', rule.category);
				}
			}
			if (!(opts && opts.navigation) && labels.some(l => l.includes('ezproxy')) && (path === '/login' || path.startsWith('/login/'))
				&& /(^|[?&])(url|qurl)=/i.test(String(search || ''))) {
				return hit('blocked_path', EZPROXY_LOGIN.category);
			}
		}
		return hit('');
	}

	// Why a bare hostname (plus optional path) is blocked: a short code, or '' if it is not.
	function blockReasonForHost(host, pathname, search, opts) {
		return classify(host, pathname, search, opts).reason;
	}

	// '' when allowed, otherwise a reason code. Only http(s) pages are ever worked on; file:, data:,
	// blob:, javascript:, ftp: and anything unparseable are blocked.
	function blockReason(raw, opts) {
		const p = parse(raw);
		if (!p) return 'unparseable';
		const proto = p.url.protocol;
		if (proto === 'file:') return 'file_url';
		if (proto !== 'http:' && proto !== 'https:') return 'not_web';
		return blockReasonForHost(p.host, p.url.pathname, p.url.search, opts);
	}

	// The category name for a blocked URL (shown on the toolbar), or '' when it is not blocked.
	function categoryFor(raw) {
		const p = parse(raw);
		if (!p) return '';
		if (p.url.protocol !== 'http:' && p.url.protocol !== 'https:') return '';
		return classify(p.host, p.url.pathname, p.url.search).category;
	}

	// The whole list for display, generated from the data above: [{category, reason, count, entries: [...]}].
	function describeBlocklist() {
		return BLOCKED_CATEGORIES.map(category => {
			const entries = BLOCKED_DOMAINS[category].slice();
			for (const [c, list] of Object.entries(FIRST_LABEL_RULES)) if (c === category) list.forEach(l => entries.push(l + '.*'));
			for (const [c, list] of Object.entries(FIRST_LABEL_RULES_3PLUS)) if (c === category) list.forEach(l => entries.push(l + '.*'));
			if (category === 'Patient data: health records and portals') entries.push('*.mychart.*');
			for (const rule of BLOCKED_PATHS) if (rule.category === category) rule.paths.forEach(p => entries.push(rule.host + p));
			for (const rule of BLOCKED_ANY_HOST_PATHS) if (rule.category === category) rule.paths.forEach(p => entries.push('any site: ' + p));
			if (category === EZPROXY_LOGIN.category) entries.push('ezproxy login pages');
			return {category, reason: BLOCK_REASONS[category] || '', count: entries.length, entries};
		});
	}

	// Following a hop of the paper's own chain (see classify).
	const NAV = {navigation: true};
	function isBlockedUrl(raw) { return blockReason(raw) !== ''; }
	function isBlockedHost(host) { return blockReasonForHost(normalizeHost(host)) !== ''; }

	const EXTENSION_SCHEME = /^(chrome-extension|moz-extension|safari-web-extension|extension):/i;
	const OPAQUE_FRAME = /^(about:(blank|srcdoc)|blob:|data:)/i;

	// The runtime guard. sender: a runtime.onMessage sender ({tab, url}). Returns '' to let the message
	// through, or a reason code to refuse it. Pages of this extension are not web pages and pass.
	// An extra veto (set by the retrieval queue) can also refuse a tab, see setTabVeto.
	let tabVeto = null;
	function setTabVeto(fn) { tabVeto = typeof fn === 'function' ? fn : null; }
	function senderBlocked(sender) {
		sender = sender || {};
		const tab = sender.tab;
		if (!tab) return ''; // an extension page with no tab (popup, offscreen, control window)
		const tabUrl = tab.url || '';
		if (EXTENSION_SCHEME.test(tabUrl)) return '';
		const why = blockReason(tabUrl);
		if (why) return why;
		if (sender.url && !EXTENSION_SCHEME.test(sender.url) && !OPAQUE_FRAME.test(sender.url)) {
			const frameWhy = blockReason(sender.url);
			if (frameWhy) return frameWhy;
		}
		if (tabVeto) { const veto = tabVeto(tab.id, tabUrl); if (veto) return veto; }
		return '';
	}

	// Desktop methods a web page's content script may reach through Connector.callMethod: the normal
	// save flow only. Everything else (unpair, retrieval/*, anything new) is for the background alone.
	const CONTENT_SCRIPT_METHODS = new Set(['ping', 'saveItems', 'saveSnapshot', 'saveAttachment',
		'saveStandaloneAttachment', 'updateSession', 'getSelectedCollection', 'getTranslators', 'getTranslatorCode',
		'detect', 'savePage', 'selectItems', 'getRecognizedItem', 'delaySync', 'hasAttachmentResolvers',
		'saveAttachmentFromResolver', 'getClientHostnames']);

	// messageName/args as received by the background; sender as in runtime.onMessage. Returns '' to allow,
	// or a reason. Senders that are extension pages (progress window, control window) are not content scripts.
	function contentCallDenied(messageName, args, sender) {
		if (messageName !== 'Connector.callMethod') return '';
		sender = sender || {};
		if (!sender.tab) return '';
		if (sender.url && EXTENSION_SCHEME.test(sender.url)) return '';
		const first = Array.isArray(args) ? args[0] : args;
		const method = typeof first === 'string' ? first : (first && typeof first === 'object' ? first.method : undefined);
		if (typeof method === 'string' && CONTENT_SCRIPT_METHODS.has(method)) return '';
		return 'method_not_allowed';
	}

	// The start URL the desktop hands the retrieval queue. https only, no credentials, and a start host that is
	// a DOI resolver, NCBI, Europe PMC or the user's library proxy. Returns '' when fine, else 'bad_start_url'.
	function startUrlProblem(raw, proxyHost) {
		const p = parse(raw);
		if (!p || p.url.protocol !== 'https:' || p.url.username || p.url.password) return 'bad_start_url';
		if (blockReason(raw, NAV)) return 'bad_start_url';
		const h = p.host;
		const proxy = proxyHost ? validateProxyHost(proxyHost) : null;
		const ok = h === 'doi.org' || h === 'dx.doi.org' || h === 'ncbi.nlm.nih.gov' || h.endsWith('.ncbi.nlm.nih.gov')
			|| h === 'europepmc.org' || (!!proxy && proxy.ok && (h === proxy.host || h.endsWith('.' + proxy.host)));
		return ok ? '' : 'bad_start_url';
	}

	// ---------------- manifest exclude_matches (generated, never hand-written) ----------------

	// Match patterns can say "this host and its subdomains" and "this path", nothing else. Rules they
	// cannot say (CIDR ranges, first-label rules such as mail.*, IPv6 literals, single-label names,
	// the mychart.* family, EZproxy login pages) are enforced by the runtime guard only.
	function manifestExcludeMatches() {
		const out = new Set();
		for (const d of ALL_DOMAINS) out.add('*://*.' + d + '/*');
		for (const rule of BLOCKED_PATHS) {
			for (const p of rule.paths) { out.add('*://' + rule.host + p); out.add('*://' + rule.host + p + '/*'); }
		}
		for (const rule of BLOCKED_ANY_HOST_PATHS) {
			for (const p of rule.paths) {
				for (const q of new Set([p, p.toLowerCase()])) { out.add('*://*' + q); out.add('*://*' + q + '/*'); }
			}
		}
		for (const ip of ['0.0.0.0', '127.0.0.1', '169.254.169.254', '192.168.0.1', '10.0.0.1']) out.add('*://' + ip + '/*');
		for (const l of BLOCKED_ANY_LABELS) out.add('*://*.' + l + '.com/*');
		return Array.from(out).sort();
	}

	// ---------------- Layer 2: allowlist for AUTOMATIC retrieval ----------------

	// Each entry allows the host and its subdomains.
	const KNOWN_SCHOLARLY_HOSTS = [
		'doi.org', 'dx.doi.org', 'linkinghub.elsevier.com', 'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov',
		'www.ncbi.nlm.nih.gov', 'europepmc.org', 'ebi.ac.uk', 'arxiv.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com',
		'researchsquare.com', 'preprints.org'
	];
	// Publisher PDF hosts the page classifier already treats as part of a publisher.
	const KNOWN_PDF_HOSTS = ['pdf.sciencedirectassets.com', 'sciencedirectassets.com', 'els-cdn.com'];
	// Shared hosting: landing here does not extend trust to the rest of the registrable domain.
	const SHARED_HOSTING = ['github.io', 'gitlab.io', 'blogspot.com', 'wordpress.com', 'herokuapp.com', 'netlify.app',
		'vercel.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com', 'azurewebsites.net',
		'cloudfront.net', 'amazonaws.com', 'googleusercontent.com', 'sharepoint.com', 'onrender.com', 'fly.dev'];

	const TWO_PART = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'edu.au', 'org.au', 'co.jp', 'ac.jp',
		'com.cn', 'edu.cn', 'co.nz', 'ac.nz', 'com.br', 'co.za', 'co.in', 'ac.in']);
	function registrable(host) {
		if (!host || host.includes(':') || isIPv4(host)) return '';
		const labels = host.split('.');
		if (labels.length < 2) return '';
		const last2 = labels.slice(-2).join('.');
		return TWO_PART.has(last2) && labels.length >= 3 ? labels.slice(-3).join('.') : last2;
	}

	// A library proxy host the user typed (EZproxy, OpenAthens): a real, public DNS name, nothing else.
	// Accepts "ezproxy.lib.edu" or a pasted URL. Returns {ok, host, error}.
	function validateProxyHost(input) {
		const raw = String(input || '').trim();
		if (!raw) return {ok: false, host: '', error: 'empty'};
		const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
		if (!/^https?:\/\//i.test(withScheme)) return {ok: false, host: '', error: 'scheme'};
		const p = parse(withScheme);
		if (!p) return {ok: false, host: '', error: 'unparseable'};
		if (p.url.username || p.url.password) return {ok: false, host: '', error: 'userinfo'};
		if (p.url.port) return {ok: false, host: '', error: 'port'};
		const host = p.host;
		if (p.ipv6 || isIPv4(host)) return {ok: false, host: '', error: 'ip_address'};
		const labels = host.split('.');
		if (labels.length < 2 || labels.some(l => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) {
			return {ok: false, host: '', error: 'not_a_hostname'};
		}
		if (host.length > 253 || !/[a-z]/.test(labels[labels.length - 1])) return {ok: false, host: '', error: 'not_a_hostname'};
		if (blockReasonForHost(host)) return {ok: false, host: '', error: 'blocked_site'};
		// A proxy host may not be a known shared-hosting suffix or a bare public suffix.
		if (inDomains(host, SHARED_HOSTING) || TWO_PART.has(host)) return {ok: false, host: '', error: 'too_broad'};
		return {ok: true, host, error: ''};
	}

	// The set of hosts one paper may touch. Built per paper; nothing leaks to the next one.
	// opts: {itemUrl, proxyHost}. The item URL (the DOI link) starts the chain.
	function createPaperGuard(opts) {
		opts = opts || {};
		const proxy = opts.proxyHost ? validateProxyHost(opts.proxyHost) : null;
		const proxyHost = proxy && proxy.ok ? proxy.host : '';
		const chain = new Set();          // exact hosts reached through this paper's own redirects
		const chainSites = new Set();     // their registrable domains (the landing site's own subdomains)
		let open = true;
		let violation = null;
		let last = '';                    // the most recent host the paper was let onto

		function addChain(host) {
			chain.add(host);
			const site = registrable(host);
			if (site && !inDomains(host, SHARED_HOSTING)) chainSites.add(site);
		}
		function known(host) {
			return inDomains(host, KNOWN_SCHOLARLY_HOSTS) || inDomains(host, KNOWN_PDF_HOSTS)
				|| (!!proxyHost && (host === proxyHost || host.endsWith('.' + proxyHost)));
		}
		function allowedHost(host) {
			if (known(host) || chain.has(host)) return true;
			const site = registrable(host);
			return !!site && chainSites.has(site) && !inDomains(host, SHARED_HOSTING);
		}

		// check(url, kind): kind is 'redirect' (a server hop), 'navigate' (script or link) or 'load'.
		// Returns {ok, reason: ''|'blocked_site'|'off_allowlist', domain}.
		function check(raw, kind) {
			const p = parse(raw);
			const domain = p ? p.host : '';
			const fail = reason => { if (!violation) violation = {reason, domain}; return {ok: false, reason, domain}; };
			if (!p) return fail('blocked_site');
			const why = blockReason(raw, NAV);
			if (why) return fail('blocked_site');
			if (p.url.username || p.url.password) return fail('off_allowlist');
			if (allowedHost(p.host)) { last = p.host; return {ok: true, reason: '', domain}; }
			// Until the first page has loaded, every server redirect hop of the paper's own chain is
			// allowed, and so is a client-side hand-off ("Redirecting...") made by a known host.
			if (open && (kind === 'redirect' || (known(last) && last))) { addChain(p.host); last = p.host; return {ok: true, reason: '', domain}; }
			return fail('off_allowlist');
		}

		// Would this URL be allowed right now? Changes nothing and records no violation.
		function peek(raw) {
			const p = parse(raw);
			if (!p || blockReason(raw, NAV) || p.url.username || p.url.password) return false;
			return open || allowedHost(p.host);
		}

		const start = opts.itemUrl ? check(opts.itemUrl, 'redirect') : {ok: false, reason: 'blocked_site', domain: ''};
		return {
			check,
			peek,
			start,
			// The landing page has loaded: from now on only the allowed set may be navigated to.
			seal() { open = false; },
			isOpen: () => open,
			violation: () => violation,
			hosts: () => Array.from(chain),
			proxyHost: () => proxyHost
		};
	}

	// The PDF-link step may only follow a link on the landing page's registrable domain, or a known PDF host.
	function pdfLinkAllowed(pageUrl, linkUrl) {
		const page = parse(pageUrl), link = parse(linkUrl);
		if (!page || !link || blockReason(linkUrl, NAV) || link.url.username || link.url.password) return false;
		const pd = registrable(page.host), ld = registrable(link.host);
		return !!ld && (ld === pd || inDomains(link.host, KNOWN_PDF_HOSTS) || ld === 'sciencedirect.com');
	}

	const api = {
		BLOCKED_DOMAINS, BLOCKED_PATHS, BLOCKED_ANY_HOST_PATHS, BLOCKED_FIRST_LABELS, BLOCKED_FIRST_LABELS_3PLUS, BLOCKED_ANY_LABELS,
		BLOCKED_CATEGORIES, BLOCK_REASONS, categoryFor, describeBlocklist,
		KNOWN_SCHOLARLY_HOSTS, KNOWN_PDF_HOSTS,
		parse, normalizeHost, isPrivateHost, blockReason, isBlockedUrl, isBlockedHost, manifestExcludeMatches, senderBlocked, setTabVeto, contentCallDenied, startUrlProblem, CONTENT_SCRIPT_METHODS,
		validateProxyHost, createPaperGuard, pdfLinkAllowed, registrable
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	if (root.Zotero) root.Zotero.SiteBlocklist = api;
	else root.AbstractusSiteBlocklist = api;
})(typeof self !== 'undefined' ? self : this);
