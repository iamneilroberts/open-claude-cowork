// ── Types ───────────────────────────────────────────────────────────

interface ScaffoldTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
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

interface Idea {
  id: string
  title: string
  description: string
  project: string
  tags: string[]
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'new' | 'considering' | 'planned' | 'in-progress' | 'done' | 'shelved'
  createdAt: string
  updatedAt: string
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeId(): string {
  return `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function err(msg: string): ToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true }
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

// ── Tools ───────────────────────────────────────────────────────────

const save: ScaffoldTool = {
  name: 'ideas_save',
  description: 'Save a new app or feature idea. Provide a title, description, and which project it belongs to. Optionally add tags and priority.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the idea' },
      description: { type: 'string', description: 'Detailed description of the idea' },
      project: { type: 'string', description: 'Project this idea belongs to (e.g., "clawd", "scaffold", "voygent")' },
      tags: { type: 'string', description: 'Comma-separated tags (e.g., "ux,performance,mvp")' },
      priority: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high', 'critical'] },
    },
    required: ['title', 'project'],
  },
  handler: async (input, ctx) => {
    const { title, description, project, tags, priority } = input

    if (!title?.trim()) return err('Error: Title is required.')
    if (!project?.trim()) return err('Error: Project is required.')

    const id = makeId()
    const idea: Idea = {
      id,
      title: title.trim(),
      description: description?.trim() || '',
      project: project.trim().toLowerCase(),
      tags: tags ? tags.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean) : [],
      priority: priority || 'medium',
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await ctx.storage.put(`${ctx.userId}/ideas/${id}`, idea)

    return ok(`Saved idea "${idea.title}" for project ${idea.project} (ID: ${id})`)
  },
}

const list: ScaffoldTool = {
  name: 'ideas_list',
  description: 'List saved ideas. Optionally filter by project, status, or priority.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Filter by project name' },
      status: { type: 'string', description: 'Filter by status', enum: ['new', 'considering', 'planned', 'in-progress', 'done', 'shelved'] },
      priority: { type: 'string', description: 'Filter by priority', enum: ['low', 'medium', 'high', 'critical'] },
    },
  },
  handler: async (input, ctx) => {
    const entries = await ctx.storage.list({ prefix: `${ctx.userId}/ideas/` })
    let ideas = Array.from(entries.values()) as Idea[]

    if (input.project) {
      ideas = ideas.filter(i => i.project === input.project.trim().toLowerCase())
    }
    if (input.status) {
      ideas = ideas.filter(i => i.status === input.status)
    }
    if (input.priority) {
      ideas = ideas.filter(i => i.priority === input.priority)
    }

    ideas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    if (ideas.length === 0) {
      return ok('No ideas found matching your filters.')
    }

    const lines = ideas.map(i => {
      const tags = i.tags.length ? ` [${i.tags.join(', ')}]` : ''
      return `- **${i.title}** (${i.project}) — ${i.status}, ${i.priority} priority${tags}\n  ID: ${i.id}`
    })

    return ok(`Found ${ideas.length} idea(s):\n\n${lines.join('\n\n')}`)
  },
}

const get: ScaffoldTool = {
  name: 'ideas_get',
  description: 'Get full details of a specific idea by its ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The idea ID' },
    },
    required: ['id'],
  },
  handler: async (input, ctx) => {
    if (!input.id?.trim()) return err('Error: ID is required.')

    const idea = await ctx.storage.get(`${ctx.userId}/ideas/${input.id.trim()}`) as Idea | null
    if (!idea) return err(`Error: Idea "${input.id}" not found.`)

    const tags = idea.tags.length ? idea.tags.join(', ') : 'none'
    return ok([
      `**${idea.title}**`,
      `Project: ${idea.project}`,
      `Status: ${idea.status} | Priority: ${idea.priority}`,
      `Tags: ${tags}`,
      `Created: ${idea.createdAt}`,
      `Updated: ${idea.updatedAt}`,
      '',
      idea.description || '(no description)',
    ].join('\n'))
  },
}

const whatsNext: ScaffoldTool = {
  name: 'ideas_whats-next',
  description: 'Get prioritized suggestions for what to work on next in a project. Returns the highest-priority, non-done ideas.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Project to get suggestions for' },
      count: { type: 'string', description: 'Number of suggestions to return (default: 3)' },
    },
    required: ['project'],
  },
  handler: async (input, ctx) => {
    if (!input.project?.trim()) return err('Error: Project is required.')

    const project = input.project.trim().toLowerCase()
    const count = parseInt(input.count || '3', 10)

    const entries = await ctx.storage.list({ prefix: `${ctx.userId}/ideas/` })
    let ideas = (Array.from(entries.values()) as Idea[])
      .filter(i => i.project === project)
      .filter(i => i.status !== 'done' && i.status !== 'shelved')

    if (ideas.length === 0) {
      return ok(`No actionable ideas for project "${project}". Everything is done or shelved.`)
    }

    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const statusOrder: Record<string, number> = { 'in-progress': 0, planned: 1, considering: 2, 'new': 3 }

    ideas.sort((a, b) => {
      const pd = (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
      if (pd !== 0) return pd
      return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)
    })

    const top = ideas.slice(0, count)
    const lines = top.map((i, idx) => {
      return `${idx + 1}. **${i.title}** — ${i.priority} priority, ${i.status}\n   ${i.description || '(no description)'}\n   ID: ${i.id}`
    })

    return ok(`What's next for **${project}** (${ideas.length} actionable idea${ideas.length === 1 ? '' : 's'}):\n\n${lines.join('\n\n')}`)
  },
}

const search: ScaffoldTool = {
  name: 'ideas_search',
  description: 'Search ideas by keyword across titles, descriptions, and tags.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search keyword or phrase' },
      project: { type: 'string', description: 'Optionally limit search to a specific project' },
    },
    required: ['query'],
  },
  handler: async (input, ctx) => {
    if (!input.query?.trim()) return err('Error: Query is required.')

    const q = input.query.trim().toLowerCase()
    const entries = await ctx.storage.list({ prefix: `${ctx.userId}/ideas/` })
    let ideas = Array.from(entries.values()) as Idea[]

    if (input.project) {
      ideas = ideas.filter(i => i.project === input.project.trim().toLowerCase())
    }

    const matches = ideas.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.tags.some(t => t.includes(q))
    )

    if (matches.length === 0) {
      return ok(`No ideas matching "${input.query}".`)
    }

    const lines = matches.map(i => {
      return `- **${i.title}** (${i.project}) — ${i.status}, ${i.priority}\n  ID: ${i.id}`
    })

    return ok(`Found ${matches.length} idea(s) matching "${input.query}":\n\n${lines.join('\n\n')}`)
  },
}

const update: ScaffoldTool = {
  name: 'ideas_update',
  description: 'Update an existing idea. Change its title, description, status, priority, tags, or project.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The idea ID to update' },
      title: { type: 'string', description: 'New title' },
      description: { type: 'string', description: 'New description' },
      project: { type: 'string', description: 'Move to a different project' },
      status: { type: 'string', description: 'New status', enum: ['new', 'considering', 'planned', 'in-progress', 'done', 'shelved'] },
      priority: { type: 'string', description: 'New priority', enum: ['low', 'medium', 'high', 'critical'] },
      tags: { type: 'string', description: 'Replace tags (comma-separated)' },
    },
    required: ['id'],
  },
  handler: async (input, ctx) => {
    if (!input.id?.trim()) return err('Error: ID is required.')

    const key = `${ctx.userId}/ideas/${input.id.trim()}`
    const idea = await ctx.storage.get(key) as Idea | null
    if (!idea) return err(`Error: Idea "${input.id}" not found.`)

    if (input.title?.trim()) idea.title = input.title.trim()
    if (input.description !== undefined) idea.description = input.description.trim()
    if (input.project?.trim()) idea.project = input.project.trim().toLowerCase()
    if (input.status) idea.status = input.status
    if (input.priority) idea.priority = input.priority
    if (input.tags !== undefined) {
      idea.tags = input.tags ? input.tags.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean) : []
    }
    idea.updatedAt = new Date().toISOString()

    await ctx.storage.put(key, idea)

    return ok(`Updated idea "${idea.title}" (${idea.status}, ${idea.priority} priority)`)
  },
}

const del: ScaffoldTool = {
  name: 'ideas_delete',
  description: 'Delete an idea by its ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The idea ID to delete' },
    },
    required: ['id'],
  },
  handler: async (input, ctx) => {
    if (!input.id?.trim()) return err('Error: ID is required.')

    const key = `${ctx.userId}/ideas/${input.id.trim()}`
    const idea = await ctx.storage.get(key) as Idea | null
    if (!idea) return err(`Error: Idea "${input.id}" not found.`)

    await ctx.storage.delete(key)

    return ok(`Deleted idea "${idea.title}" (${idea.id})`)
  },
}

// ── Exports ─────────────────────────────────────────────────────────

export const tools: ScaffoldTool[] = [save, list, get, whatsNext, search, update, del]
