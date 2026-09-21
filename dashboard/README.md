# Purikura People dashboard and API

This API ships inside the root unified package; do not install this subdirectory alone.
See the repository README for Git installation and server activation.
The gateway supplies FastAPI; no additional runtime package is required here.

Open **People** in the dashboard sidebar or visit `/purikura` to add and rename people. The manifest serves `people.js` directly through `window.__HERMES_PLUGIN_SDK__`, not the native `@hermes/plugin-sdk`; no plugin build is needed. Desktop selection and message attribution remain Desktop-only.

API prefix: `/api/plugins/purikura`. An explicit `?profile=<name>` uses Hermes'
validated, request-local profile scope and requires Purikura enabled there.
Unknown or disabled profiles fail closed, rather than reading the launch roster.

- `GET /state`: shared enabled roster; optional `device_id` for legacy defaults.
- `PUT /identities/{identity_id}` with `{"display_name":"Alice"}`: create/rename.
- `PUT /devices/{device_id}` with `{"default_identity_id":"person:..."}`: legacy
  device API, retained for compatibility. New Desktop code uses scoped local
  storage instead and never reads a server default into the active choice.

Database: `plugin-data/speaker-identity.sqlite3` beneath the request's Hermes
home. The old filename is intentional. This API does not authenticate humans
or isolate their memory; gateway authentication controls access to the API.
