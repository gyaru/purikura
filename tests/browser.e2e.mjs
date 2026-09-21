// Run explicitly: HERMES_SOURCE=... HERMES_PYTHON=... npm run test:browser
import {chromium,expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const source=process.env.HERMES_SOURCE
if(!source)throw Error('HERMES_SOURCE is required (real SDK components and assembled server)')
const output=resolve(process.env.PURIKURA_ARTIFACTS || 'artifacts')
await mkdir(output,{recursive:true})
const {build}=await import(pathToFileURL(resolve(source,'node_modules/vite/dist/node/index.js')))
const {default:tailwind}=await import(pathToFileURL(resolve(source,'node_modules/@tailwindcss/vite/dist/index.mjs')))
await build({configFile:false,root:resolve('.'),plugins:[{name:'harness-optional-media-css',enforce:'pre',transform(code,id){
  if(id===resolve(source,'apps/desktop/src/styles.css'))return code.replace(/^@import '(tw-shimmer|katex\/dist\/katex.min.css|@vscode\/codicons\/dist\/codicon.css)';$/gm,'').replace("@plugin '@tailwindcss/typography';",'')+`\n@source "${resolve(source,'apps/desktop/src/components/ui')}";`
}},tailwind()],resolve:{alias:{
  '@tabler/icons-react':resolve('node_modules/@tabler/icons-react'),
  '@hermes/plugin-sdk':resolve('tests/browser-sdk.mjs'),
  'desktop-button':resolve(source,'apps/desktop/src/components/ui/button.tsx'),
  'desktop-input':resolve(source,'apps/desktop/src/components/ui/input.tsx'),
  'desktop-styles':resolve(source,'apps/desktop/src/styles.css'),
  'desktop-palettes':resolve(source,'apps/shared/src/theme-presets.ts'),
  '@':resolve(source,'apps/desktop/src'),
  'react':resolve('node_modules/react'), 'react-dom':resolve('node_modules/react-dom'),
},dedupe:['react','react-dom']},build:{outDir:resolve(output,'desktop-build'),emptyOutDir:true,rollupOptions:{input:resolve('tests/browser-desktop.mjs'),output:{entryFileNames:'desktop.js',assetFileNames:'[name][extname]'}}}})
const server=spawn('uv',['run','--with','pytest','--with','httpx','python','tests/test_dashboard_http.py'],{env:process.env,stdio:['ignore','pipe','pipe']})
let logs='';server.stderr.on('data',d=>logs+=d)
let browser
try {
  const base=await new Promise((ok,no)=>{let out='';const timer=setTimeout(()=>no(Error(logs||'Server startup timed out')),60000);server.stdout.on('data',d=>{out+=d;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);ok(m[0])}});server.on('exit',()=>{clearTimeout(timer);no(Error(logs))})})
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/purikura?profile=default')
  await expect(page.getByLabel('People settings').getByRole('heading',{name:'People',exact:true})).toBeVisible()
  await expect(page.getByText('Shared roster · synced automatically')).toBeVisible()
  await page.getByLabel('New person name').fill('[invalid]')
  await expect(page.getByRole('button',{name:'Add person',exact:true})).toBeDisabled()
  await page.getByLabel('New person name').fill('Alice')
  const putFailure='**/api/plugins/purikura/identities/**'
  await page.route(putFailure,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Test outage'})}))
  await page.getByRole('button',{name:'Add person',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Save failed')
  await expect(page.getByLabel('New person name')).toHaveValue('Alice')
  await page.unroute(putFailure)
  await page.getByRole('button',{name:'Add person',exact:true}).click()
  await page.getByLabel('Edit Alice').click()
  await page.getByLabel(/^Name for/).fill('Bob')
  await page.getByRole('button',{name:'Save',exact:true}).click()
  await expect(page.getByLabel('Edit Bob')).toBeVisible()
  const readState=()=>page.evaluate(async()=>{const r=await fetch('/api/plugins/purikura/state',{headers:{'X-Hermes-Session-Token':'isolated-test-token'}});return r.json()})
  expect((await readState()).identities.some(p=>p.display_name==='Bob')).toBeTruthy()
  await page.screenshot({path:resolve(output,'dashboard-desktop.png'),fullPage:true})
  await page.reload();await expect(page.getByLabel('Edit Bob')).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:resolve(output,'dashboard-mobile.png'),fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
  // Route only the harness document/assets. Backend calls remain real HTTP.
  const assets=await readdir(resolve(output,'desktop-build'))
  const css=assets.filter(x=>x.endsWith('.css'))
  await page.route('**/native-harness',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head>${css.map(x=>`<link rel="stylesheet" href="/native-assets/${x}">`).join('')}</head><body><div id="root"></div><script type="module" src="/native-assets/desktop.js"></script></body></html>`}))
  await page.route('**/native-assets/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').pop();await r.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream',body:await readFile(resolve(output,'desktop-build',name))})})
  await page.setViewportSize({width:1280,height:800});await page.goto(base+'/native-harness')
  await expect(page.getByLabel('Edit Bob')).toBeVisible()
  await page.getByLabel('New person name').fill('Alice')
  await page.getByRole('button',{name:'Create person'}).click()
  await page.getByLabel('Edit Alice').click()
  await page.getByLabel(/^Name for/).fill('Alice Updated')
  await page.getByRole('button',{name:/^Rename person:/}).click()
  await expect(page.getByLabel('Edit Alice Updated')).toBeVisible()
  const state=await readState();expect(state.identities.some(p=>p.display_name==='Alice Updated')).toBeTruthy()
  const alice=state.identities.find(p=>p.display_name==='Alice Updated')
  await page.getByLabel('Active person').selectOption(alice.id)
  await expect(page.getByText('Active on this device')).toBeVisible()
  await expect(page.getByRole('contentinfo',{name:'Status bar'}).getByRole('button')).toHaveCount(0)
  expect((await page.getByLabel('Active person').boundingBox()).width).toBeLessThanOrEqual(160)
  await page.screenshot({path:resolve(output,'desktop-light.png'),fullPage:true})
  await page.evaluate(()=>window.applyTestPalette('dark'))
  await page.screenshot({path:resolve(output,'desktop-dark.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  expect((await page.getByLabel('People settings').getByText('Alice Updated',{exact:true}).boundingBox()).width).toBeGreaterThanOrEqual(100)
  await page.screenshot({path:resolve(output,'desktop-mobile.png'),fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
  await writeFile(resolve(output,'result.json'),JSON.stringify({passed:true,errors,surfaces:['real web dashboard','Desktop React/SDK UI browser harness (not Electron)'],checks:['create/rename HTTP persistence on both surfaces','direct URL + reload','compact status bar','mobile overflow','light/dark']},null,2))
  console.log('PASS: both surfaces create/rename through actual Hermes HTTP; screenshots:',output)
} finally {await browser?.close();server.kill('SIGINT')}
