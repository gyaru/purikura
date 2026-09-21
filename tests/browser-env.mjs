// Browser scheduling only; no Electron bridge or DOM is emulated.
// React Query disables interval timers on the server, so supply its browser check.
globalThis.window = {addEventListener(){},removeEventListener(){}}
globalThis.document = {visibilityState:'visible'}
