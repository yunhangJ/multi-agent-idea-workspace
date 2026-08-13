# Development Guide

## Repository boundary

This repository contains the core application only:

- React, TypeScript, Zustand, and React Flow sources in `src/`;
- Tauri and Rust sources in `src-tauri/`;
- deterministic tests and synthetic fixtures;
- product and engineering documentation.

Local installations, generated output, user workspaces, logs, browser profiles, rendered promotional media, and the independent video-production toolchain are deliberately excluded by `.gitignore`.

## Prerequisites

For browser development:

- Node.js 22.12 or later;
- pnpm 11.

For Windows desktop development and packaging:

- Rust 1.88 or later with the MSVC target;
- Microsoft Edge WebView2 Runtime;
- Visual Studio Build Tools with Desktop development with C++;
- the prerequisites documented by Tauri for Windows.

## Setup

```powershell
pnpm install --frozen-lockfile
```

The browser preview uses deterministic simulated results and never accepts an API key or calls a real model:

```powershell
pnpm dev
```

The desktop application uses the Rust runtime for model requests:

```powershell
pnpm desktop:dev
```

## Validation

```powershell
pnpm typecheck
pnpm test
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Validate the set of Git-tracked files after staging:

```powershell
.\scripts\check-repository.ps1
```

## Context isolation invariants

- A directed Agent run receives only the cards explicitly selected for that run and that Agent's own frozen history.
- A discussion proposal receives shared discussion material and the proposing Agent's own history, but no peer history.
- The synthesis step receives shared material and current-round proposals, not private summaries or peer histories.
- Interrupted or obsolete requests must not write late results to the workspace.
- API credentials must not enter serializable workspace state, logs, errors, or exported files.

Changes that affect these invariants require focused automated tests.
