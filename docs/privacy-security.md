# Privacy and Security Model

Idea Workspace is local-first, but local-first does not mean that every operation remains offline. A desktop model request sends the explicitly authorized context to the endpoint configured by the user.

## Data stored locally

The application may store the following on the device:

- the current workspace, cards, imported text, runs, Agent memories, and versions;
- an automatic recovery copy in the desktop webview's localStorage;
- non-secret AI preferences such as protocol, endpoint URLs, model name, and response options;
- user-created `.idea-workspace.json` exports.

Workspace exports and recovery data can contain sensitive content. They are not suitable for bug reports unless replaced with a synthetic fixture.

## Credentials

The API key is entered in a password field and passed to the Rust backend. It is retained only in application process memory and is cleared when the application exits. It is excluded from workspace serialization, localStorage preferences, cards, Agent memories, and logs.

Authenticated request and model-list endpoints must share an origin. The runtime rejects redirects, remote plain HTTP, URL user information, query strings, and fragments. Localhost HTTP is allowed for an explicitly unauthenticated local service.

## Agent context boundaries

A single-Agent run receives the current frozen input plus only that Agent's own frozen history. During a discussion, each Agent creates a proposal independently. The synthesis request receives the shared material and current proposals, not other Agents' private histories.

Dragging a card or file into the Discussion Zone is a context authorization action. Moving it out removes it from later discussion snapshots; it does not rewrite historical runs.

## Browser preview

Browser preview is a deterministic interaction simulator. It does not accept a real API key and does not send a model request. Its output demonstrates UI behavior, not model quality.

## Responsible reporting

Never attach a real API key, endpoint, imported private file, localStorage database, log, or real workspace export to a public issue. Follow `SECURITY.md` for sensitive reports.
