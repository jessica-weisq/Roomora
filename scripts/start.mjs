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
// When backend/app.py exists, start it here (e.g. `modal serve backend/app.py`) and pass its
// URL to the frontend through process.env.VITE_API_URL + VITE_USE_MOCK=false.
// Until then the frontend uses its built-in mock backend.
const env = { ...process.env }
if (!existsSync(join('backend', 'app.py'))) {
  console.log('No backend yet, so the app is using its mock backend.')
}

// 4. Frontend: start Vite and open the browser
console.log('\nStarting the app. Close this window (or press Ctrl+C) to stop it.\n')
const dev = spawn(npm, ['run', 'dev', '--', '--open'], { stdio: 'inherit', shell: isWin, env })
dev.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => dev.kill(sig))
