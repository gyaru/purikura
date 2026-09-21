import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import * as React from 'react'
import * as JSX from 'react/jsx-runtime'
import * as Query from '@tanstack/react-query'
import { atom } from 'nanostores'
import { useStore } from '@nanostores/react'
export async function loadPlugin(values = new Map()) {
  const contributions = [], disposers = [], calls = [], notifications = []
  const host = { state: { connectionId: atom('gateway-a'), profile: atom('default'), gateway: atom('open'), focusedSessionOwner: atom({connectionId:'gateway-a',profile:'default'}) }, notify: x => notifications.push(x), navigate() {} }
  const queryClient = new Query.QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{gcTime:0}}})
  const sdk = { ...Query, atom, useValue: useStore, queryClient, host,
    COMPOSER_AREAS: {leading:'composer.leading', middleware:'composer.middleware'},
    ROUTES_AREA:'routes', SIDEBAR_NAV_AREA:'sidebar.nav',
    Button: 'button', Input: 'input', Tip: ({children}) => children, cn: (...xs) => xs.join(' '), haptic() {} }
  const context = vm.createContext({console, globalThis, setTimeout, clearTimeout, crypto:globalThis.crypto})
  const mod = new vm.SourceTextModule(await readFile(new URL('../desktop/plugin.js',import.meta.url),'utf8'), {context})
  await mod.link(name => {
    const exports = {'@hermes/plugin-sdk':sdk,react:React,'react/jsx-runtime':JSX}[name]
    if (!exports) throw Error(`Unsupported runtime import: ${name}`)
    return new vm.SyntheticModule(Object.keys(exports), function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v)}, {context})
  })
  await mod.evaluate()
  let response = async () => ({identities:[{id:'person:user',display_name:'User',enabled:true}]})
  const ctx = {storage:{get:(k,f)=>values.has(k)?values.get(k):f,set:(k,v)=>values.set(k,v)},rest:async (...args)=>{calls.push(args);return response(...args)}, register:c=>contributions.push(c),onDispose:fn=>disposers.push(fn),i18n:{register(){}}}
  return {module:mod.namespace,ctx,host,queryClient,contributions,calls,values,notifications,setResponse:fn=>{response=fn},dispose(){for(const fn of disposers)fn();queryClient.clear()}}
}
