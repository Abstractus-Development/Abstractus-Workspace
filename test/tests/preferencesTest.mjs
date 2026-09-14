/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2017 Center for History and New Media
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

import { Tab, background, getExtensionURL, delay } from '../support/utils.mjs';

describe('Preferences', function() {
	var tab = new Tab();
	
	before(async function () {
		await tab.init(getExtensionURL('preferences/preferences.html'));
		await delay(200);
	});
	
	after(async function () {
		await tab.close();
	});
	
	describe('General', function() {
		describe('Abstractus Desktop status', function() {
			before(async function () {
				await background(function() {
					sinon.stub(Zotero.Connector, 'checkIsOnline').resolves(true);
				});
			});
		
			beforeEach(async function () {
				await background(function() {
					Zotero.Connector.checkIsOnline.reset();
				});	
			});
			
			after(async function () {
				await background(function() {
					Zotero.Connector.checkIsOnline.restore();
				});	
			});
			
			function clickAndReturnStatus() {
				return tab.run(function() {
					var spy = sinon.spy(Zotero.Connector, 'checkIsOnline');
					document.querySelector('input[value="Check Again"]').click();
					return spy.lastCall.returnValue.then(function() {
						spy.restore();
						return document.querySelector('#client-status p').textContent;
					});
				});	
			}
			
			it('shows Abstractus Desktop as available after clicking "Check Again" when the app is available', async function () {
				await background(function() {
					Zotero.Connector.checkIsOnline.resolves(true);
				});	
				let status = await clickAndReturnStatus();
				assert.include(status, 'is running');
			});
			
			it('shows Abstractus Desktop as unavailable after clicking "Check Again" when the app is not available', async function () {
				await background(function() {
					Zotero.Connector.checkIsOnline.resolves(false);
				});	
				let status = await clickAndReturnStatus();
				assert.include(status, 'isn’t reachable');
			});
		});
	});
});
