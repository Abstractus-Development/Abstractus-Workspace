Zotero.TranslatorTrust = new function() {
	const PUBLIC_KEYS = ["__TRANSLATOR_PUBLIC_KEYS__"].slice(1);
	const MANIFEST_PREF = 'translatorManifest';
	const FLOOR_PREF = 'translatorManifestFloor';
	const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

	let _active = null;

	const encoder = new TextEncoder();

	function fromBase64(b64) {
		if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('bad base64');
		const bin = atob(b64);
		return Uint8Array.from(bin, c => c.charCodeAt(0));
	}

	function hex(buffer) {
		return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
	}

	async function sha256Hex(bytes) {
		return hex(await crypto.subtle.digest('SHA-256', bytes));
	}

	this.sha256Hex = async text => sha256Hex(encoder.encode(text));

	this.verifyManifest = async function(wrapper, { keys = PUBLIC_KEYS, floor = null } = {}) {
		if (!wrapper || typeof wrapper.manifest !== 'string' || typeof wrapper.signature !== 'string') {
			throw new Error('Manifest reply malformed');
		}
		if (!keys.length) throw new Error('No translator signing key is pinned in this build');
		const bytes = encoder.encode(wrapper.manifest);
		if (bytes.length > MAX_MANIFEST_BYTES) throw new Error('Manifest too large');
		const signature = fromBase64(wrapper.signature);
		if (signature.length !== 64) throw new Error('Bad signature length');
		let verified = false;
		for (const key of keys) {
			try {
				const publicKey = await crypto.subtle.importKey('raw', fromBase64(key), { name: 'Ed25519' }, false, ['verify']);
				if (await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, bytes)) {
					verified = true;
					break;
				}
			}
			catch (e) {
			}
		}
		if (!verified) throw new Error('Manifest signature does not verify');

		const manifest = JSON.parse(wrapper.manifest);
		if (!Number.isSafeInteger(manifest.version) || manifest.version < 1) throw new Error('Manifest has no version');
		if (!/^[0-9a-f]{40}$/.test(manifest.commit || '')) throw new Error('Manifest has no commit');
		if (typeof manifest.date !== 'string' || isNaN(Date.parse(manifest.date))) throw new Error('Manifest has no date');
		if (!Array.isArray(manifest.translators) || !manifest.translators.length) throw new Error('Manifest has no translators');
		const manifestSha = await sha256Hex(bytes);
		if (floor) {
			if (manifest.version < floor.version) {
				throw new Error(`Manifest version ${manifest.version} is older than accepted ${floor.version} (rollback refused)`);
			}
			if (manifest.version === floor.version && manifestSha !== floor.sha256) {
				throw new Error('Manifest differs from the accepted one at the same version');
			}
		}
		const byId = new Map();
		const metadata = [];
		for (const entry of manifest.translators) {
			const meta = entry && entry.metadata;
			if (!meta || typeof meta.translatorID !== 'string' || typeof entry.sha256 !== 'string'
					|| !/^[0-9a-f]{64}$/.test(entry.sha256) || byId.has(meta.translatorID)) {
				throw new Error('Manifest entry malformed');
			}
			byId.set(meta.translatorID, { metadata: meta, sha256: entry.sha256 });
			metadata.push(meta);
		}
		return { version: manifest.version, commit: manifest.commit, date: manifest.date, sha256: manifestSha, byId, metadata };
	};

	this.getActive = () => _active;
	this.hasPinnedKeys = () => PUBLIC_KEYS.length > 0;

	this.load = async function() {
		_active = null;
		let stored;
		try { stored = Zotero.Prefs.get(MANIFEST_PREF); } catch (e) { return null; }
		if (!stored) return null;
		try {
			_active = await this.verifyManifest(stored, { floor: this._floor() });
		}
		catch (e) {
			Zotero.debug('TranslatorTrust: stored manifest rejected: ' + e.message);
			await Zotero.Prefs.clear(MANIFEST_PREF);
		}
		return _active;
	};

	this._floor = function() {
		try { return Zotero.Prefs.get(FLOOR_PREF) || null; } catch (e) { return null; }
	};

	this.accept = async function(wrapper) {
		const next = await this.verifyManifest(wrapper, { floor: this._floor() });
		const previous = _active;
		await Zotero.Prefs.set(MANIFEST_PREF, { manifest: wrapper.manifest, signature: wrapper.signature });
		await Zotero.Prefs.set(FLOOR_PREF, { version: next.version, sha256: next.sha256 });
		_active = next;
		return previous;
	};

	this.loadBundled = async function() {
		let wrapper;
		try {
			const get = async name => {
				const response = await fetch(browser.runtime.getURL('translators/' + name));
				if (!response.ok) throw new Error(name + ' missing');
				return response.text();
			};
			wrapper = { manifest: await get('signed-translators.json'), signature: (await get('manifest.sig')).trim() };
		}
		catch (e) {
			return null;
		}
		try {
			const bundled = await this.verifyManifest(wrapper, { floor: this._floor() });
			if (_active && bundled.version <= _active.version) return null;
			return { previous: await this.accept(wrapper) };
		}
		catch (e) {
			Zotero.debug('TranslatorTrust: bundled translators rejected: ' + e.message);
			return null;
		}
	};

	this.bundledCode = async function(translatorID) {
		if (!_active || !_active.byId.has(translatorID)) return null;
		try {
			const response = await fetch(browser.runtime.getURL('translators/' + translatorID.toLowerCase() + '.js'));
			return response.ok ? await response.text() : null;
		}
		catch (e) {
			return null;
		}
	};

	this.codeMatches = async function(translatorID, code) {
		if (!_active || typeof code !== 'string') return false;
		const entry = _active.byId.get(translatorID);
		if (!entry) return false;
		return (await sha256Hex(encoder.encode(code))) === entry.sha256;
	};
};
