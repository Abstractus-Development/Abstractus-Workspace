# Windows native-test execution block

**Later verification, 2026-09-13 19:16 local:** the normal `npm run desktop:dev` executable compiled and launched successfully after clearing a stale Vite listener and fixing the missing `plugins.updater` configuration. Its Abstractus window is responding and port 23130 now returns the expected unauthenticated pairing response (401). Windows did **not** block this normal app launch. The earlier restriction below applies to the native **test executable**; it is not a prerequisite for local dev pairing. The full isolated test bench has not been rerun.

Recorded 2026-09-13. User requested documentation and next steps instead of attempting an exception. No Windows protection was disabled, no allow rule was added, and no further native launch was attempted after that instruction. The existing desktop app was left running.

## Confirmed evidence

- Cargo compiled the native test executable, but Windows refused execution with error **4551**, `An Application Control policy has blocked this file`.
- Code Integrity Operational events **3077** and **3033** identify this executable and unmet signing requirements. Last inspected rejection: **2026-09-13 17:03:13 local machine time**.
- Event policy ID: `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`. A friendly policy name was not retrieved; the wording alone does not establish organizational device management.
- `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState` is **1**: Smart App Control is enabled.
- `Get-AuthenticodeSignature` reports **NotSigned**.
- File: `C:\Users\Tyler\Documents\Programs\Abstractus\AbstractusDesktop\AbstractusTSX_1.0.0\Frontend\src-tauri\target\debug\deps\app_lib-cab3d75f3f211217.exe`.
- SHA-256: `5C0B8D34495B0D70CFB35F357FF4F87AC28FD2A7A574F1A689AA4F6626BF7A73`. A rebuild can change this hash.

This is an execution-policy rejection, not a failed Rust assertion. These events do not establish a malware finding. Earlier successful runs do not establish that Windows accepts the final rebuilt executable.

## Correction to the earlier approval request

Smart App Control has no individual-app **Allow anyway** exception. Asking the user to approve this file without checking the active protection was too broad. Microsoft recommends valid code signing for developers. Do not add broad antivirus exclusions, change enforcement registry values or disable protection to complete this test. [Microsoft Smart App Control FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).

## What to do next

1. Keep this computer protected. Confirm its state in **Windows Security → App & browser control → Smart App Control settings**, without changing it.
2. Finish unsigned development testing in an **approved Windows development environment or CI runner** configured to execute locally built code. Both repositories and their pinned dependencies are needed for the complete bench. Customer libraries, real browser profiles, Auth0 secrets and R2 keys are unnecessary. The CI workflows are local changes; they have not been pushed or run remotely.
3. For protected customer machines, configure valid **Windows Authenticode signing** for the installer and executable. A self-signed certificate is not automatically trusted by Smart App Control. If a separate managed application-control policy applies, its administrator must review the intended signer and logged policy ID; that is separate from a Smart App Control exception.
4. In the approved environment run desktop `npm run test:all` and connector `npm run test:ci`. Record fresh results. See TESTING.md in each repository for prerequisites. The complete capture test must still use the isolated native fixture.
5. Build, sign and test the packaged application, including login and a version-to-version update. **Tauri updater signing is separate from Windows Authenticode**. Supply the updater public key at build time and publish the planned HTTPS feed only after release acceptance.

No public release has been approved. Translator network/code authority, packaged Auth0, private R2/backend ownership and signed-install/update acceptance remain in [DESKTOP-RELEASE.md](../../AbstractusDesktop/AbstractusTSX_1.0.0/Frontend/DESKTOP-RELEASE.md).

## Verification state

| Check | Last observed result |
|---|---|
| Native regression tests | 42 passed before the additional test-only capture observer was compiled; one opt-in fixture ignored by default. |
| Full JS/Rust and installed-extension bench | 21 passed before the extra translator-capture/callback checks. **Latest full rerun blocked by Windows.** |
| Real publisher-style metadata capture in Chromium | Passed separately with actual content scripts, pinned Embedded Metadata translator, sandbox and callbacks; native API explicitly stubbed. |
| Popup layout, keyboard, hostile text, book image, production assets | Six browser/UI checks passed. |
| Desktop production build and full ESLint | Passed before final documentation/test-harness additions. |
| Website-sync / connector-sync fixtures | Six / four passed in disposable repositories. |
| Full JavaScript dependency audits | Zero current findings in both repositories. |
| New publisher → native database acceptance test | Added, **not yet executed successfully** because of the Windows block. |

Historical `.test-results/bench.json` files are not final-source clearance. The currently running desktop remains the earlier executable: pairing hardening and the native updater require the rebuilt app to be started. Reload the rebuilt extension alongside that compatible desktop and complete its one-time browser pairing. No production website, R2 settings or Auth0 configuration changed.
