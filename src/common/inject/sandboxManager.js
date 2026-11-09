Zotero.Translate.SandboxManager = function(sandboxLocation) {
	this.sandbox = {"Zotero":{}};
}

Zotero.Translate.SandboxManager.prototype = {
	"eval":function(code, functions) {
		for (var i in functions) {
			delete this.sandbox[functions[i]];
		}

		for (var prop in this.sandbox) {
			code = 'var ' + prop + ' = this.sandbox.' + prop + ';' + code;
		}

		for (var i in functions) {
			try {
				code += 'this.sandbox.' + functions[i] + ' = ' + functions[i] + ';';
			} catch (e) {
			}
		}

		(function() {
			eval(code);
		}).call(this);
	},
	
	"importObject":function(object, passAsFirstArgument, attachTo) {
		if(!attachTo) attachTo = this.sandbox.Zotero;
		
		for(var key in (object.__exposedProps__ ? object.__exposedProps__ : object)) {
			if(Function.prototype[key]) continue;
			if(typeof object[key] === "function" || typeof object[key] === "object") {
				attachTo[key] = new function() {
					var fn = object[key];
					return function() {
						var args = (passAsFirstArgument ? [passAsFirstArgument] : []);
						for(var i=0; i<arguments.length; i++) {
							args.push(arguments[i]);
						}
						
						return fn.apply(object, args);
					};
				}
				
				this.importObject(object[key], passAsFirstArgument ? passAsFirstArgument : null, attachTo[key]);
			} else {
				attachTo[key] = object[key];
			}
		}
	}
}