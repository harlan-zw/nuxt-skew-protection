import type { ChildProcess } from 'node:child_process'
import { exec, spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const RE_VERSION_REF = /const version = ref\('[^']+'\)/

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function cleanFixture(fixtureDir: string) {
  rmSync(join(fixtureDir, '.skew-storage'), { recursive: true, force: true })
  rmSync(join(fixtureDir, '.output'), { recursive: true, force: true })
  rmSync(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
}

export function modifyVersion(fixtureDir: string, version: string, pages = ['index', 'about']) {
  for (const page of pages) {
    const path = join(fixtureDir, `pages/${page}.vue`)
    let content = readFileSync(path, 'utf-8')
    content = content.replace(RE_VERSION_REF, `const version = ref('${version}')`)
    writeFileSync(path, content)
  }
}

export async function build(fixtureDir: string, deploymentId: string) {
  try {
    await execAsync(`pnpm build`, {
      cwd: fixtureDir,
      env: { ...process.env, NUXT_DEPLOYMENT_ID: deploymentId },
    })
  }
  catch (err: any) {
    const message = err.stderr || err.stdout || err.message
    throw new Error(`Fixture build failed in ${fixtureDir}:\n${message}`)
  }
}

export function startServer(fixtureDir: string, port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['.output/server/index.mjs'], {
      cwd: fixtureDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: `node` may be a shell wrapper, so stopServer must
      // signal the whole group or the real server keeps the port.
      detached: true,
    })

    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 30000)

    proc.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('Listening')) {
        clearTimeout(timeout)
        resolve(proc)
      }
    })

    proc.on('error', (e) => {
      clearTimeout(timeout)
      reject(e)
    })

    // Fallback resolve after 5s
    setTimeout(() => {
      clearTimeout(timeout)
      resolve(proc)
    }, 5000)
  })
}

export function stopServer(proc: ChildProcess): Promise<void> {
  const signalGroup = (signal: NodeJS.Signals) => {
    if (proc.pid === undefined)
      return
    try {
      process.kill(-proc.pid, signal)
    }
    catch (err) {
      // ESRCH: the group already exited, which is the goal.
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH')
        throw err
    }
  }
  return new Promise((resolve) => {
    proc.on('exit', () => resolve())
    signalGroup('SIGTERM')
    setTimeout(() => {
      signalGroup('SIGKILL')
      resolve()
    }, 3000)
  })
}

export function updateLatestBuild(fixtureDir: string, newBuildId: string) {
  const latestPath = join(fixtureDir, '.output/public/_nuxt/builds/latest.json')
  const content = JSON.parse(readFileSync(latestPath, 'utf-8'))
  content.id = newBuildId
  content.timestamp = Date.now()
  writeFileSync(latestPath, JSON.stringify(content))
}
