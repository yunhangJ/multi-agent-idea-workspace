# Asset and Repository Boundaries

## Core application assets

The canonical application icon is `src-tauri/icons/app-icon.svg`. It was created specifically for Idea Workspace from the product's existing three-card brand motif. Tauri-generated PNG, ICO, and ICNS derivatives in the same directory are produced from that source. These project-owned assets are released under the repository's MIT License.

The user interface source, synthetic demo fixture, and product documentation are part of the core application repository and are released under the MIT License.

## Files intentionally outside Git

The following remain on the developer machine but are excluded from the repository:

- `Idea Workspace/`: installed application copies;
- `promo/`: rendered videos, raw captures, narration, and promotional working files;
- `video-studio/`: the independent video-production toolchain and output;
- `dist/`, `node_modules/`, `src-tauri/target/`: generated dependencies and build output;
- `.logs/`, `.artifacts/`, `.audit/`: local diagnostics and review artifacts;
- user-created `.idea-workspace.json` files.

Installers and promotional videos should be uploaded as GitHub Release assets only after an explicit release and rights review. They should not be committed to Git history.

## Third-party dependencies

The core application depends on packages with their own licenses. Package manager metadata and lock files are authoritative for exact versions. This document is not legal advice and does not replace the license texts shipped by those packages.
