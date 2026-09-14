# Safely integrating Zotero changes

`upstream-sync.json` records the exact remote URL, branch/ref and integrated baseline. The remote must remain the inspected Zotero repository.

```powershell
npm run sync:check -- --fetch
npm run sync:prepare
```

Check reads the upstream diff; it does not replace files. Prepare refuses uncommitted work and creates a detached worktree under ignored `.upstream-sync/<id>`. The upstream merge, including conflicts, happens there. The fork checkout, Abstractus changes and baseline are left intact. Four disposable repository tests verify these protections.

Commit reviewed local work first. In the proposal, inspect the full diff and conflicts, preserve Abstractus transport/security/branding changes, initialize only required submodules and review any changed submodule pins. Install dependencies and run `npm run test:ci` and the paired `npm run test:bench`. Review licenses and store permissions as well as behavior. Commit the reviewed merge proposal; then explicitly integrate that merge commit into the fork and update `baseRevision` to the integrated upstream tip. If the fork moved meanwhile, prepare a fresh proposal. Do not auto-reset, overwrite, force-push or silently stash custom changes.

No automatic merge or production deployment is configured. Customer extension updates come from releases of the same store listing with an increased version; Git upstream synchronization is a separate developer workflow. Publish corresponding source for the exact fork/version, including pinned submodules and build scripts, under the retained AGPL terms.

The desktop separately imports reviewed main-website changes through its allowlisted three-way frontend-sync workflow. This connector script does not edit the website or desktop.
