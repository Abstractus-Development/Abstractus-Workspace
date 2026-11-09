(function() {
var win = window,
	doc = window.document;
win.Zotero = win.Zotero || {};
Zotero.UI = Zotero.UI || {};

Zotero.UI.Notification = function(text, buttons) {
	this.text = text;
	if (!buttons) {
		buttons = [{
			title: "✕",
			dismiss: true
		}]
	}
	for (let i = 0; i < buttons.length; i++) {
		let button = buttons[i];
		if (button.onClick && button.dismiss) {
			button.onClick = this.dismiss.bind(this, button.onClick, i);
		} else if (!button.onClick) {
			button.onClick = this.dismiss.bind(this, null, i);
		}
	}
	this.buttons = buttons;
	this.elems = {};
};

Zotero.UI.Notification.rootStyle = {
	position: "fixed",
	top: 0,
	left: 0,
	zIndex: 2147483647,
	width: "100%",
	background: "rgb(255, 234, 80)",
	borderBottom: "#a9a9a9 .5px solid",
	padding: "3px 2em 4px",
	display: "flex",
	flexDirection: "row",
	lineHeight: "2.2em",
	alignItems: "center",
	boxSizing: "border-box",
	cursor: "default",
};

Zotero.UI.Notification.textStyle = {
	fontFamily: "Lucida Grande, Tahoma, sans",
	fontSize: "13.5px",
	fontWeight: "bold",
	color: "black",
};

Zotero.UI.Notification.buttonStyle = Object.assign({
	padding: "3px",
	textDecoration: "none",
	margin: "0",
	marginLeft: "30px",
	whiteSpace: "nowrap"
}, Zotero.UI.Notification.textStyle);

function injectStyle() {
	if (doc.getElementById('zotero-notification-style')) return;
	var style = doc.createElement('style');
	style.id = 'zotero-notification-style';
	style.textContent = '.zotero-notification a:hover { color: rgba(0,0,0,0.8) !important; }';
	(doc.head || doc.documentElement).appendChild(style);
}

Zotero.UI.Notification.prototype = {
	show: function() {
		if (this.deferred) return deferred.promise;
		this.deferred = Zotero.Promise.defer();
		injectStyle();
		var elem = doc.createElement('div');
		for (let param in Zotero.UI.Notification.rootStyle) {
			elem.style[param] = Zotero.UI.Notification.rootStyle[param];
		}
		for (let param in Zotero.UI.Notification.textStyle) {
			elem.style[param] = Zotero.UI.Notification.textStyle[param];
		}
		this.elems.root = elem;
		elem.classList.add('zotero-notification');

		elem = doc.createElement('span');
		elem.innerHTML = this.text;
		elem.style.flexGrow = 1;
		this.elems.text = elem;
		this.elems.root.appendChild(elem);

		elem = doc.createElement('span');
		elem.style.minWidth = "30px";
		this.elems.root.appendChild(elem);
		
		this.elems.buttons = [];
		for (let i = this.buttons.length-1; i >= 0; i--) {
			let button = this.buttons[i];
			elem = doc.createElement('a');
			elem.dataset.id = i;
			elem.setAttribute('href', 'javascript:void(0)');
			for (let param in Zotero.UI.Notification.buttonStyle) {
				elem.style[param] = Zotero.UI.Notification.buttonStyle[param];
			}
			for (let param in Zotero.UI.Notification.textStyle) {
				elem.style[param] = Zotero.UI.Notification.textStyle[param];
			}
			this.elems.buttons.push(elem);
			this.elems.root.appendChild(elem);
			button.onClick && elem.addEventListener('click', button.onClick);

			elem = doc.createTextNode(button.title);
			this.elems.buttons[this.buttons.length-1-i].appendChild(elem);
		}
		
		doc.body.insertBefore(this.elems.root, doc.body.firstChild);
		
		return this.deferred.promise;
	},
	
	dismiss: function(onClick=null, buttonIndex=0) {
		onClick && onClick(this);
		if (!this.elems.root) return;
		doc.body.removeChild(this.elems.root);
		this.deferred.resolve(buttonIndex);
		this.deferred = null;
	}
};
})();
