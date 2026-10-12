#!/usr/bin/env node
// One-time development setup: backend virtualenv + dependencies, frontend
// dependencies, and database migrations. Safe to re-run.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = join(root, 'backend')
const isWin = process.platform === 'win32'

function run(cmd, args, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  // Bare command names (npm, py) need a shell on Windows. Absolute paths must not use one.
  const shell = isWin && !/[\\/]/.test(cmd)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell })
  if (r.status !== 0) {
    console.error(`\nSetup failed at: ${cmd} ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

function findPython() {
  for (const candidate of isWin ? ['py', 'python'] : ['python3.11', 'python3', 'python']) {
    const r = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info >= (3, 11))'], {
      encoding: 'utf8',
      shell: isWin,
    })
    if (r.status === 0 && r.stdout.trim() === 'True') return candidate
  }
  console.error('Python 3.11+ is required but was not found on PATH.')
  process.exit(1)
}

if (!existsSync(join(root, '.env'))) {
  copyFileSync(join(root, '.env.example'), join(root, '.env'))
  console.log('Created .env from .env.example')
}

if (!existsSync(join(backend, '.venv'))) run(findPython(), ['-m', 'venv', '.venv'], backend)
const py = isWin ? join(backend, '.venv', 'Scripts', 'python.exe') : join(backend, '.venv', 'bin', 'python')
run(py, ['-m', 'pip', 'install', '--upgrade', 'pip'], backend)
run(py, ['-m', 'pip', 'install', '-r', 'requirements-dev.txt'], backend)
run(py, ['-m', 'alembic', 'upgrade', 'head'], backend)

run('npm', ['install'], join(root, 'frontend'))

console.log('\nSetup complete. Start everything with: npm run dev')
