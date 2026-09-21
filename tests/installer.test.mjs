// Optional integration: run actual Electron installer helpers, without Electron/UI.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { readFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
test('real Hermes detects both halves and installs Desktop from root Git URL', {skip: !process.env.HERMES_SOURCE}, async () => {
  const context = vm.createContext({console, process, Buffer, setTimeout, clearTimeout})
  async function load(filename) {
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(await readFile(filename, 'utf8')), {context})
    await mod.link(async specifier => {
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(filename), specifier + '.ts'))
      const exports = await import(specifier)
      return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key,value] of Object.entries(exports)) this.setExport(key,value)
      }, {context})
    })
    return mod
  }
  const mod = await load(path.join(process.env.HERMES_SOURCE, 'apps/desktop/electron/desktop-plugin-install.ts'))
  await mod.evaluate()
  const detected = await mod.namespace.detectPluginComponents(root)
  assert.equal(detected.agent, true)
  assert.equal(detected.desktop, true)
  assert.equal(detected.agentName, 'purikura')
  assert.equal(detected.desktopSourceSubdir, 'desktop')
  const temp = await mkdtemp(path.join(os.tmpdir(), 'purikura-desktop-test-'))
  try {
    const repo = path.join(temp, 'purikura')
    await mkdir(repo)
    for (const entry of ['plugin.yaml','__init__.py','desktop','dashboard']) {
      await cp(path.join(root,entry), path.join(repo,entry), {recursive:true})
    }
    const git = (...args) => execFileSync('git', ['-C',repo,...args], {stdio:'pipe'})
    git('init','-q'); git('add','.')
    git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture')
    const url = pathToFileURL(repo).href
    const probe = await mod.namespace.probePluginRepo('git', url)
    assert.equal(probe.ok, true, probe.error)
    assert.equal(probe.agent, true)
    assert.equal(probe.desktop, true)
    const destination = path.join(temp, 'client/desktop-plugins')
    const installed = await mod.namespace.installDesktopPluginFromGit('git', url, destination, false)
    assert.equal(installed.ok, true, installed.error)
    assert.equal(installed.pluginName, 'purikura')
    assert.equal(await readFile(path.join(installed.path,'plugin.js'),'utf8'), await readFile(path.join(root,'desktop/plugin.js'),'utf8'))
    assert.equal(existsSync(path.join(temp,'client/plugins')), false)
    assert.equal(existsSync(path.join(installed.path,'dashboard')), false)
  } finally { await rm(temp, {recursive:true,force:true}) }
})
