import React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClientProvider} from '@tanstack/react-query'
import {queryClient} from './browser-sdk.mjs'
import plugin from '../desktop/plugin.js'
import 'desktop-styles'
import {THEME_PRESET_PALETTES} from 'desktop-palettes'
// Reproduce host seed application using its shipped palette, not invented colors.
window.applyTestPalette=mode=>{
  const root=document.documentElement,c=THEME_PRESET_PALETTES.nous[mode==='dark'?'darkColors':'colors']
  root.classList.toggle('dark',mode==='dark');root.style.colorScheme=mode
  const seeds={foreground:c.foreground,primary:c.primary,secondary:c.secondary,'accent-soft':c.accent,
    midground:c.midground||c.ring,warm:c.primary,'background-seed':c.background,'sidebar-seed':c.sidebarBackground||c.background,
    'card-seed':c.card,'elevated-seed':c.popover,'bubble-seed':c.userBubble||c.popover}
  for(const [key,value]of Object.entries(seeds))root.style.setProperty('--theme-'+key,value)
  for(const key of ['primaryForeground','secondaryForeground','accentForeground','border','input','ring','muted'])root.style.setProperty('--dt-'+key.replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),c[key])
}
window.applyTestPalette('light')
const contributions=[]
plugin.register({register:c=>contributions.push(c),onDispose(){},storage:{get:(k,f)=>localStorage.getItem(k)||f,set:(k,v)=>localStorage.setItem(k,v)},rest:async(path,opts={})=>{
  const r=await fetch('/api/plugins/purikura'+path,{method:opts.method||'GET',headers:{'X-Hermes-Session-Token':'isolated-test-token','Content-Type':'application/json'},body:opts.body?JSON.stringify(opts.body):undefined})
  if(!r.ok)throw Error(`HTTP ${r.status}`)
  return r.json()
}})
createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,{client:queryClient},
  React.createElement('main',null,contributions.find(c=>c.area==='routes').render()),
  React.createElement('footer',{'aria-label':'Status bar',style:{position:'fixed',bottom:0,left:0,right:0,height:26,display:'flex',justifyContent:'flex-end',alignItems:'center',borderTop:'1px solid var(--ui-stroke-secondary)',paddingRight:12}},contributions.find(c=>c.area==='statusBar.right').render())))
