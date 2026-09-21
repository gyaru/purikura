/**
 * purikura - speaker identity for Hermes Desktop.
 *
 * Install at:
 *   $HERMES_HOME/desktop-plugins/purikura/plugin.js
 *
 * The selected person is stored locally per Desktop installation. Outgoing
 * messages are tagged before they enter Hermes' shared session:
 *   [Speaker: Example]\nmessage text
 */

import {
  COMPOSER_AREAS,
  cn,
  haptic,
  host,
  Tip,
  useValue,
  atom
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'purikura'
const STORAGE_KEY = 'active-speaker'
const DEVICE_KEY = 'device-id'
const FALLBACK_SPEAKERS = [
  { id: 'person:user', label: 'User' }
]

const $speaker = atom('person:user')
const $identities = atom(FALLBACK_SPEAKERS)
let storage = null
let deviceId = null
let rest = null

function speakerLabel(id) {
  return $identities.get().find(person => person.id === id)?.label || id
}

function validIdentities(value) {
  return Array.isArray(value)
    ? value.filter(person => person && typeof person.id === 'string' && typeof person.display_name === 'string')
      .map(person => ({ id: person.id, label: person.display_name }))
    : []
}

function newDeviceId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `device:${(uuid || `${Date.now()}${Math.random()}`).replaceAll('-', '')}`
}

function SpeakerControl() {
  const speaker = useValue($speaker)
  const identities = useValue($identities)
  const label = speakerLabel(speaker)

  return jsx(Tip, {
    label: 'Identity added to messages sent from this Desktop',
    children: jsx('label', {
      className: 'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-secondary)',
      children: [
        jsx('span', { className: 'text-(--ui-accent)', children: '●' }),
        jsx('select', {
          className: 'max-w-[6rem] cursor-pointer bg-transparent text-inherit outline-none',
          value: speaker,
          'aria-label': 'Active speaker identity',
          onChange: event => {
            const next = event.currentTarget.value
            if (!identities.some(person => person.id === next)) return
            $speaker.set(next)
            if (storage) void storage.set(STORAGE_KEY, next)
            if (rest && deviceId) {
              void rest(`/devices/${encodeURIComponent(deviceId)}`, {
                method: 'PUT',
                body: { default_identity_id: next }
              }).catch(() => {})
            }
            haptic('tap')
          },
          children: identities.map(person =>
            jsx('option', { key: person.id, value: person.id, children: person.label })
          )
        })
      ]
    })
  })
}

function SpeakerBadge() {
  const speaker = useValue($speaker)
  return jsx('span', {
    className: cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[0.6875rem]',
      'bg-(--ui-accent)/10 text-(--ui-accent)'
    ),
    children: `Speaking as ${speakerLabel(speaker)}`
  })
}

function tagDraft(draft) {
  const text = typeof draft.text === 'string' ? draft.text : ''
  const trimmed = text.trim()

  if (!trimmed || trimmed.startsWith('/')) return draft
  if (/^\[Speaker: [^\]]+\]\s*/.test(trimmed)) return draft

  return {
    ...draft,
    text: `[Speaker: ${speakerLabel($speaker.get())}]\n${text}`
  }
}

export default {
  id: ID,
  name: 'purikura',
  description: 'Tags Desktop messages with the person who sent them.',
  register(ctx) {
    storage = ctx.storage
    rest = ctx.rest

    deviceId = storage.get(DEVICE_KEY)
    if (!deviceId) {
      deviceId = newDeviceId()
      void storage.set(DEVICE_KEY, deviceId)
    }

    const localSpeaker = storage.get(STORAGE_KEY)
    if (typeof localSpeaker === 'string') $speaker.set(localSpeaker)

    void rest(`/state?device_id=${encodeURIComponent(deviceId)}`).then(state => {
      const identities = validIdentities(state?.identities)
      if (identities.length) $identities.set(identities)
      if (state?.default_identity_id && identities.some(person => person.id === state.default_identity_id)) {
        $speaker.set(state.default_identity_id)
        void storage.set(STORAGE_KEY, state.default_identity_id)
      } else if (localSpeaker && identities.some(person => person.id === localSpeaker)) {
        void rest(`/devices/${encodeURIComponent(deviceId)}`, {
          method: 'PUT',
          body: { default_identity_id: localSpeaker }
        }).catch(() => {})
      }
    }).catch(() => {})

    ctx.i18n.register({
      en: {
        identity: person => `Speaking as ${person}`
      }
    })

    ctx.register({
      id: 'composer-control',
      area: COMPOSER_AREAS.leading,
      order: 10,
      render: () => jsx(SpeakerControl, {})
    })

    ctx.register({
      id: 'status-badge',
      area: 'statusBar.right',
      order: 125,
      render: () => jsx(SpeakerBadge, {})
    })

    ctx.register({
      id: 'tag-outgoing-messages',
      area: COMPOSER_AREAS.middleware,
      data: {
        handler: async draft => tagDraft(draft)
      }
    })
  }
}
