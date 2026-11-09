'use strict';

const path = require('path');
const replaceBrowser = require('./scripts/replace_browser');
const spawn = require('child_process').spawn;
const through = require('through2');
const gulp = require('gulp');
const plumber = require('gulp-plumber');
const babel = require('@babel/core');
const schemaJSON = require('./src/zotero-schema/schema.json');
const argv = require('yargs')
	.boolean('p')
	.alias('p', 'production')
	.describe('p', 'Production. Do not include translator tester.')
	.string('connector-version')
	.describe('connector-version', 'Version of the extension')
	.help('h')
	.alias('h', 'help')
	.default({'connector-version': '4.999.0', p: false})
	.argv;

var injectInclude = [
	'zotero_config.js',
	'zotero.js',
	'translate/promise.js',
	'utilities/date.js',
	'utilities/xregexp-all.js',
	'utilities/xregexp-unicode-zotero.js',
	'utilities/resource/zoteroTypeSchemaData.js',
	'utilities/utilities.js',
	'utilities/utilities_item.js',
	'utilities.js',	
	'network-policy.js',
	'http.js',
	'proxy.js',
	'translate/debug.js',
	'utilities/schema.js',
	'translate/translator.js',
	'inject/http.js',
	'itemSaver.js',
	'inject/pageSaving.js',
	'cachedTypes.js',
	'schema.js',
	'messages.js',
	'zoteroFrame.js',
	'messaging_inject.js',
	'inject/progressWindow_inject.js',
	'inject/modalPrompt_inject.js',
	'messagingGeneric.js',
	'i18n.js',
	'singlefile.js'
];
var injectIncludeLast;
if (argv.p) {
	injectIncludeLast = ['inject/inject.js'];
} else {
	injectIncludeLast = [
		'tools/testTranslators/translatorTester_messages.js',
		'inject/inject.js',
		'tools/testTranslators/translatorTester_inject.js'
	];
}
var injectIncludeBrowserExt = ['browser-polyfill.js'].concat(
	injectInclude,
	['inject/remoteTranslate.js'],
	injectIncludeLast);

const BROWSERS = ['manifestv3', 'firefox'];

var backgroundInclude = [
	'zotero_config.js',
	'zotero.js',
	'i18n.js',
	'translate/promise.js',
	'utilities/date.js',
	'utilities/openurl.js',
	'utilities/xregexp-all.js',
	'utilities/xregexp-unicode-zotero.js',
	'utilities/resource/zoteroTypeSchemaData.js',
	'utilities/utilities.js',
	'utilities/utilities_item.js',
	'utilities/resource/zoteroTypeSchemaData.js',
	'utilities.js',
	'prefs.js',
	'network-policy.js',
	'http.js',
	'proxy.js',
	'secure-connector.js',
	'siteBlocklist.js',
	'retrievalModel.js',
	'connector.js',
	'translatorTrust.js',
	'repo.js',
	'translate/debug.js',
	'translate/tlds.js',
	'translate/translator.js',
	'botBypass.js',
	'itemSaver_background.js',
	'translators.js',
	'cachedTypes.js',
	'errors_webkit.js',
	'messages.js',
	'messaging.js',
];


if (!argv.p) {
	backgroundInclude.push('tools/testTranslators/translatorTester_messages.js',
		'tools/testTranslators/translatorTester_background.js',
		'lib/sinon.js');
		
	injectIncludeBrowserExt.push('test/testInject.js');
}
var backgroundIncludeBrowserExt = backgroundInclude.concat([
	'hostPermissions.js',
	'webRequestIntercept.js',
	'saveWithoutProgressWindow.js',
	'retrieval.js',
	'messagingGeneric.js',
	'browserAttachmentMonitor/browserAttachmentMonitor.js',
	'translateHost/translateHostFunctionOverrides.js',
	'translateHost/translateHostFrameManager.js',
]);
var backgroundIncludeManifestV3 = ['browser-polyfill.js'].concat(backgroundIncludeBrowserExt, ['background/offscreenManager.js']);
var backgroundIncludeManifestV2 = backgroundIncludeBrowserExt.concat(['zoteroFrame.js']);

var reloadChromiumTimeout;
var chromiumReloadProcess;
function reloadChromiumExtension() {
	clearTimeout(reloadChromiumTimeout);
	reloadChromiumTimeout = setTimeout(function () {
		if (!chromiumReloadProcess) {
			chromiumReloadProcess = spawn(
				path.join(__dirname, 'scripts/reload-chromium-extension'),
				['--persistent'],
				{ stdio: ['pipe', 'inherit', 'inherit'] }
			);
			chromiumReloadProcess.on('error', function (error) {
				console.error(`Failed to start Chromium extension reloader: ${error.message}`);
			});
			chromiumReloadProcess.stdin.on('error', function (error) {
				if (error.code !== 'EPIPE') {
					console.error(`Failed to request Chromium extension reload: ${error.message}`);
				}
			});
			chromiumReloadProcess.on('close', function (code) {
				chromiumReloadProcess = null;
				if (code) console.error(`Chromium extension reloader exited with code ${code}`);
			});
		}
		chromiumReloadProcess.stdin.write('\n');
	}, 250);
}

function replaceScriptsHTML(string, match, scripts) {
	return string.replace(match,
		scripts.map((s) => '<script type="text/javascript" src="' + s + '"></script>')
			.join('\n'));
}

function processFile() {
	return through.obj(async function(file, enc, cb) {
		console.log(file.path.slice(file.cwd.length));
		var offset = file.cwd.split(path.sep).length;
		var parts = file.path.split(path.sep);
		var basename = parts[parts.length-1];
		var ext = basename.split('.')[1];
		for (var i = offset; i < parts.length; i++) {
			if ('src' === parts[i]) {
				i++;
				break;
			}
		}
		var type = parts[i];

		var sourcefile = parts.slice(i).join('/');
		
		if (ext == 'jsx') {
			try {
				file.contents = Buffer.from(
					babel.transform(
						file.contents,
						{
							plugins: [
								'@babel/plugin-transform-react-jsx',
								'@babel/plugin-proposal-class-properties'
							]
						}
					).code
				);
			} catch (e) {
				console.log(e.message);
				return;
			}
			parts[parts.length-1] = basename = basename.substr(0, basename.length-1);
		}
		
		switch (basename) {
			case 'zotero_config.js':
				var contents = file.contents.toString();
				if (process.env.ABSTRACTUS_CONNECTOR_URL) {
					contents = contents.replace(/CONNECTOR_URL: [^,]*/,
						`CONNECTOR_URL: "${process.env.ABSTRACTUS_CONNECTOR_URL}"`);
				}
				if (process.env.ZOTERO_REPOSITORY_URL) {
					contents = contents.replace(/REPOSITORY_URL: [^,]*/,
						`REPOSITORY_URL: "${process.env.ZOTERO_REPOSITORY_URL}"`);
				}
				if (process.env.ZOTERO_ALWAYS_FETCH_FROM_REPOSITORY) {
					contents = contents.replace('ALWAYS_FETCH_FROM_REPOSITORY: false',
						'ALWAYS_FETCH_FROM_REPOSITORY: true');
				}
				file.contents = Buffer.from(contents);
				break;
			case 'zotero.js':
				var contents = file.contents.toString();
				if (!argv.p) {
					contents = contents.replace('"debug.log": false', '"debug.log": true')
						.replace("this.isDebug = false", "this.isDebug = true");
				}
				contents = contents.replace('"SET_IN_BUILD:allowRepoTranslatorTester"',
					`this.allowRepoTranslatorTester = ${!!process.env.ZOTERO_REPOSITORY_URL}`);
				file.contents = Buffer.from(contents);
				break;
			case 'schema.js': {
				file.contents = Buffer.from(file.contents.toString()
					.replace("__ZOTERO_SCHEMA__",
						JSON.stringify(schemaJSON)
					));
				break;
			}
			case 'preferences.html':
			case 'progressWindow.html':
			case 'modalPrompt.html':
			case 'translateHost.html':
			case 'offscreen.html':
				file.contents = Buffer.from(file.contents.toString()
					.replace(/__BEGIN_DEBUG__([\s\S]*?)__END_DEBUG__/g, argv.p ? '' : '$1'));
				break;
		}

		let f;
		
		if (type === 'common' || type === 'browserExt') {
			if (file.path.includes('.html')) {
				file.contents = Buffer.from(replaceScriptsHTML(
					file.contents.toString(), "__SCRIPTS__", injectIncludeBrowserExt.map(s => `../../${s}`)));
			}
			for (let browser of BROWSERS) {
				if (basename === 'manifest.json' && browser === 'manifestv3'
					|| basename === 'manifest-v3.json' && browser === 'firefox') {
					continue;
				}
				
				f = file.clone({contents: false});
				if (['manifest.json', "manifest-v3.json", "background.js", "background-worker.js"].includes(basename)) {
					let contents = f.contents.toString();
					if (basename == 'manifest-v3.json') {
						parts[parts.length - 1] = 'manifest.json';
						contents = contents
							.replace("__INJECT_SCRIPTS__",
								injectIncludeBrowserExt.map((s) => `"${s}"`).join(',\n\t\t\t'));
						if (process.env.CHROME_EXTENSION_KEY && ['manifestv3'].includes(browser)) {
							contents = contents.replace(/("name": "[^"]*")/, `$1,\n\t"key": "${process.env.CHROME_EXTENSION_KEY}"`);
						}
					}
					else {
						let backgroundScripts = browser == "firefox"
							? backgroundIncludeManifestV2
							: backgroundIncludeManifestV3;
						contents = contents
							.replace("__BACKGROUND_SCRIPTS__",
								backgroundScripts.map((s) => `"${s}"`).join(',\n\t\t\t'))
							.replace("__INJECT_SCRIPTS__",
								injectIncludeBrowserExt.map((s) => `"${s}"`).join(',\n\t\t\t'))
					}
					
					contents = contents.replace("__EXCLUDE_MATCHES__",
						require('./src/common/siteBlocklist.js').manifestExcludeMatches().map(s => `"${s}"`).join(',\n\t\t\t\t'));
					contents = contents
						.replace(/"version": "[^"]*"/, '"version": "' + argv.connectorVersion + '"');
					if (typeof process.env.ZOTERO_BETA_BUILD_EXPIRATION != 'undefined') {
						contents = contents.replace('_betaBuildExpiration = new Date(2053, 0, 1, 0, 0, 0)',
							`_betaBuildExpiration = new Date(${process.env.ZOTERO_BETA_BUILD_EXPIRATION})`);
					}
					f.contents = Buffer.from(contents);
				}
				if (file.path.includes('.html')) {
					let contents = f.contents.toString()
						.replace(/\s*__BEGIN_SAFARI__[\s\S]*?__END_SAFARI__/g, '');
					f.contents = Buffer.from(contents);
				}
				if (basename == 'zotero.js') {
					let contents = f.contents.toString()
						.replace('this.version = [^;]*', `this.version = "${argv.version}";`);
					contents = replaceBrowser(contents, {
						firefox: browser == 'firefox',
						safari: browser == 'safari',
						manifestV3: browser == 'manifestv3'
					});
					f.contents = Buffer.from(contents);
				}
				f.path = parts.slice(0, i-1).join('/') + `/build/${browser}/` + parts.slice(i+1).join('/');
				console.log(`-> ${f.path.slice(f.cwd.length)}`);
				this.push(f);
			}
		}

		cb();
	});
}

gulp.task('watch', function () {
	var watcher = gulp.watch(['./src/browserExt/**', './src/common/**']);
	watcher.on('change', function(path) {
		gulp.src(path)
			.pipe(plumber())
			.pipe(processFile())
			.pipe(gulp.dest((data) => data.base));
	});
});  

gulp.task('watch-chromium', function () {
	var watcher = gulp.watch(['./src/browserExt/**', './src/common/**']);
	watcher.on('change', function(filePath) {
		gulp.src(filePath)
			.pipe(plumber())
			.pipe(processFile())
			.pipe(gulp.dest((data) => data.base))
			.on('end', reloadChromiumExtension);
	});
});

gulp.task('process-custom-scripts', function() {
	let sources = [
		'./src/browserExt/background.js',
		'./src/browserExt/background-worker.js',
		'./src/browserExt/manifest.json',
		'./src/browserExt/manifest-v3.json',
		'./src/common/preferences/preferences.html',
		'./src/common/progressWindow/progressWindow.html',
		'./src/common/modalPrompt/modalPrompt.html',
		'./src/browserExt/translateHost/translateHost.html',
		'./src/browserExt/offscreen/offscreen.html',
		'./src/common/schema.js',
		'./src/common/zotero.js',
		'./src/common/zotero_config.js',
		'./src/common/test/**/*',
		'./src/{common,browserExt}/**/*.jsx',
	];
	return gulp.src(sources)
		.pipe(plumber())
		.pipe(processFile())
		.pipe(gulp.dest((data) => data.base));
});

gulp.task('default', gulp.series(['watch']));
