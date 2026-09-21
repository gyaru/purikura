# Tests

Node 22.13+ and Python 3.11+:

```sh
npm ci
npm test
uv run --with pytest==8.3.5 --with fastapi==0.115.12 --with httpx==0.28.1 --with pyyaml==6.0.2 python -m pytest tests -q
```

The frontend harness loads the actual uncompiled plugin with real React and React Query, mocking only the Hermes SDK bridge. It covers shared create/rename, real interval polling, independent clients, scoped persistence, stale responses, unavailable people, send-time validation, attachments and commands. This is not an Electron UI end-to-end test.

## Browser UI and actual HTTP (optional)

With a Hermes source checkout whose Node dependencies and dashboard assets are built, and a Python environment containing its server dependencies:

```sh
npx playwright install chromium
HERMES_SOURCE=/path/to/hermes-agent HERMES_PYTHON=/path/to/hermes-agent/.venv/bin/python3 npm run test:browser
```

This runs the actual web dashboard route and a browser harness using Desktop’s real Button/Input components, styles and palette. Only the Desktop SDK bridge is mocked; both surfaces create and rename through an isolated assembled Hermes HTTP server. It checks reload persistence, compact status controls, narrow layout and light/dark rendering. It is **not an Electron app test**. Screenshots and `result.json` go to ignored `artifacts/` (override with `PURIKURA_ARTIFACTS`). Optional unrelated media/typography CSS is omitted from the harness.

`tests/test_dashboard_http.py` also verifies discovery, script serving, authentication and profile isolation. Set `HERMES_PYTHON` for its server subprocess; the pytest runner needs pytest, FastAPI, httpx, PyYAML and Rich for all host integration tests.

## Actual Hermes installers (optional)

Set `HERMES_SOURCE` to a Hermes source checkout. For Python, use an environment with that checkout's dependencies and pytest installed:

```sh
HERMES_SOURCE=/path/to/hermes-agent npm test
HERMES_SOURCE=/path/to/hermes-agent python -m pytest tests -q
```

Without `HERMES_SOURCE`, the host integration tests explicitly skip; the portable root-contract test still runs. All integration installs use temporary homes and offline Git fixtures, never live plugins. Set `TMPDIR` if you need a specific scratch location.

Validated against Hermes source `fca3221df48d4ae1e4db9e8a1a041de21ea4d9cf`:

- Python `_install_plugin_core`: real clone, manifest validation, security scan, install metadata and dashboard discovery; the installed API serves a fresh **User** roster.
- Electron `detectPluginComponents`, `probePluginRepo` and `installDesktopPluginFromGit`: actual TypeScript source loaded through Node's type stripping, real offline clone and desktop publication. Both components are found from the repository root. A Desktop-only install creates no backend.
- Installer routing was inspected in `apps/desktop/src/app/settings/plugin-install-modal.tsx` and `src/store/agent-plugins.ts`: Agent uses `plugins.manage` on the connected gateway; local unified installs reconcile the desktop half, while remote connections clone it locally. Remote permissions, authentication and service restarts were not exercised against a live gateway.

[Official unified-package contract](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk#one-package-both-sdks).

Expected tool warnings: Node experimental VM/type-stripping notices, React test-renderer deprecation, and (depending on host dependencies) Starlette/AnyIO deprecation. No runtime dependency installation or npm build is needed for Purikura itself; Hermes supplies FastAPI and the Desktop SDK.
