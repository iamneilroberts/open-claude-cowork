# Build Instructions — Scaffold App Generator

You are generating a complete, working MCP tool app that runs locally with Node.js.

## Architecture

A Scaffold app is a Node.js server that exposes MCP (Model Context Protocol) tools over HTTP. It uses file-based JSON storage on disk — no cloud services, no external databases.

### Tool Interface

Each tool follows this pattern:

```typescript
interface ScaffoldTool {
  name: string           // Format: "appname:action" (e.g., "notes:create")
  description: string    // Clear description for LLM consumption
  inputSchema: {         // JSON Schema for tool parameters
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
  handler: (input: any, ctx: ToolContext) => Promise<ToolResult>
}

interface ToolContext {
  userId: string
  storage: {
    get: (key: string) => Promise<any>
    put: (key: string, value: any) => Promise<void>
    list: (options?: { prefix?: string }) => Promise<Map<string, any>>
    delete: (key: string) => Promise<boolean>
  }
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}
```

### Data Isolation

CRITICAL: Always prefix storage keys with the userId to ensure data isolation:

```typescript
const key = `${ctx.userId}/items/${itemId}`
await ctx.storage.put(key, data)
```

### Example Tool (from notes-app)

```typescript
export const createNote: ScaffoldTool = {
  name: 'notes:create',
  description: 'Create a new note with a title and content',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title' },
      content: { type: 'string', description: 'Note content/body' }
    },
    required: ['title', 'content']
  },
  handler: async (input, ctx) => {
    const { title, content } = input

    if (!title?.trim()) {
      return {
        content: [{ type: 'text', text: 'Error: Title is required and cannot be empty.' }],
        isError: true
      }
    }

    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const note = {
      id,
      title: title.trim(),
      content: content?.trim() || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    await ctx.storage.put(`${ctx.userId}/notes/${id}`, note)

    return {
      content: [{ type: 'text', text: `Created note "${note.title}" (ID: ${id})` }]
    }
  }
}
```

## Coding Standards

1. **Input validation**: Validate all required fields, return clear error messages with `isError: true`
2. **ID generation**: Use `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
3. **Timestamps**: Always include `createdAt` and `updatedAt` on stored records
4. **Tool naming**: Use `appname:action` format — verbs like create, list, get, update, delete, search
5. **Descriptions**: Write tool descriptions as instructions to an LLM: "Create a new X with Y and Z"
6. **List operations**: Support optional search/filter parameters, return count in response
7. **Delete operations**: Return confirmation of what was deleted, handle "not found" gracefully
8. **Error handling**: Never throw — always return a ToolResult with `isError: true`

## File Structure

```
scaffold/examples/<app-name>/
  package.json
  tsconfig.json
  src/
    serve.ts         # Local server entry point (file storage + HTTP)
    tools.ts         # All tool implementations
    __tests__/
      tools.test.ts  # Vitest tests for all tools
```

## Local Server Entry Point (src/serve.ts)

The serve.ts file is a self-contained local server. It includes an inline file storage adapter so the app has zero framework dependencies — just Node.js stdlib.

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { tools } from './tools.js'

const PORT = parseInt(process.env.PORT || '3001', 10)
const DATA_DIR = '.scaffold/data'

// ── Inline file-based storage ──────────────────────────────────────
// Each key maps to a JSON file on disk. Keys like "user1/notes/abc"
// become "<DATA_DIR>/user1/notes/abc.json".

function keyToPath(key: string): string {
  // Prevent path traversal
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
  }
}

// ── HTTP server ────────────────────────────────────────────────────
// POST /tool/:toolName — invoke a tool
// GET  /tools          — list available tools

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

  // Default: 404
  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found. GET /tools or POST /tool/:name' }))
})

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  console.log(`Tools: GET http://localhost:${PORT}/tools`)
  console.log(`Invoke: POST http://localhost:${PORT}/tool/<name>`)
})
```

## Test Pattern

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

// Create a mock storage
function createMockContext(userId = 'test-user') {
  const store = new Map()
  return {
    userId,
    storage: {
      get: async (key) => store.get(key) ?? null,
      put: async (key, value) => { store.set(key, value) },
      list: async (opts) => {
        const prefix = opts?.prefix || ''
        const result = new Map()
        for (const [k, v] of store) {
          if (k.startsWith(prefix)) result.set(k, v)
        }
        return result
      },
      delete: async (key) => store.delete(key)
    }
  }
}
```

## Target

Build 4-7 tools that cover the full CRUD lifecycle for the app idea. Ensure each tool works independently and the full workflow is coherent.

## Cloud Migration (optional)

When ready to deploy to the cloud, you can migrate to Cloudflare Workers:

1. Add `wrangler` and `@cloudflare/workers-types` as devDependencies
2. Create a `wrangler.toml` with a `durable_objects` binding named `STORAGE`
3. Create `src/index.ts` that exports a Worker fetch handler using Cloudflare KV or Durable Objects for storage
4. The tool implementations (`tools.ts`) stay identical — only the storage adapter changes
