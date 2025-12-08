import type { ChildProcess } from 'node:child_process'
import { exec, spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

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
    content = content.replace(/const version = ref\('[^']+'\)/, `const version = ref('${version}')`)
    writeFileSync(path, content)
  }
}

export async function build(fixtureDir: string, deploymentId: string) {
  await execAsync(`pnpm build`, {
    cwd: fixtureDir,
    env: { ...process.env, NUXT_DEPLOYMENT_ID: deploymentId },
  })
}

export function startServer(fixtureDir: string, port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['.output/server/index.mjs'], {
      cwd: fixtureDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
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
  return new Promise((resolve) => {
    proc.on('exit', () => resolve())
    proc.kill('SIGTERM')
    setTimeout(() => {
      proc.kill('SIGKILL')
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
