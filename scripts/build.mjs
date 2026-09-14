#!/usr/bin/env node
/*
	Abstractus Connector build script (cross-platform replacement for build.sh).

	Usage: node scripts/build.mjs [-d] [-v VERSION] [--zip]
	  -d            debug build (translator tester, test pages, unminified debug libs)
	  -v VERSION    extension version (defaults to package.json "version")
	  --zip         also package dist/Abstractus_Connector-{chrome,firefox}-VERSION.zip

	Output:
	  build/manifestv3   Chrome / Edge / Brave / Arc (Manifest V3)
	  build/firefox      Firefox (Manifest V2)
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const LIB = path.join(ROOT, 'lib');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const TRANSLATE = path.join(SRC, 'translate');
const UTILITIES = path.join(SRC, 'utilities');
const SKIN = path.join(SRC, 'zotero', 'chrome', 'skin', 'default', 'zotero');

const args = process.argv.slice(2);
const DEBUG = args.includes('-d');
const ZIP = args.includes('--zip');
const versionIdx = args.indexOf('-v');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = versionIdx >= 0 ? args[versionIdx + 1] : pkg.version;
if (!VERSION || !/^\d+(\.\d+){0,3}$/.test(VERSION)) {
	fail(`Invalid version "${VERSION}". Chrome requires 1-4 dot-separated integers.`);
}

function fail(msg) {
	console.error(`\nBuild failed: ${msg}`);
	process.exit(1);
}

function rm(p) {
	// Retry: browsers with the unpacked extension loaded can briefly lock files on Windows
	fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function renameBuild(from, to) {
    for (const target of [from, to]) {
        const relative = path.relative(BUILD, path.resolve(target));
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('Invalid build rename path');
    }
    for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(from, to); return; }
        catch (error) {
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 10) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        }
    }
}

function copy(from, to, { exclude = () => false } = {}) {
	fs.cpSync(from, to, {
		recursive: true,
		force: true,
		filter: (src) => !path.basename(src).startsWith('.') && !exclude(src)
	});
}

function walk(dir, fn) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(p, fn);
		else fn(p);
	}
}

function requirePath(p, hint) {
	if (!fs.existsSync(p)) fail(`${path.relative(ROOT, p)} is missing. ${hint}`);
}

requirePath(path.join(TRANSLATE, 'src'), 'Run `git submodule update --init`.');
requirePath(path.join(UTILITIES, 'utilities.js'), 'Run `git submodule update --init`.');
requirePath(SKIN, 'Run `git submodule update --init`.');
requirePath(path.join(SRC, 'zotero-schema', 'schema.json'), 'Run `git submodule update --init`.');
requirePath(path.join(NODE_MODULES, 'gulp'), 'Run `npm install`.');

console.log(`Building Abstractus Connector ${VERSION}${DEBUG ? ' (debug)' : ''}…`);

for (const dir of ['browserExt', 'manifestv3', 'firefox', 'chrome', 'safari']) {
	rm(path.join(BUILD, dir));
}
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(BUILD, 'browserExt');
fs.mkdirSync(path.join(out, 'images'), { recursive: true });

// Images: item-type icons from the Zotero client submodule, then our own images, which
// override same-named files (e.g. the toolbar status icons carry the Abstractus logo)
const skinFiles = fs.readdirSync(SKIN).filter((f) => /^treeitem.*\.png$/.test(f) || [
	'treesource-collection.png', 'treesource-library.png', 'zotero-new-z-16px.png',
	'progress_arcs.png', 'cross.png', 'tick.png', 'tick@2x.png',
	'spinner-16px.png', 'spinner-16px@2x.png'
].includes(f));
for (const f of skinFiles) {
	fs.copyFileSync(path.join(SKIN, f), path.join(out, 'images', f));
}
for (const size of [16, 32, 48, 64, 128]) {
	fs.copyFileSync(path.join(ROOT, 'icons', `Icon-${size}.png`), path.join(out, `Icon-${size}.png`));
}

fs.copyFileSync(path.join(ROOT, 'COPYING'), path.join(out, 'COPYING'));
copy(path.join(SRC, 'common'), out);
copy(path.join(SRC, 'browserExt'), out);

// Set version
const zoteroJS = path.join(out, 'zotero.js');
fs.writeFileSync(zoteroJS, fs.readFileSync(zoteroJS, 'utf8')
	.replace(/^(\s*this\.version\s*=\s*)"[^"]*"/m, `$1"${VERSION}"`));

// Translation framework
copy(path.join(TRANSLATE, 'src'), path.join(out, 'translate'));
copy(UTILITIES, path.join(out, 'utilities'));
for (const p of ['.github', 'test', 'package.json', 'package-lock.json', 'COPYING', 'README.md',
		'resource/README.md', 'resource/schema']) {
	rm(path.join(out, 'utilities', p));
}

// Locales (English only -- other Zotero locales contain Zotero branding)
fs.mkdirSync(path.join(out, '_locales', 'en'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'messages.json'), path.join(out, '_locales', 'en', 'messages.json'));

// Libraries
const libDir = path.join(out, 'lib');
fs.mkdirSync(libDir, { recursive: true });
const libs = {
	'react/umd/react.production.min.js': 'react.js',
	'react-dom/umd/react-dom.production.min.js': 'react-dom.js',
	'prop-types/prop-types.min.js': 'prop-types.js',
	'dompurify/dist/purify.min.js': 'dompurify.js',
	'react-dom-factories/index.js': 'react-dom-factories.js'
};
if (DEBUG) {
	Object.assign(libs, {
		'bluebird/js/browser/bluebird.js': 'bluebird.js',
		'chai/chai.js': 'chai.js',
		'mocha/mocha.js': 'mocha.js',
		'mocha/mocha.css': 'mocha.css',
		'sinon/pkg/sinon.js': 'sinon.js'
	});
}
for (const [from, to] of Object.entries(libs)) {
	const src = path.join(NODE_MODULES, from);
	requirePath(src, 'Run `npm install`.');
	fs.copyFileSync(src, path.join(libDir, to));
}

// JSX is compiled by gulp
walk(out, (p) => p.endsWith('.jsx') && fs.rmSync(p));

// Prebuilt SingleFile bundles (see scripts/update-single-file)
fs.mkdirSync(path.join(libDir, 'SingleFile'), { recursive: true });
for (const f of ['single-file-bootstrap.js', 'single-file-hooks-frames.js', 'single-file.js']) {
	fs.copyFileSync(path.join(LIB, 'SingleFile', f), path.join(libDir, 'SingleFile', f));
}
fs.copyFileSync(path.join(SRC, 'zotero', 'chrome', 'content', 'zotero', 'xpcom', 'singlefile.js'),
	path.join(out, 'singlefile-config.js'));

if (DEBUG) {
	const testTranslators = path.join(TRANSLATE, 'testTranslators');
	if (fs.existsSync(testTranslators)) {
		for (const f of fs.readdirSync(testTranslators).filter((f) => f.endsWith('.mjs'))) {
			fs.copyFileSync(path.join(testTranslators, f), path.join(out, 'tools', 'testTranslators', f));
		}
	}
}
else {
	rm(path.join(out, 'tools'));
}

// Per-browser directories
copy(out, path.join(BUILD, 'manifestv3'));
renameBuild(out, path.join(BUILD, 'firefox'));

// Process manifests, HTML and JSX with gulp
const gulpArgs = [path.join(NODE_MODULES, 'gulp', 'bin', 'gulp.js'), 'process-custom-scripts',
	'--connector-version', VERSION];
if (!DEBUG) gulpArgs.push('-p');
const gulp = spawnSync(process.execPath, gulpArgs, { cwd: ROOT, encoding: 'utf8' });
fs.writeFileSync(path.join(ROOT, 'build.log'), (gulp.stdout || '') + (gulp.stderr || ''));
if (gulp.status !== 0) {
	// Print the output as well as writing it: on CI nobody can open build.log, and a bare
	// "see build.log" hides the actual error behind a whole debugging round-trip.
	process.stderr.write((gulp.stdout || '') + (gulp.stderr || ''));
	fail(`gulp exited with ${gulp.status} (output above, also in build.log).`);
}

for (const browser of ['manifestv3', 'firefox']) {
	const dir = path.join(BUILD, browser);
	rm(path.join(dir, 'manifest-v3.json'));

	// Use larger icons where available; browsers downscale them for HiDPI toolbars
	const images = path.join(dir, 'images');
	for (const suffix of ['@2x', '@48px']) {
		for (const f of fs.readdirSync(images).filter((f) => f.endsWith(`${suffix}.png`))) {
			fs.copyFileSync(path.join(images, f), path.join(images, f.replace(suffix, '')));
		}
	}

	if (browser === 'manifestv3') {
		const manifestPath = path.join(dir, 'manifest.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		delete manifest.applications;
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
	}

	if (!DEBUG) {
		rm(path.join(dir, 'test'));
	}
}

console.log('Built build/manifestv3 (Chromium) and build/firefox');

if (ZIP) {
	for (const [browser, name] of [['manifestv3', 'chrome'], ['firefox', 'firefox']]) {
		const file = path.join(DIST, `Abstractus_Connector-${name}-${VERSION}.zip`);
		rm(file);
		const dir = path.join(BUILD, browser);
		// Windows ships bsdtar (libarchive) as System32\tar.exe, the only tar here that can
		// write a zip. Call it by full path: a PATH lookup finds Git for Windows' GNU tar
		// first in a Git Bash shell, and GNU tar cannot create zip archives at all — it also
		// reads the "C:" of an absolute archive path as a remote host and fails with
		// "tar: Cannot connect to C: resolve failed".
		const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
		const result = process.platform === 'win32'
			? spawnSync(bsdtar, ['-a', '-c', '-f', file, '*'], { cwd: dir, stdio: 'inherit', shell: true })
			: spawnSync('zip', ['-qr', file, '.'], { cwd: dir, stdio: 'inherit' });
		if (result.status !== 0) fail(`Packaging ${browser} failed`);
		console.log(`Packaged ${path.relative(ROOT, file)}`);
	}
}
