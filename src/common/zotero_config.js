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

const ZOTERO_CONFIG = {
	// Abstractus: the name shown throughout the UI ("Save to Abstractus", "Abstractus Connector")
	CLIENT_NAME: 'Abstractus',
	DOMAIN_NAME: 'abstractus.ai',
	// Local connector server run by Abstractus Desktop
	CONNECTOR_URL: 'http://127.0.0.1:23130/',
	// Site translators (the page parsers): Abstractus Desktop serves a signed copy; the Zotero
	// translator repository is the fallback.
	REPOSITORY_URL: 'https://repo.zotero.org/repo/',
	// The repository only serves translators to Zotero Connector versions it knows (anything else
	// gets a 403), so requests to it identify as the upstream connector release this fork tracks,
	// not as the Abstractus product version. Update it when syncing a newer upstream release.
	REPOSITORY_CLIENT_VERSION: '5.0.202',
	REPOSITORY_CHECK_INTERVAL: 86400, // 24 hours
	REPOSITORY_RETRY_INTERVAL: 3600, // 1 hour
	REPOSITORY_CHANNEL: 'trunk',
	// Abstractus Desktop serves a signed, bundled copy of the translators; the extension verifies it
	// (Zotero.TranslatorTrust) and uses it first. The repository is the fallback for code only.
	ALWAYS_FETCH_FROM_REPOSITORY: false,
	WWW_BASE_URL: 'https://www.abstractus.ai/',
	CLIENT_DOWNLOAD_URL: 'https://www.abstractus.ai/'
};
