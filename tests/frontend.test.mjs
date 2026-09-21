import test from 'node:test'
import assert from 'node:assert/strict'
import {loadPlugin} from './harness.mjs'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {QueryClientProvider} from '@tanstack/react-query'
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const tick=()=>new Promise(r=>setTimeout(r,20))

test('status bar is only a compact person selector',async()=>{
  const p=await loadPlugin();p.module.default.register(p.ctx);let tree
  await act(async()=>{tree=create(React.createElement(QueryClientProvider,{client:p.queryClient},p.contributions.find(c=>c.area==='statusBar.right').render()));await tick()});await act(tick)
  assert.equal(tree.root.findAllByType('button').length,0)
  assert.equal(tree.root.findAllByProps({role:'status'}).length,0)
  assert.equal(tree.root.findAllByType('select').length,1)
  await act(async()=>tree.unmount());p.dispose()
})

test('unified Desktop package stays opt-in until enabled',async()=>{
  const p=await loadPlugin()
  assert.equal(p.module.default.defaultEnabled,false)
  p.dispose()
})

test('People page creates and renames shared people, selection stays local',async()=>{
  const p=await loadPlugin(); const roster=[{id:'person:user',display_name:'User',enabled:true}]
  p.setResponse(async(path,options)=>{
    if(options?.method==='PUT') {
      const id=decodeURIComponent(path.split('/').pop())
      const person=roster.find(x=>x.id===id)
      if(person)person.display_name=options.body.display_name
      else roster.push({id,display_name:options.body.display_name,enabled:true})
    }
    return {identities:roster.map(x=>({...x}))}
  })
  p.module.default.register(p.ctx)
  const page=p.contributions.find(c=>c.area==='routes')
  assert.ok(page,'People settings route is registered')
  let tree
  await act(async()=>{tree=create(React.createElement(QueryClientProvider,{client:p.queryClient},page.render()));await tick()})
  await act(tick)
  const field=()=>tree.root.findByProps({'aria-label':'New person name'})
  await act(async()=>field().props.onChange({target:{value:'Alice'}}))
  await act(async()=>tree.root.findByProps({'aria-label':'Create person'}).props.onClick())
  await act(tick)
  assert.equal(roster.length,2)
  const alice=roster.find(x=>x.display_name==='Alice')
  assert.equal(tree.root.findAllByProps({role:'status'}).length,1)
  assert.equal(tree.root.findAllByType('label').length,1)
  await act(async()=>tree.root.findByProps({'aria-label':`Edit ${alice.display_name}`}).props.onClick())
  await act(async()=>tree.root.findByProps({'aria-label':`Name for ${alice.id}`}).props.onChange({target:{value:'Bob'}}))
  await act(async()=>tree.root.findByProps({'aria-label':`Rename ${alice.id}`}).props.onClick())
  await act(tick)
  assert.equal(alice.display_name,'Bob')
  assert.ok(!p.calls.some(([path])=>path.startsWith('/devices/')))
  await act(async()=>tree.unmount());p.dispose()
})

const people=[{id:'person:alice',display_name:'Alice',enabled:true},{id:'person:bob',display_name:'Bob',enabled:true}]
async function ready(){const p=await loadPlugin();p.setResponse(async()=>({identities:people,default_identity_id:'person:alice'}));const c=p.module.createController(p.ctx);await c.refresh();c.choose('person:bob');return {p,c}}

test('send revalidates current roster and refuses network errors or another focused owner',async()=>{
  const {p,c}=await ready()
  p.setResponse(async()=>{throw Error('offline')})
  assert.equal(await c.tag({text:'hello'}),null)
  p.setResponse(async()=>({identities:people}))
  p.host.state.focusedSessionOwner.set({connectionId:'other',profile:'default'})
  assert.equal(await c.tag({text:'hello'}),null)
  p.dispose()
})

test('late fetch never overwrites a newer selection; unavailable selection never falls back',async()=>{
  const {p,c}=await ready();let resolve
  p.setResponse(()=>new Promise(r=>{resolve=r}))
  const pending=c.refresh();c.choose('person:alice')
  resolve({identities:people,default_identity_id:'person:bob'});await pending
  assert.equal(c.state.get().selected,'person:alice')
  p.setResponse(async()=>({identities:[people[1]],default_identity_id:'person:bob'}));await c.refresh()
  assert.equal(c.state.get().selected,'person:alice')
  assert.equal(await c.tag({text:'hello'}),null);p.dispose()
})

test('scope changes isolate defaults and ignore late responses',async()=>{
  const {p,c}=await ready();let resolve
  p.setResponse(()=>new Promise(r=>{resolve=r}));const pending=c.refresh()
  p.host.state.connectionId.set('gateway-b')
  assert.equal(c.state.get().selected,null)
  resolve({identities:people});await pending
  assert.equal(c.state.get().people.length,0)
  p.host.state.connectionId.set('gateway-a');assert.equal(c.state.get().selected,'person:bob')
  p.host.state.profile.set('work');assert.equal(c.state.get().selected,null)
  p.dispose()
})

test('stale UI actions cannot create or select people on a new gateway',async()=>{
  const {p,c}=await ready();const oldScope=c.state.get().scope
  p.host.state.connectionId.set('gateway-b');await c.refresh()
  await assert.rejects(c.savePerson('person:alice','Alice',oldScope),/scope changed/i)
  c.choose('person:bob',oldScope)
  assert.equal(c.state.get().selected,null)
  assert.ok(!p.calls.some(([,opts])=>opts?.method==='PUT'))
  p.dispose()
})

test('real React Query polling refreshes another client without synchronizing active choices',async()=>{
  const a=await loadPlugin(),b=await loadPlugin();let roster=people
  const response=async()=>({identities:roster})
  a.setResponse(response);b.setResponse(response)
  a.module.default.register(a.ctx);b.module.default.register(b.ctx)
  let ta,tb
  const render=p=>React.createElement(QueryClientProvider,{client:p.queryClient},p.contributions.find(c=>c.area==='statusBar.right').render())
  await act(async()=>{ta=create(render(a));tb=create(render(b));await tick()});await act(tick)
  await act(async()=>{ta.root.findByProps({'aria-label':'Active person'}).props.onChange({currentTarget:{value:'person:alice'}});tb.root.findByProps({'aria-label':'Active person'}).props.onChange({currentTarget:{value:'person:bob'}})})
  const before=b.calls.length
  roster=[...people,{id:'person:new',display_name:'User',enabled:true}]
  await act(async()=>{await new Promise(r=>setTimeout(r,5200))});await act(tick)
  assert.ok(b.calls.length>before,'poll executed without sockets')
  assert.equal(tb.root.findAllByType('option').length,4)
  assert.equal(ta.root.findByProps({'aria-label':'Active person'}).props.value,'person:alice')
  assert.equal(tb.root.findByProps({'aria-label':'Active person'}).props.value,'person:bob')
  await act(async()=>{ta.unmount();tb.unmount()});a.dispose();b.dispose()
})

test('middleware preserves attachments and commands, uses updated names, cancels mid-send switches',async()=>{
  const {p,c}=await ready();const attachments=[{id:'file'}]
  const slash={text:'/help',attachments};assert.equal(await c.tag(slash),slash)
  p.setResponse(async()=>({identities:[{...people[1],display_name:'Bob Updated'}]}))
  const draft=await c.tag({text:'[Speaker: Alice]\nquoted',attachments})
  assert.equal(draft.text,'[Speaker: Bob Updated]\n[Speaker: Alice]\nquoted')
  assert.equal(draft.attachments,attachments)
  p.setResponse(async()=>({identities:people}));await c.refresh()
  let resolve;p.setResponse(()=>new Promise(r=>{resolve=r}));const pending=c.tag({text:'hello'})
  c.choose('person:alice');resolve({identities:people})
  assert.equal(await pending,null);p.dispose()
})

test('attachment-only messages also require and receive attribution',async()=>{
  const p=await loadPlugin();const c=p.module.createController(p.ctx)
  assert.equal(await c.tag({text:'',attachments:[{id:'file'}]}),null)
  await c.refresh();c.choose('person:user')
  assert.equal((await c.tag({text:'',attachments:[{id:'file'}]})).text,'[Speaker: User]\n')
  p.dispose()
})

test('unresolved identity cancels rather than silently attributing User',async()=>{
  const p=await loadPlugin(); p.setResponse(()=>new Promise(()=>{}))
  p.module.default.register(p.ctx)
  const handler=p.contributions.find(c=>c.area==='composer.middleware').data.handler
  assert.equal(await handler({text:'hello'}),null)
  p.dispose()
})
