window.Zotero = window.Zotero || {};
Zotero.UI = Zotero.UI || {};
Zotero.UI.style = Zotero.UI.style || {};

Zotero.UI.style.imageBase = Zotero.getExtensionURL("images/");

function getTargetType(id) {
	return id.startsWith('L') ? 'library': 'collection';
}

function getParent(rows, id) {
	var pos = rows.findIndex(row => row.id == id);
	var row = rows[pos];
	var level = row.level;
	if (!level) return null;
	while (true) {
		pos--;
		if (!rows[pos]) {
			return rows[pos + 1];
		}
		if (rows[pos].level == level - 1 || !rows[pos].level) {
			return rows[pos];
		}
	}
}

Zotero.UI.ProgressWindow = class ProgressWindow extends React.PureComponent {
	constructor(props) {
		super(props);
		this.state = this.getInitialState();
		
		this.nArcs = 20;
		this.announceAlerts = false;
		this.alertTimeout = null;
		this.done = false;
		this.canUserAddNote = false;
		this.supportsTagsAutocomplete = false;
		
		this.text = {
			more: Zotero.getString('general_more'),
			done: Zotero.getString('general_done'),
			tagsPlaceholder: Zotero.getString('progressWindow_tagPlaceholder'),
			filterPlaceholder: Zotero.getString('progressWindow_filterPlaceholder'),
			addNotePlaceholder: Zotero.getString('progressWindow_noteEditorPlaceholder')
		};
		
		this.expandedRowsCache = {};
		this.existingTags = {};
		this.currentLibraryID = null;
		
		this.headlineSelectNode = React.createRef();
		
		this.handleMouseEnter = this.handleMouseEnter.bind(this);
		this.handleMouseLeave = this.handleMouseLeave.bind(this);
		this.handleUserInteraction = this.handleUserInteraction.bind(this);
		this.handleHeadlineSelectFocus = this.handleHeadlineSelectFocus.bind(this);
		this.onHeadlineSelectChange = this.onHeadlineSelectChange.bind(this);
		this.onDisclosureChange = this.onDisclosureChange.bind(this);
		this.handleDisclosureKeyPress = this.handleDisclosureKeyPress.bind(this);
		this.onTargetChange = this.onTargetChange.bind(this);
		this.handleExpandRows = this.handleExpandRows.bind(this);
		this.handleCollapseRows = this.handleCollapseRows.bind(this);
		this.handleRowToggle = this.handleRowToggle.bind(this);
		this.handleKeyDown = this.handleKeyDown.bind(this);
		this.handleKeyPress = this.handleKeyPress.bind(this);
		this.onTagsChange = this.onTagsChange.bind(this);
		this.onNoteChange = this.onNoteChange.bind(this);
		this.onNoteFocus = this.onNoteFocus.bind(this);
		this.onNoteBlur = this.onNoteBlur.bind(this);
		this.onNoteKeyPress = this.onNoteKeyPress.bind(this);
		this.onTagsKeyPress = this.onTagsKeyPress.bind(this);
		this.onTagsFocus = this.onTagsFocus.bind(this);
		this.onTagsBlur = this.onTagsBlur.bind(this);
		this.handleDone = this.handleDone.bind(this);
		this.setFilter = this.setFilter.bind(this);
		this.clearFilter = this.clearFilter.bind(this);
		this.expandToTarget = this.expandToTarget.bind(this);
		this.updateSelectedTags = this.updateSelectedTags.bind(this);
		this.onTagAutocompleteShown = this.onTagAutocompleteShown.bind(this);
		this.sendUpdate	= this.sendUpdate.bind(this);
	}
	
	getInitialState() {
		return {
			headlineText: "",
			target: null,
			targets: null,
			targetSelectorShown: false,
			itemProgress: new Map(),
			errors: [],
			note: "",
			selectedTags: new Set(),
			extraHeightForTagAutocomplete: 0
		};
	}
	
	componentDidMount() {
		for (let evt of ['changeHeadline', 'makeReadOnly', 'updateProgress', 'addError']) {
			this.addMessageListener(`progressWindowIframe.${evt}`, (data) => this[evt](...data));
		}
		this.addMessageListener('progressWindowIframe.shown', this.handleShown.bind(this));
		this.addMessageListener('progressWindowIframe.hidden', this.handleHidden.bind(this));
		this.addMessageListener('progressWindowIframe.reset', () => this.setState(this.getInitialState()));
		this.addMessageListener('progressWindowIframe.willHide', this.handleHiding.bind(this));
		
		document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
		
		this.sendMessage('registered');

		document.querySelector("#progress-window").setAttribute("aria-label", Zotero.getString('general_saveTo', ZOTERO_CONFIG.CLIENT_NAME));
		Zotero.Connector.getPref('canUserAddNote').then(res => {
			this.canUserAddNote = res;
		});
		Zotero.Connector.getPref('supportsTagsAutocomplete').then(res => {
			this.supportsTagsAutocomplete = res;
		});
		document.documentElement.style.scrollbarWidth = 'none';
	}
	
	
	componentDidUpdate() {
		if (this.focusHeadlineSelect) {
			this.focusHeadlineSelect = false;
			if (this.headlineSelectNode.current) {
				this.ignoreHeadlineSelectFocus = true;
				this.headlineSelectNode.current.focus();
			}
		}
		else if (this.focusTreeOnUpdate) {
			this.focusTreeOnUpdate = false;
			setTimeout(function () {
				var focused = document.querySelector('.focused');
				if (focused) {
					focused.click();
				}
			}, 100);
		}
		
		window.requestAnimationFrame(() => {
			let requiredHeight = this.rootNode.scrollHeight + this.state.extraHeightForTagAutocomplete;
			if (this.lastHeight != requiredHeight
					&& this.rootNode.scrollHeight != 0) {
				this.lastHeight = requiredHeight;
				this.sendMessage('resized', { height: requiredHeight });
			}
		});
	}
	
	
	changeHeadline(text, target, targets, tags) {
		if (targets) {
			if (!this.state.targets || !this.state.targetSelectorShown) {
				this.focusHeadlineSelect = true;
			}
			
			targets.forEach((t) => {
				if (getTargetType(t.id) == 'library') {
					t.expanded = true;
				}
			});
			
			this.expandToTarget(targets, target);

			for (let row of targets) {
				this.expandedRowsCache[row.id] = row.expanded;
			}
		}
		
		var state = {
			headlineText: text,
			target,
			targets
		};
		if (!targets) {
			state.targetSelectorShown = false;
		}
		let targetName = target?.name || ZOTERO_CONFIG.CLIENT_NAME;
		let alert = this.done ? Zotero.getString("progressWindow_alreadySaved") : `${text} ${targetName}`;
		document.getElementById("messageAlert").textContent = alert; 
		this.existingTags = tags;
		this.setState(state, () => {
			this.setFilter();
		});
	}
	
	makeReadOnly(target) {
		this.setState({
			targetSelectorShown: false,
			target,
			targets: null
		});
	}
	
	updateProgress(id, params = {}) {
		if (!id) {
			id = Math.floor(Math.random() * 99999999);
		}
		
		this.setState((prevState, props) => {
			var iconSrc = params.iconSrc;
			var title = params.title;
			var parentItem = params.parentItem;
			var progress = params.progress;
			
			var newState = {
				itemProgress: new Map(prevState.itemProgress)
			};
			
			var p = prevState.itemProgress.get(id);
			if (!p) {
				p = {id, iconSrc, title};
				newState.itemProgress.set(id, p);
				p.order = prevState.itemProgress.size - 1;
			}
			p.title = title;
			if (iconSrc) {
				p.iconSrc = iconSrc;
			}
			if (parentItem) {
				p.parentItem = parentItem;
			}
			if (progress === false) {
				p.failed = true;
			}
			else if (progress == -1) {
				newState.itemProgress.delete(id);
			}
			else if (typeof progress == 'number') {
				p.percentage = progress;
			}
			if (params.itemType) {
				p.itemType = params.itemType
			}
			return newState;
		});
		if (!this.announceAlerts) {
			this.announceAlerts = params.itemsLoaded;
		}
	}
	
	addError() {
		this.setState((prevState) => {
			let errors = [...prevState.errors];
			let newError = Array.from(arguments);
			if (!errors.find(e => JSON.stringify(e) == JSON.stringify(newError))) {
				errors.push(newError);
			}
			return { errors };
		});
	}
	
	handleAlerts(items) {
		clearTimeout(this.alertTimeout);
		let toplevelItems = items.filter(item => !item.parentItem && item.percentage == 100);
		if (!this.announceAlerts || toplevelItems.length == 0) return;
		let shortenTitle = (title) => title.split(/\s+/).slice(0, 5).join(' ');
		let alertQueue = [];
		let savingMultipleItems = toplevelItems.length > 1;
		if (savingMultipleItems) {
			let topLevelTitles = toplevelItems.map((item, index) => Zotero.getString("progressWindow_saveItem", [index + 1, shortenTitle(item.title)])).join(", ");
			alertQueue = [{ text: Zotero.getString("progressWindow_savingItems", [this.announceAlerts, topLevelTitles]), id: 'saving_items_count' }];
		}
		else {
			alertQueue = [{ text: Zotero.getString("progressWindow_savingItem", shortenTitle(toplevelItems[0].title)), id: 'saving_items_count' }];
		}
		let parentItemIndex = 0;
		for (let { parentItem, percentage, id, itemType } of items) {
			let message;
			if (parentItem) {
				if (percentage === false) {
					message = Zotero.getString(`progressWindow_downloadFailed${savingMultipleItems ? "Plural" : ""}`, [itemType, parentItemIndex]);
				}
				else if (percentage === 100) {
					message = Zotero.getString(`progressWindow_downloadComplete${savingMultipleItems ? "Plural" : ""}`, [itemType, parentItemIndex]);
				}
			}
			else if (percentage === 100) {
				parentItemIndex += 1;
			}
			if (message) {
				alertQueue.push({text: message, id: id});
			}
		}

		let noTimeout = this.alertTimeout === null;
		this.alertTimeout = setTimeout(() => {
			let logNode = document.getElementById("messageLog");
			if (this.done) {
				alertQueue.push({text: Zotero.getString("progressWindow_allDone"), id: "allDone"});
			}
			for (let { text, id } of alertQueue) {
				if (logNode.querySelector(`div[value="${CSS.escape(text)}"]`)) continue;

				let div = document.createElement("div");
				div.setAttribute("data-id", id);
				div.setAttribute("value", text);
				div.textContent = text;
				logNode.appendChild(div);
			}
		}, (noTimeout || this.done) ? 0 : 1000);
	}

	sendMessage(name, data = {}) {
		return Zotero.Messaging.sendMessage(`progressWindowIframe.${name}`, data);
	}

	addMessageListener(name, handler) {
		return Zotero.Messaging.addMessageListener(name, handler);
	}
	
	sendUpdate() {
		let tags = [...this.state.selectedTags];
		if (!this.supportsTagsAutocomplete) {
			tags = tags.join(",");
		}
		this.sendMessage('updated', { target: this.target, note: this.state.note, tags });
	}
	
	handleShown() {
		if (this.state.targetSelectorShown) {
			this.focusTreeOnUpdate = true;
		}
	}
	
	handleHidden() {
	}
	
	handleMouseEnter() {
		this.sendMessage('mouseenter');
	}
	
	handleMouseLeave() {
		this.sendMessage('mouseleave');
	}
	
	handleMouseMove() {
		this.sendMessage('mousemove');
	}

	handleHiding() {
		this.done = true;
	}
	
	handleVisibilityChange() {
		if (!document.hidden) {
			let hovering = window.getComputedStyle(this.rootNode)
				.getPropertyValue('background-size') == 'cover';
			if (hovering) {
				this.handleMouseEnter();
			}
			else {
				this.handleMouseLeave();
			}
		}
	}
	
	handleUserInteraction() {
		document.body.onblur = this.onDocumentBlur.bind(this);
	}
	
	onDocumentBlur() {
		document.body.onblur = null;
		this.sendMessage('blurred');
	}
	
	handleHeadlineSelectFocus() {
		if (this.ignoreHeadlineSelectFocus) {
			this.ignoreHeadlineSelectFocus = false;
			return;
		}
		this.handleUserInteraction();
	}
	
	onHeadlineSelectChange(event) {
		if (event.target.value == 'more') {
			this.focusTreeOnUpdate = true;
			this.setState({
				targetSelectorShown: true
			});
			return;
		}
		
		this.onTargetChange(event.target.value);
	}
	
	onDisclosureChange(e) {
		let viaKeyPress = e.nativeEvent.clientY == 0 && e.nativeEvent.clientX == 0;
		var show = !this.state.targetSelectorShown;
		if (show && !viaKeyPress) {
			this.focusTreeOnUpdate = true;
		}
		this.setState({
			targetSelectorShown: show
		});
	}
	
	handleDisclosureKeyPress(event) {
		if (event.key == 'Enter') {
			event.stopPropagation();
		}
	}
	
	onTargetChange(id) {
		var target = this.state.targets.find(row => row.id == id);
		let selectedLibrary = null;
		if (target && target.level !== undefined)  {
			selectedLibrary = target;
			while (selectedLibrary && selectedLibrary.level > 0) {
				selectedLibrary = getParent(this.state.targets, selectedLibrary.id);
			}
		}
		let selectedTags = this.state.selectedTags;
		if (selectedLibrary && selectedLibrary.id !== this.currentLibraryID) {
			this.currentLibraryID = selectedLibrary.id;
			if ((this.existingTags[this.currentLibraryID] || []).length) {
				selectedTags = new Set();
			}
		}
		this.setState({ target, selectedTags }, () => {
			this.sendUpdate();
		});
		this.target = target;
		this.handleUserInteraction();
	}
	
	handleExpandRows(ids) {
		ids = new Set(ids);
		this.setState((prevState) => {
			return {
				targets: [...prevState.targets.map((target) => {
					return ids.has(target.id)
						? Object.assign({}, target, { expanded: true })
						: target;
				})]
			};
		});
	}
	
	handleCollapseRows(ids) {
		ids = new Set(ids);
		this.setState((prevState) => {
			return {
				targets: [...prevState.targets.map((target) => {
					return ids.has(target.id)
						? Object.assign({}, target, { expanded: false })
						: target;
				})]
			};
		});
	}
	
	handleRowToggle(id) {
		this.setState((prevState) => {
			return {
				targets: [...prevState.targets.map((target) => {
					if (target.id != id) return target;
					return Object.assign({}, target, { expanded: !target.expanded });
				})]
			};
		});
	}
	
	expandToTarget(targets, target) {
		let parent = getParent(targets, target.id);
		while (parent) {
			if (parent.expanded) {
				break;
			}
			parent.expanded = true;
			parent = getParent(targets, parent.id);
		}
	}
	handleKeyDown(event) {
		if (event.target.classList.contains("ProgressWindow-filterInput")) {
			if (event.key == 'Escape' && event.target.value.length > 0) {
				this.clearFilter();
				return;
			}
			if (event.key == "Tab" && !event.shiftKey) {
				var target = this.state.targets.find(row => row.id == this.state.target.id);
				if (!target.passesFilter) {
					let firstPassingTarget = this.state.targets.find(row => row.passesFilter);
					if (firstPassingTarget) {
						this.onTargetChange(firstPassingTarget.id);
					}
				}
			}
		}
		if (event.key == 'Escape') {
			this.handleDone();
		}
		else if (event.target.localName == 'select') {
			switch (event.key) {
				case 'ArrowUp':
				case 'ArrowDown':
				case 'Home':
				case 'End':
					this.sendMessage('mouseenter');
					this.handleUserInteraction();
					break;
			}
		}
	}
	
	handleKeyPress(event) {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		
		if (event.key == 'Enter') {
			this.handleDone();
		}
		else {
			this.sendMessage('mouseenter');
			this.handleUserInteraction();
		}
	}
	
	onTagsChange(event) {
		this.setState({tags: event.target.value});
		this.tags = event.target.value;
	}
	
	onTagsKeyPress(event) {
		if (event.which == 13) {
			this.sendUpdate();
			this.handleDone();
		}
	}
	
	onTagsFocus() {
		this.sendMessage('disableCloseTimer');
	}
	
	onTagsBlur() {
		this.sendMessage('enableCloseTimer');
		this.sendUpdate();
	}
	
	onNoteChange(event) {
		let textarea = event.target;
		this.setState({ note: textarea.value });
		textarea.style.height = 'auto';
		textarea.style.height = textarea.scrollHeight + 'px';
	}

	onNoteFocus() {
		this.sendMessage('disableCloseTimer');;
	}

	onNoteBlur() {
		this.sendMessage('enableCloseTimer');
		this.sendUpdate();
	}

	onNoteKeyPress(event) {
		if (event.key == 'Enter' && !event.shiftKey) {
			event.stopPropagation();
		}
	}

	handleDone() {
		this.sendMessage('close');
	}
	
	renderHeadline() {
		return (
			<div className="ProgressWindow-headline">
				<img className="ProgressWindow-brandLogo" src="../images/zotero-z-32px.png" alt=""/>
				<span className="ProgressWindow-headlineText">{this.state.headlineText}</span>
				{this.state.targets
					? this.renderHeadlineSelect()
					: (this.state.target ? this.renderHeadlineTarget() : "")}
				<div id="messageAlert" role="alert" style={{ fontSize: 0 }}/>
				<div id="messageLog" role="log" aria-relevant="additions" style={{ fontSize: 0 }}/>
			</div>
		);
	}
	
	renderHeadlineSelect() {
		var rowTargets = [
			this.state.target,
			...this.state.targets.filter(t => t.recent && t.id != this.state.target.id)
		];
		if (!this.state.targetSelectorShown) {
			rowTargets.push({
				id: "more",
				name: this.text.more
			});
		}
		
		return (
			<React.Fragment>
				<select ref={this.headlineSelectNode}
						className="ProgressWindow-headlineSelect"
						onFocus={this.handleHeadlineSelectFocus}
						onChange={this.onHeadlineSelectChange}
						value={this.state.target.id}
						aria-label={this.state.headlineText || ""}>
					{rowTargets.map((row) => {
						var props = {
							key: row.id,
							value: row.id,
							disabled: row.disabled
						};
						return <option {...props}>{row.name}</option>;
					})}
				</select>
				<button className={"ProgressWindow-disclosure"
							+ (this.state.targetSelectorShown ? " is-open" : "")}
						onClick={this.onDisclosureChange}
						onKeyPress={this.handleDisclosureKeyPress}
						aria-expanded={this.state.targetSelectorShown}
						aria-label={Zotero.getString(`progressWindow_detailsBtn${this.state.targetSelectorShown ? "Hide" : "View"}`)}/>
			</React.Fragment>
		);
	}
	
	
	renderHeadlineTarget() {
		return <span className="ProgressWindow-headlineTarget">
			<TargetIcon type={getTargetType(this.state.target.id)}/>
			<span className="ProgressWindow-headlineTargetName">{this.state.target.name + "…"}</span>
		</span>;
	}


	clearFilter() {
		let filter = document.querySelector('.ProgressWindow-filterInput');
		if (!filter) {
			return;
		}
		filter.value = "";
		this.setFilter();
		filter.focus();
	}
	
	setFilter() {
		let rows = this.state.targets;
		if (!rows) return;

		let filter = document.querySelector('.ProgressWindow-filterInput')?.value || "";
		let crossIcon = document.querySelector(".ProgressWindow-cross");
		filter = filter.toLowerCase();
		let isFilterEmpty = filter.length == 0;
		if (crossIcon) {
			if (isFilterEmpty) {
				crossIcon.classList.add("hidden");
			}
			else {
				crossIcon.classList.remove("hidden");
			}
		}
		let passingIDs = {};
		let passingParentIDs = {};
		if (!isFilterEmpty && Object.keys(this.expandedRowsCache).length == 0) {
			for (let row of rows) {
				this.expandedRowsCache[row.id] = row.expanded;
			}
		}
		for (let i = rows.length - 1; i >= 0; i--) {
			let row = rows[i];
			let isPassing = row.name.toLowerCase().includes(filter);
			if (isFilterEmpty || isPassing || passingParentIDs[row.id]) {
				if (isPassing) {
					passingIDs[row.id] = true;
				}
				let maybeParenIndex = i - 1;
				while (maybeParenIndex >= 0 && rows[maybeParenIndex].level >= row.level) {
					maybeParenIndex -= 1;
				}
				let maybeParent = rows[maybeParenIndex];
				if (maybeParent && maybeParent.level == row.level - 1) {
					passingParentIDs[maybeParent.id] = true;
				}
			}
		}
		this.setState((prevState) => {
			return {
				targets: [...prevState.targets.map((target) => {
					let updated = Object.assign({}, target, {
						passesFilter: !!passingIDs[target.id],
						passingParent: !!passingParentIDs[target.id]
					});
					if (!isFilterEmpty) {
						updated.expanded = true;
					}
					else {
						updated.expanded = !!this.expandedRowsCache[target.id];
					}
					return updated;
				})]
			};
		}, () => {
			if (isFilterEmpty && Object.keys(this.expandedRowsCache).length > 0) {
				this.expandedRowsCache = {};
				this.expandToTarget(this.state.targets, this.state.target);
			}
		});
	}

	updateSelectedTags(tags, callback) {
		this.setState({ selectedTags: tags }, () => {
			callback();
			this.sendUpdate();
		});
	}

	onTagAutocompleteShown(extraHeight) {
		this.setState({ extraHeightForTagAutocomplete: extraHeight });
	}

	renderTargetSelector() {
		if (!this.state.targetSelectorShown) return "";
		const filterElement = (
			<div className="ProgressWindow-filterWrapper">
				<input
					className="ProgressWindow-filterInput"
					onInput={this.setFilter}
					placeholder={this.text.filterPlaceholder}>
				</input>
				<button className="ProgressWindow-cross hidden"
						onClick={this.clearFilter}
						tabindex={-1}/>
			</div>
		)
		const targetSelectorElement = (
			<div className="ProgressWindow-targetSelector">
				<TargetTree
					rows={this.state.targets.filter(target => target.passesFilter || target.passingParent)}
					focused={this.state.targets.find(row => row.id == this.state.target.id)}
					onExpandRows={this.handleExpandRows}
					onCollapseRows={this.handleCollapseRows}
					onRowToggle={this.handleRowToggle}
					onRowFocus={this.onTargetChange}/>
			</div>
		)
		let noteEditorElement = null;
		if (this.canUserAddNote) {
			noteEditorElement = (
				<div className="ProgressWindow-noteEditorRow">
					<textarea
						className="ProgressWindow-noteEditor"
						placeholder={this.text.addNotePlaceholder}
						value={this.state.note}
						onChange={this.onNoteChange}
						onBlur={this.onNoteBlur}
						onFocus={this.onNoteFocus}
						onKeyPress={this.onNoteKeyPress}/>
				</div>
			)
		}
		const tagsInputElement = (
			<TagsInput
					existingTags={this.existingTags[this.currentLibraryID] || []}
					selectedTags={this.state.selectedTags}
					supportsTagsAutocomplete={this.supportsTagsAutocomplete}
					updateSelectedTags={this.updateSelectedTags}
					sendMessage={this.sendMessage}
					sendUpdate={this.sendUpdate}
					handleDone={this.handleDone}
					setAutocompletePopupHeight={this.onTagAutocompleteShown}
				/>
		)
		return (
			<div>
				{filterElement}
				{targetSelectorElement}
				{noteEditorElement}
				{tagsInputElement}
			</div>
		);
	}
	
	renderProgress() {
		var items = Array.from(this.state.itemProgress.values());
		items.sort((a, b) => a.order - b.order);
		var childItems = items.filter(item => item.parentItem);
		items = items.filter(item => !item.parentItem);
		var newItems = [];
		
		var childrenByParent = {};
		for (let child of childItems) {
			if (!childrenByParent[child.parentItem]) {
				childrenByParent[child.parentItem] = [];
			}
			childrenByParent[child.parentItem].push(child);
		}
		
		for (let item of items) {
			newItems.push(item);
			if (childrenByParent[item.id]) {
				childrenByParent[item.id].sort((a, b) => a.order - b.order);
				for (let child of childrenByParent[item.id]) {
					newItems.push(child);
				}
			}
		}
		
		for (let child of childItems) {
			if (!newItems.includes(child)) {
				newItems.push(child);
			}
		}
		
		items = newItems;
		this.handleAlerts(items);
		
		return (
			<div className="ProgressWindow-progressBox">
				{items.map(item => this.renderItem(item))}
			</div>
		);
	}
	
	renderItem(item) {
		var status = item.failed
			? "failed"
			: (item.percentage == 100 ? "done" : (item.percentage > 0 ? "progress" : "pending"));
		var className = `ProgressWindow-item is-${status}`
			+ (item.parentItem ? " ProgressWindow-item--child" : "");
		var itemStyle = { "--p": String(Math.round(item.percentage || 0)) };
		var iconStyle = item.iconSrc ? { backgroundImage: `url('${item.iconSrc}')` } : {};

		return (
			<div key={item.id} className={className} style={itemStyle}>
				<div className="ProgressWindow-itemIcon" style={iconStyle}></div>
				<div className="ProgressWindow-itemText">
					{item.title}
				</div>
				<div className="ProgressWindow-itemStatus" aria-hidden="true"></div>
			</div>
		);
	}
	
	renderErrors() {
		return (
			<div className="ProgressWindow-errors">
				{this.state.errors.map((row, index) => this.renderError(row, index))}
			</div>
		);
	}
	
	renderError(row, index) {
		var err = row[0];
		var args = row.slice(1);
		
		var contents = "";
		
		if (err === "translationError") {
			contents = Zotero.getString("progressWindow_error_translation");
		}
		else if (err === "fallback") {
            contents = <span>Could not save using {String(args[0] || 'this site')}. Trying {String(args[1] || 'basic metadata')}.</span>;
        }
		else if (err === "noTranslator") {
			contents = Zotero.getString('progressWindow_error_noTranslator', ZOTERO_CONFIG.CLIENT_NAME);
		}
		else if (err === "collectionNotEditable") {
			contents = Zotero.getString('progressWindow_error_collectionNotEditable', ZOTERO_CONFIG.CLIENT_NAME);
		}
		else if (err === "clientRequired") {
			contents = Zotero.getString('progressWindow_error_clientRequired', ZOTERO_CONFIG.CLIENT_NAME);
		}
		else if (err === "upgradeClient") {
			contents = Zotero.getString("progressWindow_error_upgradeClient", ZOTERO_CONFIG.CLIENT_NAME);
		}
		else if (err === "siteAccessLimits") {
			contents = Zotero.getString("progressWindow_error_siteAccessLimitsError", [args[0]]);
		}
		else if (err === "unexpectedError") {
			contents = Zotero.getString('progressWindow_error_unexpected');
		}

		return (
			<div className="ProgressWindow-error" key={index} role="alert">
				{contents}
			</div>
		);
	}
	
	render() {
		return (
			<div ref={(el) => {this.rootNode = el}}
					className="ProgressWindow-box"
					onMouseEnter={this.handleMouseEnter}
					onMouseLeave={this.handleMouseLeave}
					onClick={this.handleUserInteraction}
					onKeyDown={this.handleKeyDown}
					onKeyPress={this.handleKeyPress}>
				{this.renderHeadline()}
				{this.renderTargetSelector()}
				{this.renderProgress()}
				{this.renderErrors()}
			</div>
		);
	}
}


class TargetIcon extends React.Component {
	render() {
		var isLibrary = this.props.type == 'library';
		return (
			<svg className={`ProgressWindow-targetIcon ProgressWindow-targetIcon--${isLibrary ? 'library' : 'collection'}`}
					width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
					strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				{isLibrary
					? <path d="M2 3.5c2.5-.7 4.5-.7 6 .8 1.5-1.5 3.5-1.5 6-.8v9c-2.5-.7-4.5-.7-6 .8-1.5-1.5-3.5-1.5-6-.8zM8 4.3v9"/>
					: <path d="M1.75 4.5c0-.83.67-1.5 1.5-1.5h2.9l1.5 1.6h5.1c.83 0 1.5.67 1.5 1.5v5.65c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z"/>}
			</svg>
		);
	}
}


class TargetTree extends React.Component {
	static propTypes = {
		rows: PropTypes.object.isRequired,
		focused: PropTypes.object,
		onExpandRows: PropTypes.func.isRequired,
		onCollapseRows: PropTypes.func.isRequired,
		onRowToggle: PropTypes.func.isRequired,
		onRowFocus: PropTypes.func.isRequired,
		onKeyPress: PropTypes.func
	};
	
	constructor(props) {
		super(props);
	}
	
	static getDerivedStateFromProps(nextProps) {
		return {
			expanded: new Set(nextProps.rows.filter(row => row.expanded).map(t => t.id))
		};
	}
	
	getRoots() {
		return this.props.rows.filter(row => !row.level);
	}
	
	getChildren(id) {
		var rows = this.props.rows;
		var pos = rows.findIndex(row => row.id == id);
		var row = rows[pos];
		var level = row.level || 0;
		var children = [];
		while (rows[++pos] && rows[pos].level > level) {
			if (rows[pos].level == level + 1) {
				children.push(rows[pos]);
			}
		}
		return children;
	}
	
	itemIsExpanded(id) {
		return this.state.expanded.has(id);
	}
	
	handleRowFocus(item) {
		if (!item) {
			return;
		}
		this.props.onRowFocus(item.id);
	}
	
	handleKeyPress(event) {
		if (!event.altKey && !event.ctrlKey && !event.metaKey) {
			if (event.key == '-') {
				this.collapseCurrentLibrary();
			}
			else if (event.key == '+') {
				this.expandCurrentLibrary();
			}
			else {
			}
		}
		
		if (this.props.onKeyPress) {
			this.props.onKeyPress(event);
		}
	}
	
	collapseCurrentLibrary() {
		var focused = this.props.focused;
		var pos = this.props.rows.findIndex(row => row.id == focused.id);
		var collapse = [];
		while (pos + 1 < this.props.rows.length) {
			pos++;
			let current = this.props.rows[pos].id;
			if (getTargetType(current) == 'library') {
				pos--;
				break;
			}
		}
		
		while (true) {
			if (pos == -1) break;
			let current = this.props.rows[pos];
			collapse.push(current.id);
			if (getTargetType(current.id) == 'library') {
				this.props.onRowFocus(current.id);
				break;
			}
			pos--;
		}
		this.props.onCollapseRows(collapse);
	}
	
	
	expandCurrentLibrary() {
		var focused = this.props.focused;
		var pos = this.props.rows.findIndex(row => row.id == focused.id);
		var expand = [];
		while (pos >= 0) {
			let current = this.props.rows[pos].id;
			if (getTargetType(current) == 'library') {
				break;
			}
			pos--;
		}
		var libraryID = this.props.rows[pos].id;
		
		while (true) {
			if (pos == this.props.rows.length) break;
			let current = this.props.rows[pos];
			if (getTargetType(current.id) == 'library' && current.id != libraryID) {
				break;
			}
			let next = this.props.rows[pos + 1];
			if (next && getTargetType(next.id) != 'library' && next.level > current.level) {
				expand.push(current.id);
			}
			pos++;
		}
		this.props.onExpandRows(expand);
	}
	
	
	render() {
		return React.createElement(
			Tree,
			{
				onKeyPress: event => this.handleKeyPress(event),
				
				itemHeight: 28,
				
				getRoots: () => this.getRoots(),
				getKey: item => item.id,
				getParent: item => getParent(this.props.rows, item.id),
				getChildren: item => this.getChildren(item.id),
				isExpanded: item => this.itemIsExpanded(item.id),
				
				renderItem: (item, depth, isFocused, arrow, isExpanded) => {
					let className = "";
					if (isFocused) {
						className += "focused";
					}
					if (!item.passesFilter && item.passingParent) {
						className += " context-row";
					}
					
					return (
						<div className={"tree-row " + className} style={{marginLeft: depth * 5 + "px"}}>
							<span onClick={() => this.props.onRowToggle(item.id)}>{arrow}</span>
							<TargetIcon type={getTargetType(item.id)} />
							<span className="tree-item-label">{item.name}</span>
						</div>
					);
				},
				
				focused: this.props.focused,
				
				onFocus: item => this.handleRowFocus(item),
				onExpand: item => this.props.onExpandRows([item.id]),
				onCollapse: item => this.props.onCollapseRows([item.id]),
				
				autoExpandAll: false,
				autoExpandDepth: 0,
				label: Zotero.getString("progressWindow_collectionSelector")
			}
		);
	}
}

class TagsInput extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			tagsInput: "",
			currentTagIndex: -1
		};
		this.tagsInputNode = React.createRef();
		this.autocompleteRefs = [];
		this.autocompletePopupRef = React.createRef();
		this.selectedTagActiveIndex = 0;
		this.isClickingTag = false;
		this.text = {
			done: Zotero.getString('general_done'),
			tagsPlaceholder: Zotero.getString('progressWindow_tagPlaceholder')
		};
	}

	componentDidUpdate(_, prevState) {
		if (this.autocompleteRefs.length) {
			let refIndex =  this.state.currentTagIndex >=0 ? this.state.currentTagIndex : 0;
			let autocompleteRefNode = this.autocompleteRefs[refIndex];
			autocompleteRefNode?.scrollIntoView({ block: 'nearest' });
		}
		if (this.state.showTagsAutocomplete && !prevState.showTagsAutocomplete) {
			window.requestAnimationFrame(() => {
				this.expandIframeIfNeeded();
			})
		}
	}

	expandIframeIfNeeded() {
        const list=this.autocompletePopupRef.current;
        if (!list) return;
        const input=this.tagsInputNode.current.getBoundingClientRect();
        list.style.maxHeight=Math.max(72,Math.min(220,input.top-12))+'px';
        this.props.setAutocompletePopupHeight(0);
    }

	addTag = (tag) => {
		let selectedTags = new Set(this.props.selectedTags);
		let tags = tag;
		if (this.props.supportsTagsAutocomplete) {
			tags = [tag];
		}
		else {
			tags = tag.split(",");
		}
		for (let tag of tags) {
			let trimmedTag = tag.trim();
			if (trimmedTag) {
				selectedTags.add(trimmedTag);
			}
		}
		this.setState({ tagsInput: "", currentTagIndex: -1 });
		this.props.updateSelectedTags(selectedTags, () => {
			this.tagsInputNode.current.focus();
		});
	}

	removeTag = (tag) => {
		let selectedTags = new Set(this.props.selectedTags);
		selectedTags.delete(tag);
		this.props.updateSelectedTags(selectedTags, () => {
			if (!this.props.selectedTags.size) {
				this.tagsInputNode.current.focus();
			}
		});
	}

	getAvailableTags() {
		let availableTags = (this.props.existingTags || []).filter(tag => {
			return !this.props.selectedTags.has(tag) && tag.toLowerCase().includes(this.state.tagsInput.toLowerCase())
		});
		return availableTags;
	}

	onTagsInputChange = (event) => {
		let value = event.target.value;
		this.setState({ tagsInput: value, currentTagIndex: -1 });
	}

	onTagAutocompleteMouseDown = (index) => {
		this.isClickingTag = true;
		this.setState({ currentTagIndex: index });
	}

	onTagAutocompleteMouseUp = (index) => {
		this.isClickingTag = false;
		let tags = this.getAvailableTags();
		this.addTag(tags[index]);
		this.setState({ currentTagIndex: -1 })
	}

	onTagsInputKeyDown = (event) => {
		let tags = this.getAvailableTags();
		if (event.key === "Enter") {
			let newTag = tags[this.state.currentTagIndex] || this.state.tagsInput.trim();
			if (newTag) {
				this.addTag(newTag);
			}
			else {
				this.handleDone();
			}
			event.preventDefault();
			event.stopPropagation();
		}
		if (!this.state.showTagsAutocomplete || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
		let nextIndex = event.key === "ArrowDown" ? this.state.currentTagIndex + 1 : this.state.currentTagIndex - 1;
		if (nextIndex >= 0 && nextIndex < tags.length) {
			this.setState({ currentTagIndex: nextIndex });
			event.preventDefault();
		}
	}

	onSelectedTagsKeyDown = (event) => {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			let nextIndex = event.key === 'ArrowLeft' ? this.selectedTagActiveIndex - 1 : this.selectedTagActiveIndex + 1;
			if (nextIndex >= 0 && nextIndex < this.props.selectedTags.size) {
				this.selectedTagActiveIndex = nextIndex;
				this.forceUpdate();
			}
		}
		else if (event.key === ' ') {
			event.preventDefault();
			let tag = Array.from(this.props.selectedTags)[this.selectedTagActiveIndex];
			this.selectedTagActiveIndex = Math.max(this.selectedTagActiveIndex - 1, 0);
			this.removeTag(tag);
		}
		else if (event.key === 'Tab') {
			event.preventDefault();
			if (event.shiftKey) {
				if (document.querySelector(".ProgressWindow-noteEditor")) {
					document.querySelector(".ProgressWindow-noteEditor").focus();
				}
				else {
					document.querySelector('.tree').focus();
				}		
			}
			else {
				this.tagsInputNode.current.focus();
			}
		}
	}

	onTagsInputFocus = () => {
		this.props.sendMessage('tagsfocus');
		this.clickingTag = false;
		this.setState({ showTagsAutocomplete: true });
	}

	onTagsInputBlur = () => {
		if (this.isClickingTag) {
			return;
		}
		if (this.state.tagsInput.trim().length) {
			this.addTag(this.state.tagsInput);
		}
		this.props.sendMessage('tagsblur');
		this.props.sendUpdate();
		this.setState({ showTagsAutocomplete: false });
	}

	render() {
		let tags = this.getAvailableTags().slice(0,100);
		let willShowAutocomplete = this.state.showTagsAutocomplete && tags.length;
		let hasActiveDescendant = willShowAutocomplete && this.state.currentTagIndex >= 0;
		
		return (
			<div className={`ProgressWindow-targetSelectorTagsRow ${willShowAutocomplete ? 'with-autocomplete' : ''} ${this.props.selectedTags.size ? 'hasTags' : ''}`}>
				<div
					className="ProgressWindow-tagsRow"
					tabIndex={this.props.selectedTags.size ? 0 : -1}
					role="group"
					aria-activedescendant={`tag_${this.selectedTagActiveIndex}`}
					onKeyDown={this.onSelectedTagsKeyDown}>
					{ Array.from(this.props.selectedTags).map((tag, index) => (
						<div key={tag}
							id={`tag_${index}`}
							className={`ProgressWindow-selectedTag ${this.selectedTagActiveIndex === index ? 'active' : ''}`}
							aria-label={tag}
							aria-description={Zotero.getString('progressWindow_removeTag')}>
							<span className="ProgressWindow-tagLabel" aria-hidden="true"> {tag} </span>
							<span
								className="ProgressWindow-removeTag"
								onClick={() => this.removeTag(tag)}>
							</span>
						</div>
					))}
				</div>
				<div className="ProgressWindow-inputRow">
					<input
						ref={this.tagsInputNode}
						className="ProgressWindow-tagsInput"
						type="text"
						role="combobox"
						aria-expanded={willShowAutocomplete}
						aria-controls="tags-autocomplete"
						aria-activedescendant={hasActiveDescendant ? `tags-autocomplete-option-${this.state.currentTagIndex}` : ""}
						aria-autocomplete="list"
						value={this.state.tagsInput}
						placeholder={this.state.tagsInput ? "" : this.text.tagsPlaceholder}
						onChange={this.onTagsInputChange}
						onKeyDown={this.onTagsInputKeyDown}
						onFocus={this.onTagsInputFocus}
						onBlur={this.onTagsInputBlur}
					/>
					<button className="ProgressWindow-button" onClick={this.props.handleDone}>{this.text.done}</button>
					{willShowAutocomplete ? (
						<div 
							id="tags-autocomplete"
							className="ProgressWindow-autocomplete" 
							role="listbox"
							ref={this.autocompletePopupRef}>
							{tags.map((tag, index) => (
								<div
									key={tag}
									id={`tags-autocomplete-option-${index}`}
									ref={el => this.autocompleteRefs[index] = el}
									className={`ProgressWindow-autocompleteOption ${this.state.currentTagIndex == index ? 'active' : ''}`}
									role="option"
									onMouseDown={() => this.onTagAutocompleteMouseDown(index)}
									onMouseUp={() => this.onTagAutocompleteMouseUp(index)}>
									{tag}
								</div>
							))}
						</div>
					) : <></>}
				</div>
			</div>
		);
	}
}
