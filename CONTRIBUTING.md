# Contributing

Thank you for helping improve Idea Workspace. This repository contains the core React and Tauri application. Local builds, user workspace files, release binaries, and promotional production files are intentionally outside the repository boundary.

## Development environment

- Windows 10 or 11 for the complete desktop build
- Node.js 22.12 or newer
- pnpm 11
- Rust 1.88 or newer with the MSVC toolchain
- Microsoft Edge WebView2 Runtime
- Visual Studio Build Tools with **Desktop development with C++** for Windows packaging

Install the JavaScript dependencies:

```powershell
pnpm install --frozen-lockfile
```

Run the browser interaction preview:

```powershell
pnpm dev
```

Run the Tauri desktop application:

```powershell
pnpm desktop:dev
```

## Required checks

Run these checks before opening a pull request:

```powershell
pnpm typecheck
pnpm test
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Tests and browser preview must not require a real API key or make a real model request.

## Privacy and security

- Never commit an API key, bearer token, private endpoint, user workspace, localStorage database, log, browser profile, or imported private file.
- Use obvious placeholders such as `TEST_SECRET_VALUE` in tests. Do not use strings shaped like production credentials.
- Keep Agent private-history isolation and explicit context authorization intact. Changes to these boundaries require tests.
- Do not include generated installers, executable files, build caches, screenshots containing personal data, or AI service settings in a pull request.
- The project implements OpenAI Responses and Chat Completions protocols. Do not add or configure another model provider without an explicit project decision.

## Pull requests

Keep changes focused. Explain the user-visible behavior, privacy implications, and verification performed. Include screenshots for UI changes, but use only synthetic demo content and redact local paths and service settings.

By contributing, you confirm that you have the right to submit the work and agree that your contribution is licensed under the repository's MIT License.
