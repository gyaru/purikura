# Tests

Node 22.13+ and Python 3.11+:

```sh
npm ci
npm test
uv run --with pytest==8.3.5 --with fastapi==0.115.12 --with httpx==0.28.1 --with pyyaml==6.0.2 python -m pytest tests -q
```

The frontend harness loads the actual uncompiled plugin with real React and React Query, mocking only the Hermes SDK bridge. It covers shared create/rename, real interval polling, independent clients, scoped persistence, stale responses, unavailable people, send-time validation, attachments and commands. This is not an Electron UI end-to-end test.

## Actual Hermes installers (optional)

Set `HERMES_SOURCE` to a Hermes source checkout. For Python, use an environment with that checkout's dependencies and pytest installed:

```sh
HERMES_SOURCE=/path/to/hermes-agent npm test
HERMES_SOURCE=/path/to/hermes-agent python -m pytest tests -q
```

Without `HERMES_SOURCE`, the two host integration tests explicitly skip; the portable root-contract test still runs. All integration installs use temporary homes and offline Git fixtures, never live plugins. Set `TMPDIR` if you need a specific scratch location.

Validated against Hermes source `fca3221df48d4ae1e4db9e8a1a041de21ea4d9cf`:

- Python `_install_plugin_core`: real clone, manifest validation, security scan, install metadata and dashboard discovery; the installed API serves a fresh **User** roster.
- Electron `detectPluginComponents`, `probePluginRepo` and `installDesktopPluginFromGit`: actual TypeScript source loaded through Node's type stripping, real offline clone and desktop publication. Both components are found from the repository root. A Desktop-only install creates no backend.
- Installer routing was inspected in `apps/desktop/src/app/settings/plugin-install-modal.tsx` and `src/store/agent-plugins.ts`: Agent uses `plugins.manage` on the connected gateway; local unified installs reconcile the desktop half, while remote connections clone it locally. Remote permissions, authentication and service restarts were not exercised against a live gateway.

[Official unified-package contract](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk#one-package-both-sdks).

Expected tool warnings: Node experimental VM/type-stripping notices, React test-renderer deprecation, and (depending on host dependencies) Starlette/AnyIO deprecation. No runtime dependency installation or npm build is needed for Purikura itself; Hermes supplies FastAPI and the Desktop SDK.
