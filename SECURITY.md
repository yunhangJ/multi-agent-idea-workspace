# Security Policy

Idea Workspace is an early local-first desktop project. Until a stable release policy is announced, security fixes target the latest revision on the default branch.

## Reporting a vulnerability

Do not publish credentials, private workspace files, imported documents, endpoint URLs, or exploit details in a public GitHub issue.

Before the repository owner configures a private security contact, keep a minimal local report containing:

- affected version or commit;
- reproduction steps using synthetic data;
- expected and observed security boundary;
- whether an API key, Agent private history, imported file, or workspace export may be exposed.

After the GitHub repository is created, enable **Private vulnerability reporting** in the repository Security settings and replace this paragraph with the resulting private reporting URL. Until then, public security disclosure is not ready.

## Credential handling

- API keys are accepted only by the desktop settings dialog and retained in the Rust process memory.
- API keys must not enter cards, Agent memories, logs, localStorage, or `.idea-workspace.json` files.
- Changing the protocol, authentication mode, or endpoint requires the key to be entered again.
- Authenticated request and model-list URLs must have the same origin. Remote HTTP URLs, redirects, URL user information, query strings, and fragments are rejected.
- Browser preview is deterministic and does not make real model requests.

If a credential is exposed, revoke it at the provider immediately. Removing it from the latest Git commit is not sufficient if it entered Git history.

## Sensitive local data

Workspace exports and local recovery data may contain card text, imported document content, custom instructions, and Agent memories. Treat those files as private unless they were explicitly created as synthetic fixtures.
