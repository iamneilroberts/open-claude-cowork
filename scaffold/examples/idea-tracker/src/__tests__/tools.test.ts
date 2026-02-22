import { describe, it, expect, beforeEach } from 'vitest'
import { tools } from '../tools.js'

// ── Mock storage context ────────────────────────────────────────────

function createMockContext(userId = 'test-user') {
  const store = new Map<string, any>()
  return {
    userId,
    storage: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: any) => { store.set(key, value) },
      list: async (opts?: { prefix?: string }) => {
        const prefix = opts?.prefix || ''
        const result = new Map<string, any>()
        for (const [k, v] of store) {
          if (k.startsWith(prefix)) result.set(k, v)
        }
        return result
      },
      delete: async (key: string) => store.delete(key),
    },
  }
}

function findTool(name: string) {
  const tool = tools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

function getText(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ideas_save', () => {
  it('saves an idea with required fields', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_save').handler(
      { title: 'Dark mode', project: 'clawd' },
      ctx,
    )
    expect(result.isError).toBeUndefined()
    expect(getText(result)).toContain('Saved idea "Dark mode"')
    expect(getText(result)).toContain('clawd')
  })

  it('saves with all optional fields', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_save').handler(
      { title: 'API caching', project: 'scaffold', description: 'Cache GET responses', tags: 'perf,backend', priority: 'high' },
      ctx,
    )
    expect(result.isError).toBeUndefined()
    expect(getText(result)).toContain('API caching')
  })

  it('rejects empty title', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_save').handler(
      { title: '', project: 'test' },
      ctx,
    )
    expect(result.isError).toBe(true)
  })

  it('rejects missing project', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_save').handler(
      { title: 'Something' },
      ctx,
    )
    expect(result.isError).toBe(true)
  })
})

describe('ideas_list', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(async () => {
    ctx = createMockContext()
    await findTool('ideas_save').handler({ title: 'Idea A', project: 'alpha', priority: 'high' }, ctx)
    await findTool('ideas_save').handler({ title: 'Idea B', project: 'beta', priority: 'low' }, ctx)
    await findTool('ideas_save').handler({ title: 'Idea C', project: 'alpha', priority: 'medium' }, ctx)
  })

  it('lists all ideas', async () => {
    const result = await findTool('ideas_list').handler({}, ctx)
    expect(getText(result)).toContain('3 idea(s)')
  })

  it('filters by project', async () => {
    const result = await findTool('ideas_list').handler({ project: 'alpha' }, ctx)
    expect(getText(result)).toContain('2 idea(s)')
    expect(getText(result)).toContain('Idea A')
    expect(getText(result)).toContain('Idea C')
    expect(getText(result)).not.toContain('Idea B')
  })

  it('filters by priority', async () => {
    const result = await findTool('ideas_list').handler({ priority: 'high' }, ctx)
    expect(getText(result)).toContain('1 idea(s)')
    expect(getText(result)).toContain('Idea A')
  })

  it('returns message when no results', async () => {
    const result = await findTool('ideas_list').handler({ project: 'nonexistent' }, ctx)
    expect(getText(result)).toContain('No ideas found')
  })
})

describe('ideas_get', () => {
  it('retrieves a saved idea', async () => {
    const ctx = createMockContext()
    const saveResult = await findTool('ideas_save').handler(
      { title: 'Test idea', project: 'test', description: 'A detailed description' },
      ctx,
    )
    const id = getText(saveResult).match(/ID: (idea-[\w-]+)/)![1]

    const result = await findTool('ideas_get').handler({ id }, ctx)
    expect(result.isError).toBeUndefined()
    expect(getText(result)).toContain('Test idea')
    expect(getText(result)).toContain('A detailed description')
  })

  it('returns error for missing idea', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_get').handler({ id: 'idea-nonexistent' }, ctx)
    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('not found')
  })

  it('returns error for empty id', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_get').handler({ id: '' }, ctx)
    expect(result.isError).toBe(true)
  })
})

describe('ideas_whats-next', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(async () => {
    ctx = createMockContext()
    await findTool('ideas_save').handler({ title: 'Low prio', project: 'myapp', priority: 'low' }, ctx)
    await findTool('ideas_save').handler({ title: 'Critical bug', project: 'myapp', priority: 'critical' }, ctx)
    await findTool('ideas_save').handler({ title: 'Medium thing', project: 'myapp', priority: 'medium' }, ctx)
    await findTool('ideas_save').handler({ title: 'Other project', project: 'other', priority: 'critical' }, ctx)
  })

  it('returns ideas sorted by priority', async () => {
    const result = await findTool('ideas_whats-next').handler({ project: 'myapp' }, ctx)
    const text = getText(result)
    expect(text).toContain('3 actionable')
    const criticalPos = text.indexOf('Critical bug')
    const mediumPos = text.indexOf('Medium thing')
    const lowPos = text.indexOf('Low prio')
    expect(criticalPos).toBeLessThan(mediumPos)
    expect(mediumPos).toBeLessThan(lowPos)
  })

  it('respects count parameter', async () => {
    const result = await findTool('ideas_whats-next').handler({ project: 'myapp', count: '1' }, ctx)
    const text = getText(result)
    expect(text).toContain('Critical bug')
    expect(text).not.toContain('Low prio')
  })

  it('excludes done and shelved ideas', async () => {
    // Mark the critical one as done
    const listResult = await findTool('ideas_list').handler({ project: 'myapp', priority: 'critical' }, ctx)
    const id = getText(listResult).match(/ID: (idea-[\w-]+)/)![1]
    await findTool('ideas_update').handler({ id, status: 'done' }, ctx)

    const result = await findTool('ideas_whats-next').handler({ project: 'myapp' }, ctx)
    expect(getText(result)).not.toContain('Critical bug')
    expect(getText(result)).toContain('2 actionable')
  })

  it('scopes to the specified project', async () => {
    const result = await findTool('ideas_whats-next').handler({ project: 'other' }, ctx)
    expect(getText(result)).toContain('1 actionable')
    expect(getText(result)).toContain('Other project')
  })

  it('returns message when nothing actionable', async () => {
    const result = await findTool('ideas_whats-next').handler({ project: 'empty' }, ctx)
    expect(getText(result)).toContain('No actionable ideas')
  })
})

describe('ideas_search', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(async () => {
    ctx = createMockContext()
    await findTool('ideas_save').handler({ title: 'Dark mode', project: 'ui', tags: 'theme,ux' }, ctx)
    await findTool('ideas_save').handler({ title: 'API rate limiter', project: 'backend', description: 'Throttle requests' }, ctx)
  })

  it('searches by title', async () => {
    const result = await findTool('ideas_search').handler({ query: 'dark' }, ctx)
    expect(getText(result)).toContain('Dark mode')
    expect(getText(result)).toContain('1 idea(s)')
  })

  it('searches by description', async () => {
    const result = await findTool('ideas_search').handler({ query: 'throttle' }, ctx)
    expect(getText(result)).toContain('API rate limiter')
  })

  it('searches by tag', async () => {
    const result = await findTool('ideas_search').handler({ query: 'ux' }, ctx)
    expect(getText(result)).toContain('Dark mode')
  })

  it('scopes to project', async () => {
    const result = await findTool('ideas_search').handler({ query: 'a', project: 'backend' }, ctx)
    expect(getText(result)).toContain('API rate limiter')
    expect(getText(result)).not.toContain('Dark mode')
  })

  it('returns message on no match', async () => {
    const result = await findTool('ideas_search').handler({ query: 'zzzzz' }, ctx)
    expect(getText(result)).toContain('No ideas matching')
  })
})

describe('ideas_update', () => {
  it('updates fields on an existing idea', async () => {
    const ctx = createMockContext()
    const saveResult = await findTool('ideas_save').handler(
      { title: 'Original', project: 'test', priority: 'low' },
      ctx,
    )
    const id = getText(saveResult).match(/ID: (idea-[\w-]+)/)![1]

    const result = await findTool('ideas_update').handler(
      { id, title: 'Updated Title', priority: 'high', status: 'planned' },
      ctx,
    )
    expect(result.isError).toBeUndefined()
    expect(getText(result)).toContain('Updated Title')
    expect(getText(result)).toContain('high')

    // Verify persistence
    const getResult = await findTool('ideas_get').handler({ id }, ctx)
    expect(getText(getResult)).toContain('Updated Title')
    expect(getText(getResult)).toContain('planned')
  })

  it('returns error for missing idea', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_update').handler({ id: 'idea-nope' }, ctx)
    expect(result.isError).toBe(true)
  })
})

describe('ideas_delete', () => {
  it('deletes an existing idea', async () => {
    const ctx = createMockContext()
    const saveResult = await findTool('ideas_save').handler(
      { title: 'To delete', project: 'test' },
      ctx,
    )
    const id = getText(saveResult).match(/ID: (idea-[\w-]+)/)![1]

    const result = await findTool('ideas_delete').handler({ id }, ctx)
    expect(result.isError).toBeUndefined()
    expect(getText(result)).toContain('Deleted idea')

    // Verify it's gone
    const getResult = await findTool('ideas_get').handler({ id }, ctx)
    expect(getResult.isError).toBe(true)
  })

  it('returns error for missing idea', async () => {
    const ctx = createMockContext()
    const result = await findTool('ideas_delete').handler({ id: 'idea-gone' }, ctx)
    expect(result.isError).toBe(true)
  })
})
