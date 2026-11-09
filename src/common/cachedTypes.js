Zotero.Connector_Types = new function() {
	var TypeSchema = ZOTERO_TYPE_SCHEMA;
	this.init = function() {
		const schemaTypes = ["itemTypes", "creatorTypes", "fields"];
		
		for(var i=0; i<schemaTypes.length; i++) {
			var schemaType = schemaTypes[i];
			this[schemaType] = Zotero.Utilities.deepCopy(TypeSchema[schemaType]);
			for(var id in TypeSchema[schemaType]) {
				var entry = this[schemaType][id];
				entry.unshift(parseInt(id, 10));
				this[schemaType][entry[1]] = entry;
			}
		}
			
		var itemTypes = Zotero.Connector_Types["itemTypes"];
		var creatorTypes = Zotero.Connector_Types["creatorTypes"];
		var fields = Zotero.Connector_Types["fields"];

		Zotero.CachedTypes = function() {
			var thisType = Zotero.Connector_Types[this.schemaType];
			
			this.getID = function(idOrName) {
				var type = thisType[idOrName];
				return (type ? type[0] : false);
			};
			
			this.getName = function(idOrName) {
				var type = thisType[idOrName];
				return (type ? type[1] : false);
			};
			
			this.getLocalizedString = function(idOrName) {
				var type = thisType[idOrName];
				return (type ? type[2] : false);
			};
		}
		
		Zotero.ItemTypes = new function() {
			this.schemaType = "itemTypes";
			Zotero.CachedTypes.call(this);
			
			this.getImageSrc = function(idOrName) {
				var itemType = Zotero.Connector_Types["itemTypes"][idOrName];
				var icon = itemType ? itemType[6] : "treeitem-"+idOrName+".png";
				
				return Zotero.getExtensionURL("images/" + icon);
			};
		}
		
		Zotero.CreatorTypes = new function() {
			this.schemaType = "creatorTypes";
			Zotero.CachedTypes.call(this);
			
			this.getTypesForItemType = function(idOrName) {
				var itemType = itemTypes[idOrName];
				if(!itemType) return false;
				
				var itemCreatorTypes = itemType[3];
				if (!itemCreatorTypes
						|| (itemCreatorTypes.length == 1 && !itemCreatorTypes[0])) {
					return [];
				}
				var n = itemCreatorTypes.length;
				var outputTypes = new Array(n);
				
				for(var i=0; i<n; i++) {
					var creatorType = creatorTypes[itemCreatorTypes[i]];
					outputTypes[i] = {"id":creatorType[0],
						"name":creatorType[1]};
				}
				return outputTypes;
			};
			
			this.getPrimaryIDForType = function(idOrName) {
				var itemType = itemTypes[idOrName];
				if(!itemType) return false;
				return itemType[3][0];
			};
			
			this.isValidForItemType = function(creatorTypeID, itemTypeID) {
				let itemType = itemTypes[itemTypeID];
				return itemType[3].includes(creatorTypeID);
			};
		};
		
		Zotero.ItemFields = new function() {
			this.schemaType = "fields";
			Zotero.CachedTypes.call(this);
			
			this.isValidForType = function(fieldIdOrName, typeIdOrName) {
				var field = fields[fieldIdOrName], itemType = itemTypes[typeIdOrName];
				
				if(!field || !itemType) return false;
				
				return itemType[4].indexOf(field[0]) !== -1;
			};
			
			this.isBaseField = function(fieldID) {
				return fields[fieldID][2];
			};
			
			this.getFieldIDFromTypeAndBase = function(typeIdOrName, fieldIdOrName) {
				var baseField = fields[fieldIdOrName], itemType = itemTypes[typeIdOrName];
				
				if(!baseField || !itemType) return false;
				
				baseField = baseField[0];
				
				var baseFields = itemType[5];
				for(var i in baseFields) {
					if(baseFields[i] === baseField) {
						return i;
					}
				}
				
				return false;
			};
			
			this.getBaseIDFromTypeAndField = function(typeIdOrName, fieldIdOrName) {
				var field = fields[fieldIdOrName], itemType = itemTypes[typeIdOrName];
				if(!field || !itemType) {
					throw new Error("Invalid field or type ID");
				}
				
				var baseField = itemType[5][field[0]];
				return baseField ? baseField : false;
			};
			
			this.getItemTypeFields = function(typeIdOrName) {
				return itemTypes[typeIdOrName][4].slice();
			};
		}
	};
	
	this.getSchema = async function() {
		return TypeSchema;
	};
}