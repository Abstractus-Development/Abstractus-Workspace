# Development tests

Requires Node 24, Python 3.12+, and Chromium for Puppeteer. Initialize the checked-in submodules, including the pinned translator snapshot: `git -C src/zotero submodule update --init translators`. Do not update their revisions just to run tests.

```powershell
npm ci
npx puppeteer browsers install chrome
npm run test:ci
npm run test:bench
```

`test:ci` is independent of the desktop: four disposable Git/sync tests, production builds for Chromium and Firefox, popup layout/keyboard/hostile-text checks, and the real Embedded Metadata translator in a fresh Chromium profile. The browser-only translator test explicitly stubs the native API and asserts the title, author and abstract delivered by the actual content-script/sandbox/callback flow. It is not native-transport acceptance.

`test:bench` additionally runs the desktop's Rust fixture on a random local port. It tests the shipped JavaScript broker against the real native server, spoofing/replay/isolation controls, save/tag/PDF operations, pairing through the actual extension settings page, and a synthetic publisher capture into the temporary native database. Set `ABSTRACTUS_DESKTOP_FRONTEND` if the desktop is not in its normal adjacent checkout. Rust/MSVC is required for this full bench.

Everything uses synthetic records, disposable libraries and fresh browser profiles. Test endpoint changes exist only in a disposable extension copy. Reports/screenshots are in ignored `.test-results/`; fixture stores and `cfg(test)` native support are not shipped. Production builds omit `test/` and `tools/`. Never pair a bench with an installed customer library or reuse a real browser profile.

The original Zotero Mocha suite remains under `test/` and can be run with `npm run build:debug` then `npm test` (`HEADLESS=true` for unattended use). Its HTTP mocks assume the upstream unpaired protocol; port those tests to the authenticated transport deliberately. It is not currently a cleared acceptance suite. Rebuild with `npm run build` afterward. Main CI runs the fork-specific tests; the retained compatibility workflow can be dispatched separately.

Refresh the complete `npm audit`, including development dependencies: DOMPurify is packaged runtime code despite that dependency classification. Current dependency snapshots are clean, not permanently exempt from review.

## Connecting the development extension

The matching desktop now launches in normal local development mode. The stale-port and updater-configuration failures are fixed. Reload the rebuilt extension and refresh paper tabs; no packaged release is required to pair with the dev app. See [CONNECTOR-RECOVERY.md](CONNECTOR-RECOVERY.md). Library → Browser connections → Create connection code. In the extension's Settings, paste it into Connect browser. Each browser gets its own revocable code. Neither test configuration nor pairing secrets belong in public source or release archives.

## Release limits

Built extension files are not store approval. Remote translators still require review of their network authority, DNS/redirect behavior, and Chrome/Mozilla remote-code policies. The desktop's `CONNECTOR-SECURITY-AUDIT.md` and `DESKTOP-RELEASE.md` are the current release gates. Broad publisher acceptance, Firefox runtime, packaged login, production R2 ownership and signed updates remain separate checks.

Current native-run limitation: Windows Application Control blocks the latest desktop fixture executable. See [WINDOWS-TEST-BLOCK.md](WINDOWS-TEST-BLOCK.md). Earlier passing reports are historical; the new complete publisher-to-native capture check is outstanding.

## Connection and publisher regressions (2026-09-13)

The CI command now includes:

- `test:regressions`: 12 isolated JS/VM cases for pairing, proof verification, absent/spoofed desktop, unsigned diagnostics, tab races and network destinations. No native executable or real network is used.
- `test:connection-ui`: actual production extension settings in a fresh browser; legacy/unpaired/offline guidance, absent PDF frames and light/dark/brown icon inspection. Native replies are stubbed.
- `test:publisher`: actual ScienceDirect and RIS translators on a synthetic publisher page; relative HTTPS citation retrieval and title/author/abstract callbacks. Also asserts the real on-page update-required prompt prevents capture. Publisher responses and native API are explicitly stubbed.

All passed on this repair. The preexisting Embedded Metadata runtime, popup and sync checks also passed. These are development fixtures and are excluded from release builds. Reports and visual evidence are in `.test-results/`. No user profile, user-library fixture or native executable was used in this repair.

Live publisher PDF retrieval and the complete paired native bench remain outstanding. A proposed automatic browser-approval flow is documented in [CONNECTOR-RECOVERY.md](CONNECTOR-RECOVERY.md); code-based pairing is still the implemented path.

The extension branding now uses the supplied full-color Abstractus logo. The publisher toolbar retains that logo; item types remain in tooltips and the save popup. The latest affected tests passed: six popup/build checks, seven connection/color/icon checks and three publisher/toolbar checks. The actual normal desktop app launches and returns the expected unpaired 401; that is not a claim that the full native test bench or a real paired capture passed.

## Offscreen styling regression — 5.0.201

`npm run test:offscreen` runs eight browser checks using the production snapshot method and actual sandbox CSP. It proves the original style warnings are observable, then asserts zero violations for the sanitized snapshot, no live-page mutation/custom-element re-execution, preserved metadata/JSON/base/PDF links, and continued blocking of direct network and inline scripts. This runs in `test:ci`.

`test:publisher` now includes inline publisher styles and observes the actual offscreen browser target's security log. The capture still uses real pinned ScienceDirect/RIS translators with synthetic publisher/native responses. Its four checks pass, including zero inline-style CSP errors. [CONNECTOR-RELOAD.md](CONNECTOR-RELOAD.md) explains how to recognize and reload this build.
