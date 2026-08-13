# GitHub Publishing Guide

The local repository is prepared on the `main` branch and licensed under the MIT License. Complete the remaining validation and owner-controlled settings before publishing a release binary.

## Before the first commit

1. Confirm that the root `LICENSE`, `package.json`, and `src-tauri/Cargo.toml` all identify MIT.
2. Re-read `ASSETS.md` and confirm that all submitted code, text, screenshots, and the canonical application icon may be distributed under that license.
3. Run the complete validation suite and `scripts/check-repository.ps1`.
4. Review `git diff --cached` and verify that only the core application is staged.

Do not place an API key, personal access token, endpoint, email password, or signing certificate in the repository or in a remote URL.

## Create the remote repository

The first public repository uses `https://github.com/yunhangJ/multi-agent-idea-workspace`. For a fresh publication, create it without automatically adding a README, `.gitignore`, or license, then run:

```powershell
git commit -m "Initial public source release"
git remote add origin https://github.com/yunhangJ/multi-agent-idea-workspace.git
git push -u origin main
```

Authentication should use GitHub's credential manager, browser sign-in, or a narrowly scoped token entered into the credential prompt. Never embed a token in the remote URL.

The repository metadata should use `https://github.com/yunhangJ/multi-agent-idea-workspace`. If the final repository name changes, update both manifest files before committing.

## Repository settings

After the first push:

- enable GitHub Private Vulnerability Reporting and update `SECURITY.md` with the generated private reporting URL;
- enable secret scanning and push protection where available;
- protect `main` and require the `Frontend checks` and `Rust checks` CI jobs before merge;
- enable Dependabot alerts and dependency update pull requests;
- disable force pushes and branch deletion on `main`;
- add a concise description and topics such as `tauri`, `react`, `typescript`, `multi-agent`, `whiteboard`, and `local-first`;
- keep GitHub Releases empty until a clean release build and checksum pass the checklist in `docs/releasing.md`.

## What belongs in Releases

Windows installers, portable executables, checksums, and promotional video are release assets. They should not be added to the Git repository itself.
