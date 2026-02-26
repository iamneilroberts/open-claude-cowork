import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { tools } from './tools.js'

const PORT = parseInt(process.env.PORT || '3001', 10)
const DATA_DIR = '.scaffold/data'

// ── Inline file-based storage ──────────────────────────────────────

function keyToPath(key: string): string {
  const safe = key.replace(/\.\./g, '').replace(/^\/+/, '')
  return join(DATA_DIR, `${safe}.json`)
}

const storage = {
  async get(key: string): Promise<any> {
    try {
      const raw = await readFile(keyToPath(key), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  },

  async put(key: string, value: any): Promise<void> {
    const filePath = keyToPath(key)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(value, null, 2))
  },

  async list(options?: { prefix?: string }): Promise<Map<string, any>> {
    const prefix = options?.prefix || ''
    const result = new Map<string, any>()
    const baseDir = join(DATA_DIR, prefix.replace(/\.\./g, ''))

    async function walk(dir: string): Promise<void> {
      if (!existsSync(dir)) return
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.name.endsWith('.json')) {
          const key = full
            .replace(DATA_DIR + '/', '')
            .replace(/\.json$/, '')
          if (key.startsWith(prefix)) {
            try {
              const raw = await readFile(full, 'utf-8')
              result.set(key, JSON.parse(raw))
            } catch { /* skip corrupt files */ }
          }
        }
      }
    }

    await walk(baseDir || DATA_DIR)
    return result
  },

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(keyToPath(key))
      return true
    } catch {
      return false
    }
  },
}

// ── HTTP server ────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  res.setHeader('Content-Type', 'application/json')

  // List tools
  if (req.method === 'GET' && url.pathname === '/tools') {
    const toolList = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
    res.writeHead(200)
    res.end(JSON.stringify(toolList, null, 2))
    return
  }

  // Invoke a tool
  if (req.method === 'POST' && url.pathname.startsWith('/tool/')) {
    const toolName = url.pathname.slice('/tool/'.length)
    const tool = tools.find(t => t.name === toolName)
    if (!tool) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: `Tool "${toolName}" not found` }))
      return
    }

    try {
      const body = await readBody(req)
      const input = body ? JSON.parse(body) : {}
      const userId = req.headers['x-user-id']?.toString() || 'default'
      const ctx = { userId, storage }
      const result = await tool.handler(input, ctx)
      res.writeHead(result.isError ? 400 : 200)
      res.end(JSON.stringify(result))
    } catch (err: any) {
      res.writeHead(500)
      res.end(JSON.stringify({
        content: [{ type: 'text', text: `Server error: ${err.message}` }],
        isError: true,
      }))
    }
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found. GET /tools or POST /tool/:name' }))
})

server.listen(PORT, () => {
  console.log(`Idea Tracker running at http://localhost:${PORT}`)
  console.log(`Tools: GET http://localhost:${PORT}/tools`)
  console.log(`Invoke: POST http://localhost:${PORT}/tool/<name>`)
})
