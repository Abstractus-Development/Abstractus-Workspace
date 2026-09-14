// One-command version bump for the Abstractus Connector:
//   npm run release            -> 1.0.0 -> 1.0.1 (patch)
//   npm run release -- minor   -> 1.0.1 -> 1.1.0
//   npm run release -- 2.0.0   -> exact version
//   add --push to push the commit and the vX.Y.Z tag
// package.json is the single source of truth: build.mjs stamps it into both manifests
// and zotero.js, so nothing else needs editing.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const push = args.includes('--push');
const spec = args.find(a => !a.startsWith('--')) || 'patch';

const git = (...a) => execFileSync('git', ['-C', root, ...a], {encoding: 'utf8', windowsHide: true}).trim();
const pkgPath = path.join(root, 'package.json');
const text = fs.readFileSync(pkgPath, 'utf8');
const current = JSON.parse(text).version;
const next = bump(current, spec);

if (git('status', '--porcelain')) throw new Error('Commit or stash your changes first; a release commit must contain only the version bump.');
if (git('rev-parse', '--abbrev-ref', 'HEAD') === 'HEAD') throw new Error('Check out a branch before releasing.');
if (git('tag', '-l', `v${next}`)) throw new Error(`Tag v${next} already exists.`);

fs.writeFileSync(pkgPath, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`));
git('add', 'package.json');
git('commit', '-q', '-m', `Release v${next}`);
git('tag', '-a', `v${next}`, '-m', `Abstractus Connector ${next}`);
console.log(`${current} -> ${next}: committed and tagged v${next}`);
if (push) {
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
	git('push', 'origin', branch, `v${next}`);
	console.log(`Pushed ${branch} and v${next}`);
}
else console.log(`Push with: git push origin HEAD v${next}   (or rerun with --push)`);

function bump(version, spec) {
	if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!m) throw new Error(`Current version "${version}" is not X.Y.Z`);
	let [major, minor, patch] = m.slice(1).map(Number);
	if (spec === 'major') { major++; minor = 0; patch = 0; }
	else if (spec === 'minor') { minor++; patch = 0; }
	else if (spec === 'patch') patch++;
	else throw new Error(`Unknown bump "${spec}": use patch, minor, major or X.Y.Z`);
	return `${major}.${minor}.${patch}`;
}
