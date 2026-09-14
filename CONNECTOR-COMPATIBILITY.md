# Connector compatibility and scope

Updated 2026-09-13 for connector 5.0.202. The connector is a Zotero Connector fork. Abstractus Desktop is a separate Tauri app, not a fork of Zotero Desktop. Reusing the browser source does not automatically supply the desktop's Firefox/XPCOM services.

The user's direction is to preserve maintained Zotero functionality, keep upstream updates possible, and avoid replacements beyond explicitly requested Abstractus integration. The custom reverse-DNS replacement written during this task was removed. `src/common/proxy.js` is unchanged from the recorded upstream commit `1d4fac3779aeec9ca7975d8a771c177f34fbd982`; no proxy settings were removed. The translator submodules were not changed.

| Capability | Current state |
| --- | --- |
| Publisher metadata extraction, translator detection and sandbox execution | Maintained upstream code retained; actual Embedded Metadata, ScienceDirect and RIS translator tests pass with synthetic publisher/native responses. |
| Saved institutional proxy URL recognition and redirection | Upstream engine retained unchanged. Proper/proxied URL roundtrip test added. Real institutional authentication has not been tested here. |
| EZproxy and OpenAthens detection/settings | Retained from upstream. No institution subscription or access bypass is supplied by Abstractus. |
| Automatic institution-network exception | **Incomplete.** `POST /connector/getClientHostnames` still returns an empty array. Zotero Desktop implements reverse DNS through `xpcom/dns_worker.js`, which requires privileged Firefox `ChromeWorker`/`ctypes` APIs unavailable in Tauri. No custom replacement is shipping. |
| References, abstracts, PDF attachments, collections and tags into Abstractus Library | Existing Abstractus desktop adapter retained. Its local protocol requires per-browser authentication. |
| Desktop attachment resolvers / PDF recognition | Existing placeholders remain: `hasAttachmentResolvers` is false and `getRecognizedItem` returns 204. This is not full Zotero Desktop feature parity. |
| Webpage snapshots / word-processor integration | Previously excluded from this app; this task made no further removals. |
| Click-to-connect | Requested Abstractus adapter implemented using Chromium native messaging; native desktop approval, optional browser permission, code fallback. Windows only; Firefox uses the existing code fallback. Full latest native execution is blocked as described below. |

## Changes in this task

- The requested orange book on a cobalt tile is used for connector branding. The settings background/sidebar use cobalt; diagnostics remain available under Help & diagnostics, with troubleshooting tools collapsed.
- A browser-owned connection popup offers Connect to Abstractus Desktop. Paper pages cannot request a connection key. The helper accepts only configured exact extension IDs, and Desktop asks for consent before issuing a per-browser key. Local pipe messages have bounded sizes, fresh nonces, HMAC proofs and Windows-user DPAPI protection. No unauthenticated pairing HTTP endpoint was added.
- Desktop now offers Use abstracts in review alongside Use PDFs in review. Abstracts may come from references with or without PDFs. Selection opens the existing screening flow for confirmation, and successful abstract submissions can link back to the original Library references. No cloud job is submitted merely by clicking this Library action.

## Upstream updates

The connector retains its upstream remote, pinned translator submodules and `upstream-sync.json` baseline. `python scripts/upstream-sync.py check` compares against that baseline; `prepare` requires a clean reviewed fork and stages a merge in a separate worktree. It does not overwrite or stash the working fork. The existing four isolation/conflict tests pass.

Run `npm run test:ci` on each proposed upstream merge, then the full cross-language `npm run test:bench` in an approved Windows development environment. The new proxy compatibility and native connection regressions are part of `test:ci`. Inspect changes to our protocol adapter, settings and manifests before integration. No upstream fetch, merge, push or baseline advancement was performed during this task.

## Development and release boundary

`npm run desktop:dev` builds the browser helper first. On startup Desktop registers that helper for the current Windows user's Chrome/Edge under the app-specific native-host key. It does not edit Chrome profiles. The current unpacked development extension ID is explicitly allowed in debug builds. Release builds must set `ABSTRACTUS_CONNECTOR_IDS` to the approved Chrome/Edge store IDs. Release packaging includes the native helper sidecar.

The latest desktop executable and native test executable are blocked by Windows Application Control (4551). An earlier intermediate native run passed 45 tests, but the final added approval/cancellation tests have not executed. Native registration succeeded before the latest rebuild was blocked; that does not establish that the latest app can launch. No protection was disabled or bypassed. See WINDOWS-TEST-BLOCK.md for exact builds and required next steps.

Before release: sign and test the application, helper and installer; verify the native messaging flow in the installed browser with both approve and cancel; verify store IDs, first launch, uninstall cleanup and signed updates. The native-host registration must be cleaned up on uninstall. These packaged acceptance checks remain outstanding. The normal frontend build and ESLint pass; Library abstract tests use only synthetic records. The main website, Auth0, R2 and production deployment were not modified.
