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
const rowStyle = {display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}
const muted = {color:'var(--ui-text-secondary)',fontSize:12,lineHeight:1.6}
const cardStyle = {border:'1px solid var(--ui-stroke-secondary)',borderRadius:8,padding:20}
function ConnectionState({state,query}) {
  const text = !state.scope ? 'Connect a gateway to manage people.' : state.status === 'error'
    ? `People unavailable: ${state.error}` : state.status === 'loading' ? 'Connecting…' : 'Shared roster · synced automatically'
  return jsxs('div',{style:{...rowStyle,...muted,justifyContent:'space-between'},children:[
    jsx('span',{role:state.status==='error'?'alert':'status',children:text}),
    jsx(Button,{variant:'ghost',size:'sm',onClick:()=>void query.refetch(),children:'Refresh',disabled:!state.scope || query.isFetching})]})
}
function Picker({controller}) {
  const {state}=useRoster(controller)
  const missing = state.selected && !state.people.some(p=>p.id===state.selected)
  return jsx('select',{'aria-label':'Active person',title:state.error || 'Who’s speaking? Manage the roster in People.',
    style:{font:'inherit',fontSize:12,color:'var(--ui-text-secondary)',background:'var(--ui-bg-primary)',
      border:'none',borderRadius:4,padding:'1px 6px',maxWidth:160,height:22,cursor:'pointer'},
    value:missing?'':state.selected || '',onChange:event=>controller.choose(event.currentTarget.value,state.scope),children:[
      jsx('option',{value:'',disabled:true,children:missing?'Choose again':'Choose person'},'empty'),
      ...state.people.map(p=>jsx('option',{value:p.id,children:p.display_name},p.id))]})
}
function RenamePerson({person,save,pending,selected,choose}) {
  const [name,setName]=useState(person.display_name)
  const [editing,setEditing]=useState(false)
  useEffect(()=>setName(person.display_name),[person.display_name])
  const submit=()=>save({id:person.id,name},{onSuccess:()=>setEditing(false)})
  return jsxs('li',{style:{...rowStyle,padding:'14px 0',borderBottom:'1px solid var(--ui-stroke-secondary)'},children:[
    jsx('span',{'aria-hidden':true,style:{width:32,height:32,flexShrink:0,display:'grid',placeItems:'center',borderRadius:6,
      background:'var(--ui-bg-quaternary)',color:'var(--ui-text-secondary)',fontWeight:600},children:person.display_name.slice(0,1).toUpperCase()}),
    editing ? jsxs('form',{style:{...rowStyle,flex:1},onSubmit:e=>{e.preventDefault();if(validName(name)&&!pending)submit()},children:[
      jsx('label',{htmlFor:`rename-${person.id}`,style:muted,children:'Display name'}),
      jsx(Input,{id:`rename-${person.id}`,'aria-label':`Name for ${person.id}`,style:{flex:1,minWidth:100},autoFocus:true,value:name,maxLength:80,onChange:e=>setName(e.target.value)}),
      jsx(Button,{type:'button',size:'sm','aria-label':`Rename ${person.id}`,disabled:pending || !validName(name),onClick:submit,children:'Save'}),
      jsx(Button,{type:'button',variant:'ghost',size:'sm',disabled:pending,onClick:()=>{setName(person.display_name);setEditing(false)},children:'Cancel'})]})
    : jsxs('div',{style:{...rowStyle,flex:1,minWidth:0},children:[
      jsx('span',{style:{flex:'1 1 100px',minWidth:100,overflowWrap:'anywhere',fontWeight:500},children:person.display_name}),
      jsx(Button,{variant:'ghost',size:'sm',disabled:pending,onClick:choose,children:selected?'Active on this device':'Use'}),
      jsx(Button,{variant:'ghost',size:'sm','aria-label':`Edit ${person.display_name}`,onClick:()=>setEditing(true),children:'Rename'})]})]})
}
function People({controller}) {
  const {state,query}=useRoster(controller)
  return jsx(PeopleForm,{controller,state,query},state.scope || 'unconnected')
}
function PeopleForm({controller,state,query}) {
  const [name,setName]=useState('')
  const mutation=useMutation({mutationFn:({id,name})=>controller.savePerson(id,name,state.scope)})
  const create=()=>{if(validName(name)&&!mutation.isPending)mutation.mutate({id:`person:${globalThis.crypto.randomUUID().replaceAll('-','')}`,name},{onSuccess:()=>setName('')})}
  return jsxs('section',{'aria-label':'People settings',style:{maxWidth:680,margin:'0 auto',padding:'32px 24px',color:'var(--ui-text-primary)',fontSize:13},children:[
    jsx('p',{style:{...muted,margin:'0 0 6px'},children:'Purikura'}),
    jsx('h1',{style:{fontSize:26,fontWeight:600,letterSpacing:'-.025em',margin:'0 0 8px'},children:'People'}),
    jsx('p',{style:{...muted,margin:'0 0 24px'},children:'A shared roster. Your own voice.'}),
    jsxs('div',{style:cardStyle,children:[
      jsx('h2',{style:{fontSize:14,fontWeight:600,margin:0},children:'Who’s speaking?'}),
      jsx('p',{style:{...muted,margin:'4px 0 6px'},children:'Choose a person for messages from this device.'}),
      jsx('ul',{style:{listStyle:'none',padding:0,margin:0},children:state.people.map(person=>jsx(RenamePerson,{person,save:mutation.mutate,pending:mutation.isPending,
        selected:state.selected===person.id,choose:()=>controller.choose(person.id,state.scope)},person.id))}),
      state.status==='ready'&&!state.people.length ? jsx('p',{style:muted,children:'No people yet. Add the first person below.'}):null,
      jsx(ConnectionState,{state,query})]}),
    jsxs('form',{style:{...cardStyle,marginTop:16},onSubmit:e=>{e.preventDefault();create()},children:[
      jsx('h2',{style:{fontSize:14,fontWeight:600,margin:'0 0 16px'},children:'Add a person'}),
      jsx('label',{htmlFor:'purikura-new-person',style:{display:'block',fontSize:12,marginBottom:6},children:'Display name'}),
      jsxs('div',{style:rowStyle,children:[
        jsx(Input,{id:'purikura-new-person','aria-label':'New person name',placeholder:'e.g. Alice',style:{flex:1,minWidth:120},value:name,maxLength:80,onChange:e=>setName(e.target.value)}),
        jsx(Button,{type:'button','aria-label':'Create person',disabled:mutation.isPending || !state.scope || !validName(name),onClick:create,children:mutation.isPending?'Saving…':'Add person'})]})]}),
    mutation.isError ? jsx('p',{role:'alert',style:muted,children:`Save failed: ${mutation.error.message}`}) : null,
    jsx('p',{style:{...muted,marginTop:18},children:'Names sync across clients. Selection is not sign-in or memory separation.'})]})
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
