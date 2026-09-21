# Purikura

a cute, shared identity layer for Hermes Desktop.

purikura keeps Hermes sessions unified while attaching the correct human identity to messages and, later, voice segments.

Create and rename people in **People** in Desktop or the web dashboard (`/purikura`). The roster syncs across clients; Desktop’s compact person selector remembers your choice per gateway/profile. A fresh roster starts with **User**.

## Install

Requires a recent Hermes Desktop with unified-package **Install from Git** support.

1. Open **Capabilities → Plugins → Install from Git** and enter `https://github.com/gyaru/purikura`.
2. Select **Agent** for the connected gateway/profile and **Desktop** for this machine. Enable the agent half. Review the custom-source prompt and confirm.
3. Restart the gateway/dashboard serving that profile to mount the API, then enable Purikura's Desktop toggle. Open **People** and choose who's speaking.

With a local gateway, Desktop loads its half from the installed package. With a remote gateway, Agent installation is a separate gateway request and Desktop is cloned locally; Desktop-only installation does **not** install the server API. Check both results. If remote installation is unavailable, run on the server in the intended profile:

```sh
hermes plugins install https://github.com/gyaru/purikura --enable
```

Then restart that server's gateway/dashboard. Other desktops can select only **Desktop** once the shared backend is active. A 404 usually means the backend is missing, disabled, or needs a restart.

**Update:** run `hermes plugins update purikura` on the server in the intended profile, then restart the process serving its dashboard/API. Update the Desktop installation on each client separately when connected remotely.

**From speaker-identity:** run `hermes plugins disable speaker-identity` in that profile and disable its Desktop toggle on every client. This removes the old dashboard navigation on current Hermes and prevents duplicate message tags. Keep `plugin-data/speaker-identity.sqlite3`; Purikura reuses it. Do not delete the database or profile. A standalone copied Desktop folder is not automatically replaced by a unified package.

## Status

Messages get a visible `[Speaker: Name]` tag. Manual selection is **not authentication or enforced memory separation**. Voice support is planned.

[Tests and installer compatibility](tests/README.md) · [API](dashboard/README.md)
