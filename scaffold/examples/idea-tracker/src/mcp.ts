import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { tools } from './tools.js'

const DATA_DIR = process.env.IDEA_TRACKER_DATA || join(process.env.HOME || '.', '.idea-tracker/data')

// ── File storage (same as serve.ts) ────────────────────────────────

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

// ── Convert JSON Schema property to Zod ────────────────────────────

function jsonPropToZod(prop: { type: string; description?: string; enum?: string[] }): z.ZodTypeAny {
  let schema: z.ZodTypeAny
  if (prop.enum) {
    schema = z.enum(prop.enum as [string, ...string[]])
  } else {
    schema = z.string()
  }
  if (prop.description) {
    schema = schema.describe(prop.description)
  }
  return schema
}

function buildZodShape(tool: typeof tools[number]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(tool.inputSchema.required || [])

  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    const zodProp = jsonPropToZod(prop)
    shape[key] = required.has(key) ? zodProp : zodProp.optional()
  }
  return shape
}

// ── MCP server ─────────────────────────────────────────────────────

const server = new McpServer({
  name: 'idea-tracker',
  version: '1.0.0',
})

const ctx = { userId: 'default', storage }

for (const tool of tools) {
  const zodShape = buildZodShape(tool)

  server.tool(
    tool.name,
    tool.description,
    zodShape,
    async (params) => {
      const result = await tool.handler(params, ctx)
      return { content: result.content, isError: result.isError }
    },
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
