# Current build: 5.0.202

Reload the existing Abstractus Connector card in chrome://extensions and refresh the article tab. Do not repeatedly add another unpacked copy. This build uses the orange book on cobalt and has a browser-owned Connect to Abstractus Desktop popup, with code fallback.

The latest desktop rebuild is currently blocked by Windows Application Control (4551). Reloading this extension cannot unblock the desktop executable. See CONNECTOR-COMPATIBILITY.md and the desktop WINDOWS-TEST-BLOCK.md. Browser-only acceptance passed; real native approval still requires the approved development environment or trusted signing.

Earlier reload notes (historical version numbers):

# Loading the fixed local connector

Current build: **5.0.201**. The source and built Chromium/Firefox manifests use this version.

The installed Chrome connector was verified read-only in Profile 1:

- Extension ID: `dcdbimmlikfepoopjnoiiagidgobblln`
- Loaded folder: `C:\Users\Tyler\Documents\Programs\Abstractus\AbstractusDesktopConnector\Abstractus-Workspace\build\manifestv3`

That is the correct folder. Do not keep selecting Load unpacked or Pack extension. The build is already in that folder; Chrome must reload the existing extension to run it.

1. At `chrome://extensions`, use the back arrow beside **Errors** to return to the extension cards.
2. Find **Abstractus Connector** and click its circular **Reload** button.
3. Confirm the card shows **5.0.201**. An unchanged older version means the updated manifest has not been loaded.
4. Clear historical errors after preserving any useful diagnostics, refresh the academic article tab, and try one save. Old injected scripts on an already-open page do not become the new scripts merely because the extension was rebuilt.

The reported inline-style CSP errors came from publisher CSS being serialized into the hidden translator document. They were blocked styling operations; the messages alone did not establish a failed metadata save. The repair strips CSS from an inert, detached snapshot before parsing. It does not edit the live webpage or relax sandbox CSP. Title/author/abstract metadata, JSON scripts, canonical links, relative PDF links, classes, IDs and non-style template data are retained. Presentation-dependent selectors based on inline `style` attributes are excluded along with that CSS; broad publisher acceptance remains a separate check.

Eight targeted browser checks reproduce the original warning and verify that it disappears, metadata is retained, and direct sandbox network/inline-script execution remain blocked. The real ScienceDirect/RIS runtime captures a styled synthetic publisher fixture with no inline-style CSP errors from the observed offscreen target. Publisher and native responses in that runtime test are explicitly stubbed; this does not certify every live site or a real paired PDF capture.

The installed Chrome profile was not modified or driven by the test bench. Only its matching extension installation path was inspected; tests use fresh disposable browser profiles. The user's installed extension still needs its Reload action.

Reference: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
