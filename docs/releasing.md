# Release Checklist

This checklist prepares a Windows release after the GitHub repository, license, asset rights, and private security contact have been finalized.

## Source gate

- [ ] The project license is present and matches package manifests.
- [ ] The canonical application icon and all bundled assets have documented redistribution rights.
- [ ] `git status --short` is clean.
- [ ] `./scripts/check-repository.ps1` passes.
- [ ] `pnpm install --frozen-lockfile` succeeds in a clean checkout.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- [ ] `cargo test --locked --manifest-path src-tauri/Cargo.toml` passes.

## Build gate

- [ ] Build from a clean checkout, not from a working directory containing user data.
- [ ] Run `pnpm desktop:build` on a documented Windows toolchain.
- [ ] Confirm the installer and executable do not contain API keys, personal paths, or private endpoint settings.
- [ ] Record SHA-256 checksums for every release asset.
- [ ] Document that unsigned Windows builds may trigger SmartScreen, unless code signing is configured.

## Distribution gate

- [ ] Create a tagged GitHub Release from the exact tested commit.
- [ ] Upload the NSIS installer and checksum as Release assets; do not commit them to Git.
- [ ] Upload promotional video separately if desired; do not commit raw captures or rendered videos.
- [ ] Describe known limitations and migration risks.
- [ ] Verify installation, launch, project save/open, browser preview, and one opt-in model request with a newly issued test credential.
- [ ] Revoke the test credential after validation.
