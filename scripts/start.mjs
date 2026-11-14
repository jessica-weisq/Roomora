// One-step launcher, run by start.bat (Windows) and start.command (Mac).
// Installs or updates the libraries when needed, then starts the app and opens it in the browser.
// Uses only Node's built-in modules, so it works before `npm install` has ever run.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'
// On Windows, .cmd files must be run through the shell.
const run = (args, opts = {}) => spawnSync(npm, args, { stdio: 'inherit', shell: isWin, ...opts })

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// 1. Node version (Vite needs 20.19+ or 22.12+)
const [major, minor] = process.versions.node.split('.').map(Number)
const okNode = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22
if (!okNode) {
  fail(`This project needs a newer Node.js (you have ${process.versions.node}). Install the LTS version from https://nodejs.org and try again.`)
}

// 2. Install libraries if they're missing or package-lock.json has changed since the last install
const lockHash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex')
const stampFile = join('node_modules', '.install-stamp')
const installed = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : ''
if (!existsSync('node_modules') || installed !== lockHash) {
  console.log('\nInstalling libraries. The first time takes a minute or two...\n')
  const result = run(['install', '--no-audit', '--no-fund'])
  if (result.status !== 0) fail('npm install failed. The messages above say why.')
  writeFileSync(stampFile, lockHash)
} else {
  console.log('Libraries are up to date.')
}

// 3. Backend
// - If .env or .env.local sets VITE_API_URL (the deployed Modal URL), just use that.
// - Otherwise, if the Modal CLI is installed, run the backend with `modal serve` and point the
//   frontend at the temporary URL it prints.
// - Otherwise, use the frontend's built-in mock backend.
const env = { ...process.env }
const children = []
const envFiles = ['.env', '.env.local'].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : '')).join('\n')
const configured = /^\s*VITE_API_URL\s*=\s*\S+/m.test(envFiles) || !!process.env.VITE_API_URL

function findModal() {
  const candidates = isWin ? [['modal'], ['py', '-m', 'modal'], ['python', '-m', 'modal']] : [['modal'], ['python3', '-m', 'modal']]
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '--version'], { shell: isWin, stdio: 'ignore' })
    if (r.status === 0) return [cmd, pre]
  }
  return null
}

async function startBackend() {
  if (!existsSync(join('backend', 'app.py'))) {
    console.log('No backend folder, so the app is using its mock backend.')
    return
  }
  if (configured) {
    console.log('Using the deployed backend (VITE_API_URL in .env / .env.local).')
    return
  }
  const modal = findModal()
  if (!modal) {
    console.log('Modal isn\'t installed, so the app is using its mock backend.')
    console.log('To run the real backend: pip install modal, then modal setup (see backend/README.md).')
    return
  }
  const [cmd, pre] = modal
  console.log('\nStarting the backend on Modal. The first time builds the GPU image, which can take 10–20 minutes...\n')
  const proc = spawn(cmd, [...pre, 'serve', join('backend', 'app.py')], { shell: isWin, env })
  children.push(proc)
  const url = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 30 * 60 * 1000)
    const onData = (buf) => {
      const text = buf.toString()
      process.stdout.write(text.replace(/^(?=.)/gm, '[backend] '))
      const m = text.match(/https:\/\/[^\s'"]+\.modal\.run/)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
  if (url) {
    console.log(`\nBackend running at ${url}\n`)
    env.VITE_USE_MOCK = 'false'
    env.VITE_API_URL = url
  } else {
    console.log('\nThe backend didn\'t start (see the [backend] messages above), so the app is using its mock backend.')
    console.log('Common fixes: run `modal setup` to log in, or create the secret: modal secret create photos-to-3d GEMINI_API_KEY=...\n')
  }
}

await startBackend()

// 4. Frontend: start Vite and open the browser
console.log('\nStarting the app. Close this window (or press Ctrl+C) to stop it.\n')
const dev = spawn(npm, ['run', 'dev', '--', '--open'], { stdio: 'inherit', shell: isWin, env })
children.push(dev)
const stopAll = (code = 0) => {
  for (const c of children) if (!c.killed) c.kill()
  process.exit(code)
}
dev.on('exit', (code) => stopAll(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stopAll(0))
