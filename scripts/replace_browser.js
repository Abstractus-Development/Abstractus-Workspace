module.exports = function(filetext, config) {
	config = Object.assign({
		firefox: false,
		safari: false,
		manifestV3: false,
	}, config);
	for (let browserOption in config) {
		let value = config[browserOption];
		browserOption = browserOption[0].toUpperCase() + browserOption.slice(1);
		let regexp = new RegExp(`"SET_IN_BUILD:is${browserOption}"`);
		filetext = filetext.replace(regexp,
			`this.is${browserOption} = ${value}`)
	}
	return filetext
}
