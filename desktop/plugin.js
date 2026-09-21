/** Manual attribution only: not authentication, verification, or memory isolation. */
import { COMPOSER_AREAS, ROUTES_AREA, SIDEBAR_NAV_AREA, host, atom,
  useValue, useQuery, useMutation, queryClient, Button, Input } from '@hermes/plugin-sdk'
import { useState, useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'purikura'
const PATH = '/purikura/people'
export const POLL_MS = 5000
const validName = name => typeof name === 'string' && name.trim().length > 0 &&
  name.length <= 80 && !/[\u0000-\u001f\u007f\[\]]/.test(name)

// Local defaults are deliberately NOT hydrated from the server's legacy device
// defaults. A late roster fetch must never overwrite a deliberate human choice.
export function createController(ctx) {
  const state = atom({ scope: null, selected: null, people: [], status: 'loading', error: null })
  let disposed = false
  let sequence = 0
  const scopeNow = () => {
    const connection = host.state.connectionId?.get()
    const profile = host.state.profile?.get()
    return connection && profile ? JSON.stringify([connection, profile]) : null
  }
  const storageKey = scope => `active-person-v2:${scope}`
  function syncScope() {
    const scope = scopeNow()
    if (scope !== state.get().scope) {
      sequence++
      const saved = scope ? ctx.storage.get(storageKey(scope), null) : null
      state.set({scope, selected: typeof saved === 'string' ? saved : null,
        people: [], status: 'loading', error: null})
    }
    return scope
  }
  function current(scope) { return !disposed && scope && scope === scopeNow() && scope === state.get().scope }
  async function refresh(expectedScope = syncScope()) {
    const scope = syncScope()
    if (scope !== expectedScope) throw Error('Gateway/profile scope changed; retry.')
    if (!scope) throw Error('Gateway/profile scope unavailable; update Desktop or connect a gateway.')
    const request = ++sequence
    try {
      const result = await ctx.rest('/state', {timeoutMs: 10000})
      if (!Array.isArray(result?.identities)) throw Error('Invalid People response')
      const people = result.identities.filter(p => p.enabled !== false &&
        typeof p.id === 'string' && validName(p.display_name))
      if (current(scope) && request === sequence) state.set({...state.get(), people, status:'ready', error:null})
      return people
    } catch (error) {
      if (current(scope) && request === sequence) state.set({...state.get(), status:'error', error:String(error.message || error)})
      throw error
    }
  }
  function choose(id, expectedScope = syncScope()) {
    const scope = syncScope(), snapshot = state.get()
    if (scope !== expectedScope || !current(scope) || !snapshot.people.some(p => p.id === id)) return
    state.set({...snapshot, selected:id})
    try { ctx.storage.set(storageKey(scope), id) }
    catch { host.notify({kind:'error',message:'Person selected for this window, but the device default could not be saved.'}) }
  }
  async function savePerson(id, name, expectedScope) {
    const scope = syncScope()
    if (scope !== expectedScope) throw Error('Gateway/profile scope changed; review and retry.')
    if (!current(scope)) throw Error('Connect a gateway first')
    if (!validName(name)) throw Error('Use 1–80 characters, without brackets or control characters.')
    await ctx.rest(`/identities/${encodeURIComponent(id)}`, {method:'PUT',body:{display_name:name.trim()},timeoutMs:10000})
    if (!current(scope)) throw Error('Saved to the previous gateway/profile. Scope changed; check that roster.')
    await queryClient.invalidateQueries({queryKey:[ID,scope]})
  }
  async function tag(draft) {
    const text = typeof draft.text === 'string' ? draft.text : ''
    if ((!text.trim() && !draft.attachments?.length) || text.trim().startsWith('/')) return draft
    syncScope()
    const s = state.get()
    const focusedMatches = () => {
      const owner = host.state.focusedSessionOwner?.get()
      return owner && JSON.stringify([owner.connectionId, owner.profile]) === s.scope
    }
    const refuse = message => { host.notify({kind:'error',message}); return null }
    if (!s.selected || !focusedMatches()) return refuse('Choose a person on the active gateway/profile before sending. Focused chat must belong to that scope.')
    let people
    try { people = await refresh() }
    catch { return refuse('People unavailable. Message not sent; reconnect and retry.') }
    if (!current(s.scope) || !focusedMatches() || state.get().selected !== s.selected) {
      return refuse('Person or chat scope changed while sending. Review and retry.')
    }
    const person = people.find(p=>p.id===s.selected)
    if (!person) return refuse('Selected person is unavailable. Choose explicitly in People; message not sent.')
    return {...draft,text:`[Speaker: ${person.display_name}]\n${text}`}
  }
  syncScope()
  const stops = [host.state.connectionId, host.state.profile].filter(Boolean).map(a=>a.listen(syncScope))
  ctx.onDispose(()=>{disposed=true;sequence++;stops.forEach(stop=>stop())})
  return {state,refresh,choose,savePerson,tag,syncScope}
}

function useRoster(controller) {
  const state = useValue(controller.state)
  const query = useQuery({queryKey:[ID,state.scope],queryFn:()=>controller.refresh(state.scope),
    enabled:Boolean(state.scope),refetchInterval:POLL_MS,refetchIntervalInBackground:true,
    refetchOnWindowFocus:true,staleTime:0,retry:1})
  return {state,query}
}
function ConnectionState({state,query}) {
  const text = !state.scope ? 'Gateway/profile unavailable' : state.status === 'error'
    ? `People unavailable: ${state.error}. Check the backend plugin and connection.`
    : state.status === 'loading' ? 'Connecting to shared People…'
    : `Shared roster connected${query.isFetching ? ' · refreshing…' : ' · refreshes every 5 seconds'}`
  return jsxs('div',{role:state.status==='error'?'alert':'status',children:[text,' ',
    jsx(Button,{onClick:()=>void query.refetch(),children:'Refresh',disabled:!state.scope})]})
}
function Picker({controller}) {
  const {state,query}=useRoster(controller)
  const missing = state.selected && !state.people.some(p=>p.id===state.selected)
  return jsxs('div',{className:'flex items-center gap-2 text-(--ui-text-secondary)',children:[
    jsx('select',{'aria-label':'Active person',value:missing?'':state.selected || '',
      onChange:event=>controller.choose(event.currentTarget.value,state.scope),children:[
        jsx('option',{value:'',children:missing?'Selected person unavailable — choose again':'Choose person'},'empty'),
        ...state.people.map(p=>jsx('option',{value:p.id,children:p.display_name},p.id))]}),
    jsx(Button,{onClick:()=>host.navigate(PATH),children:'People'}),
    jsx(ConnectionState,{state,query})]})
}
function RenamePerson({person,save,pending}) {
  const [name,setName]=useState(person.display_name)
  useEffect(()=>setName(person.display_name),[person.display_name])
  return jsxs('div',{className:'flex gap-2 items-center',children:[
    jsx(Input,{'aria-label':`Name for ${person.id}`,value:name,maxLength:80,onChange:e=>setName(e.target.value)}),
    jsx(Button,{'aria-label':`Rename ${person.id}`,disabled:pending || !validName(name),onClick:()=>save({id:person.id,name}),children:'Rename'})]})
}
function People({controller}) {
  const {state,query}=useRoster(controller)
  const [name,setName]=useState('')
  const mutation=useMutation({mutationFn:({id,name})=>controller.savePerson(id,name,state.scope)})
  return jsxs('section',{className:'p-4 space-y-4 text-(--ui-text-secondary)',children:[
    jsx('h1',{children:'People · Purikura'}),
    jsx('p',{children:'Names are shared by clients connected to this gateway/profile. The active person is remembered only on this device for that scope. Manual selection is not authentication; it does not isolate memory or sessions.'}),
    jsx(ConnectionState,{state,query}),
    jsx(Picker,{controller}),
    ...state.people.map(person=>jsx(RenamePerson,{person,save:mutation.mutate,pending:mutation.isPending},`${state.scope}:${person.id}`)),
    jsxs('div',{className:'flex gap-2',children:[
      jsx(Input,{'aria-label':'New person name',value:name,maxLength:80,onChange:e=>setName(e.target.value)}),
      jsx(Button,{'aria-label':'Create person',disabled:mutation.isPending || !state.scope || !validName(name),
        onClick:()=>mutation.mutate({id:`person:${globalThis.crypto.randomUUID().replaceAll('-','')}`,name},{onSuccess:()=>setName('')}),children:'Create person'})]}),
    mutation.isError ? jsx('p',{role:'alert',children:`Save failed: ${mutation.error.message}`}) : null,
    mutation.isSuccess ? jsx('p',{role:'status',children:'Saved to shared People.'}) : null]})
}
export default {
  id:ID,name:'Purikura',defaultEnabled:false,description:'Shared People settings and per-device manual attribution.',
  register(ctx) {
    const controller=createController(ctx)
    ctx.register({id:'composer-control',area:COMPOSER_AREAS.leading,order:10,render:()=>jsx(Picker,{controller})})
    // Status bar remains mounted while navigating, so the shared query keeps polling.
    ctx.register({id:'connection',area:'statusBar.right',render:()=>jsx(Picker,{controller})})
    ctx.register({id:'people',area:ROUTES_AREA,data:{path:PATH},render:()=>jsx(People,{controller})})
    ctx.register({id:'people-nav',area:SIDEBAR_NAV_AREA,data:{path:PATH,label:'People',codicon:'account'}})
    ctx.register({id:'tag-outgoing-messages',area:COMPOSER_AREAS.middleware,data:{handler:controller.tag}})
  }
}
