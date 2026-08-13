# Third-Party Notices

Idea Workspace uses third-party software under their respective licenses. Exact versions are recorded in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`; those lock files and each package's distributed license text are authoritative.

The direct core dependencies include:

| Component | Purpose | Reported license family |
| --- | --- | --- |
| React and React DOM | User interface | MIT |
| Zustand | Application state | MIT |
| React Flow (`@xyflow/react`) | Visual canvas | MIT |
| Tauri and official Tauri plugins | Desktop runtime, dialogs, and file access | MIT / Apache-2.0 |
| Serde and serde_json | Rust serialization | MIT / Apache-2.0 |
| Reqwest | HTTPS client | MIT / Apache-2.0 |
| Tokio | Async runtime | MIT |
| log | Rust logging facade | MIT / Apache-2.0 |

Transitive dependencies include additional permissive and weak-copyleft licenses, including MIT, Apache-2.0, BSD, ISC, Unicode, and MPL-2.0. No third-party package is relicensed by this project.

The local `video-studio/` directory is not part of the core Git repository. Its production toolchain has a separate licensing boundary and must not be represented as part of the core application's open-source dependency set.
