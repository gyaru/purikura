# Purikura

a cute, shared identity layer for Hermes Desktop.

purikura keeps Hermes sessions unified while attaching the correct human identity to messages and, later, voice segments.

## Current status

The first working slice is a Hermes Desktop plugin:

- choose an identity from the composer
- remember the choice locally per Desktop installation
- tag outgoing messages with `[Speaker: Name]`
- keep one shared Hermes session list

This is an MVP. The tag is currently prompt-visible text, not trusted backend metadata.

The shared backend is now scaffolded under `backend/speaker_identity/dashboard/`. It stores the shared identity roster and per-Desktop-installation defaults in a gateway-local SQLite database. Enable `speaker-identity` in `plugins.enabled`, restart the gateway, and the Desktop plugin will use the shared roster when the API is reachable. It falls back to generic local settings when the backend is unavailable.

## Planned architecture

```text
Desktop plugin
  - active identity picker
  - local device preference
  - composer middleware
  - shared settings client

Hermes gateway plugin backend
  - shared people/identity registry
  - device-to-default-identity mapping
  - future trusted author metadata

Speech integration, later
  - ASR: speech to text
  - diarization: anonymous who-spoke-when segments
  - identification: map voice to a known person
  - verification: confirm a claimed identity
```

Use `author_id` for typed-message authors and `speaker_id` for audio segments. Keep detection provenance, confidence, and verification state separate from the display name.

## Development layout

- `desktop/speaker-identity/plugin.js` is the runtime-loaded Desktop plugin.
- `backend/speaker_identity/` will hold the gateway-side plugin API.
- `tests/` holds contract and behavior tests.
- `examples/roster.json` shows a two-person Alice/Bob roster without baking those names into the plugin.

## Installing the current Desktop slice

Copy `desktop/speaker-identity/` to:

```text
$HERMES_HOME/desktop-plugins/speaker-identity/
```

Then reload Desktop plugins from the command palette.
