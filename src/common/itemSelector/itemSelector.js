var tabID;
var items;
var checkboxes = {};
var item_divs = {};
var responseSent = false;

async function load() {
	Zotero.Messaging.init();
	await Zotero.i18n.init();

	var queryArg = window.location.hash.substr(1);
	var data = JSON.parse(decodeURIComponent(queryArg));
	var itemSelector = document.getElementById('item-selector');
	
	tabID = data[0];
	items = data[1];
	
	let index = 0;
	for(var i in items) {
		var title, checked = false;
		if(items[i] && typeof(items[i]) == "object" && items[i].title !== undefined) {
			title = items[i].title;
			checked = !!items[i].checked;
		} else {
			title = items[i];
		}

		var item = document.createElement('div');
		item.setAttribute('class', 'item-description');
		item.setAttribute('class', 'item');
		
		var checkbox = document.createElement('input');
		checkbox.setAttribute('type', 'checkbox');
		checkbox.setAttribute('aria-labelledby', `item_${index}`);
		if(checked) checkbox.setAttribute('checked', 1);
		
		checkbox.addEventListener('change', setFilter);
		
		item.appendChild(checkbox);
		checkboxes[i] = checkbox;
		
		var span = document.createElement('span');
		span.appendChild(document.createTextNode(title));
		span.setAttribute("id", `item_${index}`);
		index++;
		if(span.addEventListener) {
			span.addEventListener("click", makeClickHandler(checkbox), false);
		} else {
			span.onclick = makeClickHandler(checkbox);
		}
		item.appendChild(span);
		
		item_divs[i] = item;
		itemSelector.appendChild(item);
	}
	
	window.onbeforeunload = cancel;
	
	window.addEventListener("keydown", function (event) {
		if (event.keyCode == 13 || event.keyCode == 14) {
			ok();
		} else if (event.keyCode == 27) {
			cancel();
		}
	});
	
	Zotero.i18n.translateFragment(document);
}

function ok() {
	var newItems = {},
		selected = false;
	for(var i in checkboxes) {
		if(checkboxes[i].checked) {
			selected = true;
			newItems[i] = items[i];
		}
	}
	items = selected && newItems;
	sendMessage();
}

function cancel() {
	items = false;
	sendMessage();
}

function setAllCheckStates(state) {
	for(var i in checkboxes) {
		if (item_divs[i].style.display != "none") {
			checkboxes[i].checked = state;
		}
	}
	setFilter();
}
function setFilter() {
	pattern = document.getElementById('pattern').value;
	for(var i in item_divs) {
		var matched = pattern == "" || items[i].match(pattern) != null;
		var isChecked = checkboxes[i].checked;
		
		if (matched || isChecked) {
			item_divs[i].style.display = "";
			if (matched) {
				item_divs[i].classList.remove('filtered-out');
			} else {
				item_divs[i].classList.add('filtered-out');
			}
		} else {
			item_divs[i].style.display = "none";
			item_divs[i].classList.remove('filtered-out');
		}
	}
}

function makeClickHandler(checkbox) {
	return function() {
		checkbox.checked = !checkbox.checked;
		setFilter();
	};
}

document.getElementById("pattern").onkeyup = setFilter;
document.getElementById("select").onclick = function() { setAllCheckStates(true) };
document.getElementById("deselect").onclick = function() { setAllCheckStates(false) };
document.getElementById("ok").onclick = ok;
document.getElementById("cancel").onclick = cancel;
load();
