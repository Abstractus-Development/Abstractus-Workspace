# Abstractus Connector

A browser extension that saves articles, PDFs and search results straight into **Abstractus Desktop**.
It is a fork of the [Zotero Connector](https://github.com/zotero/zotero-connectors) and keeps its
translation engine, so it understands the same thousands of publisher, database and library sites.

- **Chromium** (Chrome, Edge, Brave, Arc): Manifest V3 build in `build/manifestv3`
- **Firefox**: Manifest V2 build in `build/firefox`

## How it works

```
 web page ──(site translator)──▶ Connector ──HTTP 127.0.0.1:23130──▶ Abstractus Desktop vault
                                     ▲
                 repo.zotero.org ────┘  translator updates every 24 h
```

1. **Detect.** Site translators (the page parsers) are downloaded from the Zotero translator repository
   and refreshed every 24 hours, so parsing fixes arrive without a new Connector release.
2. **Save.** The Connector sends the item metadata (Zotero JSON plus a CSL-JSON copy) and any PDF to
   the local connector server built into Abstractus Desktop
   (`src-tauri/src/connector.rs` in the desktop repo). It speaks the Zotero connector protocol v3
   (`ping`, `getSelectedCollection`, `saveItems`, `saveAttachment`, `saveStandaloneAttachment`,
   `saveSnapshot`, `updateSession`).
3. **File.** The save popup lets you pick a vault collection and add tags.

Abstractus Desktop must be running. If it isn't, the Connector prompts you to open it; nothing is sent
anywhere else.

## Building

Requirements: Node 20+, git.

```sh
git submodule update --init   # translate engine, utilities, item-type icons, schema
npm install
npm run build                 # production build → build/manifestv3 and build/firefox
npm run build:debug           # adds translator tester and test pages
npm run package               # also writes dist/Abstractus_Connector-{chrome,firefox}-<version>.zip
```

The build script (`scripts/build.mjs`) works on Windows, macOS and Linux; `build.sh` is a thin wrapper.
The version comes from `package.json` (override with `-v`). Keep it in the 5.0.x range: the translator
repository uses it to decide which translators are compatible.

Set `ABSTRACTUS_CONNECTOR_URL` at build time to point the Connector at a different desktop port.

### Loading the unpacked extension

- **Chrome / Edge:** open `chrome://extensions` (or `edge://extensions`), enable Developer Mode, choose
  **Load unpacked** and select `build/manifestv3`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select
  `build/firefox/manifest.json`.

`npm run watch` rebuilds changed files; reload the extension afterwards.

## Staying in sync with upstream Zotero

Parser fixes come from two places, and both keep flowing.

| What | How it updates |
| --- | --- |
| Site translators (per-site parsing rules) | Automatically, at runtime, from `repo.zotero.org` every 24 h. No action needed. |
| Translation engine, utilities, schema (`src/translate`, `src/utilities`, `src/zotero-schema`) | Git submodules. Bumped when you merge upstream. |
| Connector code (saving, proxies, bot bypass, SingleFile, …) | Merge from the upstream repository. |

The `upstream` remote points at `https://github.com/zotero/zotero-connectors`. To pull in upstream work:

```sh
git fetch upstream
git merge upstream/master
git submodule update --init
npm install
npm run build
```

### Where conflicts are likely

The fork was kept close to upstream to keep merges small. Expect conflicts mainly in:

- `src/common/zotero_config.js`, `src/messages.json`, both manifests: branding and endpoints (keep ours)
- `gulpfile.js` and `build.sh` / `scripts/build.mjs`: Safari and Google Docs build steps were removed.
  If upstream adds a new library or file list entry, port it into `scripts/build.mjs`.
- `src/common/preferences/*`, `src/common/ui/ProgressWindow.jsx`, `*.css`: redesigned UI
- `src/common/itemSaver*.js`, `src/common/inject/pageSaving.js`, `src/common/inject/inject.jsx`: the
  zotero.org fallback was removed and replaced with an "Is Abstractus Desktop running?" prompt
- Files deleted in this fork (see below): if upstream modifies them, keep them deleted.

Shared code still contains `Zotero.isSafari` branches. They are dead code in our builds, but were left
in place on purpose so upstream changes merge cleanly.

## What was removed from the Zotero Connector

- Saving to zotero.org (web API, OAuth, `api.js`, `oauthsimple.js`)
- Google Docs citation integration (submodule and content scripts)
- Safari build and Safari-only scripts
- Automatic RIS/BibTeX/CSL file importing (`contentTypeHandler.js`, confirm page, DNR style rules)
- Error and debug report submission to zotero.org (logs can still be viewed and copied locally)
- Reporting broken translators to the Zotero repository
- Zotero 7 Windows updater workaround (`updaterFix.js`)
- Zotero release/signing scripts for Chrome, Edge and Firefox, and non-English locales

## Layout

| Path | Contents |
| --- | --- |
| `src/common` | Shared code: background logic, injected scripts, UI (React) |
| `src/browserExt` | WebExtension-specific code, manifests, offscreen translation (MV3) |
| `src/messages.json` | English UI strings |
| `icons/`, `src/common/images/` | Abstractus icons (some keep Zotero file names so code paths stay unchanged) |
| `scripts/build.mjs` | Build and packaging |
| `test/` | Puppeteer/Mocha tests (`scripts/runtests.sh`) |

## License

AGPL-3.0, like the Zotero Connector it is based on. See `COPYING`.

## Abstractus development and release status

See [TESTING.md](TESTING.md) for isolated benches and one-time desktop pairing, and [UPSTREAM-SYNC.md](UPSTREAM-SYNC.md) for reviewing Zotero updates without overwriting this fork. Production builds use original orange-book branding and modern line icons; legacy asset filenames remain for compatibility. Customer updates use the existing extension-store listing; local unpacked extensions must be reloaded. The desktop release/security documents list the remaining public-release gates.
