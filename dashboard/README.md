# Purikura gateway API

This API ships inside the root unified package; do not install this subdirectory alone.
See the repository README for Git installation and server activation.
The gateway supplies FastAPI; no additional runtime package is required here.

API prefix: `/api/plugins/purikura`

- `GET /state`: shared enabled roster; optional `device_id` for legacy defaults.
- `PUT /identities/{identity_id}` with `{"display_name":"Alice"}`: create/rename.
- `PUT /devices/{device_id}` with `{"default_identity_id":"person:..."}`: legacy
  device API, retained for compatibility. New Desktop code uses scoped local
  storage instead and never reads a server default into the active choice.

Database: `plugin-data/speaker-identity.sqlite3` beneath the request's Hermes
home. The old filename is intentional. This API does not authenticate humans
or isolate their memory; gateway authentication controls access to the API.
