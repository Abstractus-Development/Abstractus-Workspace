/*
	Abstractus: trust for translators served by Abstractus Desktop.

	Another process can squat on 127.0.0.1:23130, and extension storage can be written by
	content scripts. So nothing the desktop serves is believed until it is proven to come from
	our release key:

	  1. The desktop serves a manifest (translator metadata + SHA-256 of every translator)
	     and an Ed25519 signature over its EXACT bytes. The signature is checked against
	     the public keys pinned in this file BEFORE the manifest is parsed.
	  2. ALL translator metadata (target, priority, type, browserSupport, lastUpdated, label)
	     comes from that signed manifest. Never from getTranslators or a code header.
	  3. Every translator's code is hashed against the manifest immediately before it is
	     handed out to run, wherever the code came from (desktop, repo.zotero.org, cache).
	  4. The manifest has a monotonic version. The extension remembers the highest it has
	     accepted and refuses anything older (or the same version with different bytes).

	Failure is never silent: callers fall back to repo.zotero.org (HTTPS) for CODE only, and
	that code must still match the signed hashes.
*/
Zotero.TranslatorTrust = new function() {
	// Replaced at build time. A build that is not given a key trusts nothing.
	// Release builds carry ONLY the release key; dev keys exist only in dev builds.
	const PUBLIC_KEYS = /*TRANSLATOR_PUBLIC_KEYS*/[];
	const MANIFEST_PREF = 'translatorManifest';
	const FLOOR_PREF = 'translatorManifestFloor';
	const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

	let _active = null; // {version, commit, date, sha256, byId: Map, metadata: []}

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

	/**
	 * Verifies a {manifest: <string>, signature: <base64>} reply and returns the parsed,
	 * validated manifest. Throws on ANY problem. The text is parsed only after the
	 * signature over its exact UTF-8 bytes has verified.
	 *
	 * @param {Object} wrapper
	 * @param {Object} [options]
	 * @param {String[]} [options.keys] base64 raw Ed25519 public keys (default: pinned keys)
	 * @param {{version:Number, sha256:String}} [options.floor] highest manifest accepted so far
	 */
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
				// An unsupported algorithm or a bad key counts as "not verified" -- fail closed.
			}
		}
		if (!verified) throw new Error('Manifest signature does not verify');

		// Now, and only now, is the text parsed.
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

	/**
	 * Re-verifies the stored manifest (storage is not trusted) and makes it active.
	 */
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

	/**
	 * Verifies a manifest from the desktop and, if it is acceptable, stores it and makes it
	 * active. Returns the previous active manifest (or null) so callers can drop stale code.
	 * Throws when it does not verify; the caller keeps what it has and falls back.
	 */
	this.accept = async function(wrapper) {
		const next = await this.verifyManifest(wrapper, { floor: this._floor() });
		const previous = _active;
		await Zotero.Prefs.set(MANIFEST_PREF, { manifest: wrapper.manifest, signature: wrapper.signature });
		await Zotero.Prefs.set(FLOOR_PREF, { version: next.version, sha256: next.sha256 });
		_active = next;
		return previous;
	};

	/**
	 * The baseline set shipped inside the extension package (signed like any other). Adopted
	 * when nothing is stored yet or when it is newer than what is stored; never when older.
	 * Returns the previous active manifest if the set changed, else null.
	 */
	this.loadBundled = async function() {
		let wrapper;
		try {
			const get = async name => {
				const response = await fetch(browser.runtime.getURL('translators/' + name));
				if (!response.ok) throw new Error(name + ' missing');
				return response.text();
			};
			wrapper = { manifest: await get('manifest.json'), signature: (await get('manifest.sig')).trim() };
		}
		catch (e) {
			return null; // no baseline in this build
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

	/** Code for one translator from the extension package (unverified; callers hash-check it). */
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

	/**
	 * True when `code` is exactly what the signed manifest lists for this translator.
	 * Call this immediately before running or caching code, whatever its source.
	 */
	this.codeMatches = async function(translatorID, code) {
		if (!_active || typeof code !== 'string') return false;
		const entry = _active.byId.get(translatorID);
		if (!entry) return false;
		return (await sha256Hex(encoder.encode(code))) === entry.sha256;
	};
};
