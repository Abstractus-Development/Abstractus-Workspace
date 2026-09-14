# Connector recovery and simpler pairing

**Update, 2026-09-13 19:16 local:** local dev now runs the matching desktop. The stale Vite process on port 1420 was stopped, then a normal launch exposed a separate updater initialization crash. Adding the required updater configuration fixed that crash. The native window is responding; the connector handshake returns 401 (pairing required), replacing the earlier 404. Local dev pairing can proceed without a packaged release. Reload the rebuilt extension, refresh paper tabs, then create a code in Library → Browser connections and use Connect with code in Connector Settings. The extension now uses the original orange-and-blue Abstractus logo, including its publisher toolbar button. The older findings below are historical; the full native **test** bench remains unverified.

Reviewed 2026-09-13. The connector has been rebuilt with the fixes below. The currently running desktop has not been replaced, and native acceptance remains blocked by Windows Application Control.

## What broke

The earlier security work replaced the unpaired localhost connector with per-browser authenticated requests and authenticated responses. The updated extension requires this protocol. The desktop process still running on this computer predates it. Updating the extension without a usable matching desktop created a breaking mismatch.

A read-only GET to `http://127.0.0.1:23130/connector/handshake`, with connector API version 3, returned HTTP 404, `X-Zotero-Version: 0.1.0`, no authenticated response proof, and `{"error":"Not supported"}`. That is incompatible with the new extension. Reloading the extension or entering a code cannot add this protocol to the old native executable.

The unsigned diagnostic request added in this repair only identifies likely setup problems. It never marks a server trusted, contains no paper data or connection credential, follows no redirects, and has a short timeout. Signed authentication still precedes every paper transfer.

## Screenshot errors and repairs

| Symptom | Finding | Current status |
| --- | --- | --- |
| `tabs.get` rejects a negative tab ID | Browser requests can have no associated tab. The deferred PDF/CSP handler also assumed the tab still existed. | Reject invalid IDs, redirects and non-document responses; handle closed/navigated tabs. The related PDF-subframe handler now also checks live frame identity. |
| “Connect this browser” appears as an extension error | Pairing failures were plain errors with no HTTP status. The inherited online check treated `undefined != 0` as evidence that desktop was online. | Typed connection failures, strict online detection, and clear settings/on-page guidance. Expected disconnected states no longer become console errors or apparent translator failures. |
| “Translator requests require a public HTTPS publisher address” | This comes from the Abstractus network guard, not a demand for a Zotero account. The screenshot does not contain the rejected URL. | Own packaged resources are allowed; relative content-context requests are resolved before background routing. Public HTTPS ScienceDirect citation fetch and RIS parsing pass a synthetic runtime test. The exact historical rejection is not identified, and live publisher acceptance is still outstanding. Private/literal/HTTP destinations remain blocked. |
| Blue article/PDF symbols disappear on dark backgrounds | Transparent dark strokes did not contrast with browser themes. | Regenerated the 116 semantic/status icons with a light backing and contrasting strokes. The orange book also has its own light backing. Inspected 16px/32px assets against white, dark and brown backgrounds. |

The preceding desktop work also added library content filters, book branding, updater scaffolding, and development-only test benches. None of those features by itself proves a working packaged release. The native taskbar icon belongs to the running executable; refreshing frontend assets cannot replace it.

## What to do next

1. Follow [WINDOWS-TEST-BLOCK.md](WINDOWS-TEST-BLOCK.md). Complete the native bench in an approved Windows development/CI environment, and produce a matching desktop executable allowed by the machine's policy. Do not disable Application Control or assume Smart App Control provides an individual “Allow anyway” button.
2. Once that build is approved and available, close the old Abstractus Desktop and start the matching build. Confirm its secure handshake and Library → Browser connections work. The current task did not close the app or attempt another native launch.
3. In Chrome's Extensions page, reload the existing Abstractus unpacked extension from the connector's `build/manifestv3` directory. Refresh already-open paper tabs, because reloading an extension leaves their old injected scripts stale. The build contains the icon and error-message fixes; it has not been reloaded into the user's browser by this task.
4. In the updated desktop, create one browser connection code. In Connector Settings, use **Connect with code**. Settings must report an actually verified desktop, not merely the existence of a stored code. Codes are credentials; keep them out of screenshots, issue reports and source control.
5. Run the full paired connector bench and then verify a real publisher capture, including metadata, a permitted PDF, destination collection and tags, before calling this release-ready. Chrome's Errors screen can retain historical errors; after preserving useful diagnostics, clear them and reproduce on a refreshed page.

The code-based path is the implemented path. Automatic approval pairing is a proposal below, not a finished feature. No production website, Auth0 tenant, R2 bucket or Windows protection settings changed in this repair.

## Proposed default: Connect → approve in Desktop

Use the browser's native-messaging facility to bootstrap the existing per-browser credential, with code entry under a secondary option:

1. The signed desktop installer registers a small native-messaging host. Its manifest permits the exact published Abstractus extension IDs for each supported browser. It lives in the protected application installation directory.
2. The extension's own settings/popup has **Connect to Abstractus Desktop**. Only this privileged extension UI can initiate pairing; arbitrary publisher content cannot invoke a generic pairing RPC.
3. The native host passes a bounded, expiring request to Desktop. Desktop shows its own **Allow this browser to save papers to your library?** dialog. The request is bound to this browser connection; rejection, timeout and repeated requests create no credential.
4. Approval creates a revocable browser credential and returns it through native messaging to the extension background. It never travels through the academic page, a query string, extension preferences exposed to content-script RPC, or an unauthenticated localhost pairing endpoint.
5. Subsequent captures use the existing authenticated transport. **Connect with code** remains a fallback for unsupported installations.

This is an app-owned approval dialog: Chrome does not automatically supply the authorization UX. The native helper, consent UI, installer registration/unregistration, exact store IDs, and signing need implementation and testing. There is no new native helper or unsafe automatic localhost fallback in this repair.

Primary reference: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). Chrome documents an exact extension-origin allowlist and installation-time registration. [Chrome webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest) documents the no-tab `-1` value.

## Zotero scope and update preservation

The built background entrypoint retains page detection, translators, citation import, attachments, browser messaging and the Abstractus adapter. It does not load Zotero account OAuth/API or word-processor integration modules. Existing `Zotero.*` namespaces and compatibility filenames are still used by the extraction engine; their presence does not mean a Zotero desktop installation is required.

`ALWAYS_FETCH_FROM_REPOSITORY` remains true, with the translator repository at `https://repo.zotero.org/repo/`, a daily check interval and hourly retry. The pinned translators used by tests are reproducible fixtures; they are not a claim that every live publisher matches that snapshot.

The recorded Zotero connector baseline and the upstream branch checked with `git ls-remote` both resolved to `1d4fac3779aeec9ca7975d8a771c177f34fbd982`. No upstream commits or submodule revisions were changed by this repair. The existing sync helper stages future proposals in a separate checkout, requiring a clean reviewed fork and explicit integration. It does not overwrite local customizations.

## Verification and remaining limits

Passed: 12 isolated transport/tab/network regressions; 4 temporary Git merge/sync tests; Chromium/Firefox builds; 6 popup/build checks; real Embedded Metadata detection/translation/save callbacks; 6 production-browser setup/frame/icon checks; and 2 publisher-page/ScienceDirect/RIS runtime checks. The ScienceDirect test uses the actual pinned translators and a synthetic page, with publisher and native responses explicitly stubbed.

The full JS-to-Rust capture bench was not rerun: the last Windows block is still in force. Live ScienceDirect retrieval was not verified. The desktop's current executable is still incompatible. DNS/redirect authority for remote translators, remote-code store policy, packaged login, backend/R2 ownership, signing and actual update delivery retain the release gates in [CONNECTOR-SECURITY-AUDIT.md](CONNECTOR-SECURITY-AUDIT.md) and [DESKTOP-RELEASE.md](DESKTOP-RELEASE.md). Browser-only green tests do not clear those gates.
# Current status: connector 5.0.202

The click-to-connect adapter is now implemented, with code fallback. It is no longer only a design proposal. Final native execution/approval is blocked by Windows Application Control; the browser checks pass with native responses stubbed. See `CONNECTOR-COMPATIBILITY.md` for scope, retained Zotero code, unimplemented desktop dependencies, and release gates. See `WINDOWS-TEST-BLOCK.md` for the current blocked executables. Older observations below are historical.
