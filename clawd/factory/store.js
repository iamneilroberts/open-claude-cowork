import fs from 'fs'
import path from 'path'
import os from 'os'

const FACTORY_DIR = path.join(os.homedir(), 'clawd', 'factory')
const CONFIG_FILE = path.join(FACTORY_DIR, 'config.json')
const CATALOG_FILE = path.join(FACTORY_DIR, 'catalog.json')
const APP_STORE_CACHE_FILE = path.join(FACTORY_DIR, 'app-store-cache.json')
const CYCLES_DIR = path.join(FACTORY_DIR, 'cycles')
const LEARNINGS_DIR = path.join(FACTORY_DIR, 'learnings')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readJSON(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (err) {
    console.error(`[Factory Store] Failed to read ${filePath}:`, err.message)
  }
  return fallback
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

const DEFAULT_CONFIG = {
  scoutSources: {
    reddit: [
      'ClaudeAI', 'ChatGPT', 'sideproject', 'buildinpublic', 'SaaS'
    ],
    hackerNews: true,
    productHunt: false,
    twitter: false,
    appStore: {
      enabled: false,
      searchTerms: null,  // null = use DEFAULT_TERMS from app-store-scout.js
      minRatingCount: 200,
      minMonthsAbandoned: 18,
      maxDistressRating: 3.2,
      cacheTermDays: 7,
      cacheOpportunityDays: 30
    }
  },
  personaCount: 2,
  maxBuildIterations: 3,
  maxRebuildRounds: 2,
  thresholds: {
    scoutMinScore: 12,
    judgingPassScore: 70
  },
  existingApps: ['notes-app', 'travel', 'bbq', 'local-guide', 'watch-recommender'],
  catalog: {
    scaffoldRepoPath: path.join(os.homedir(), 'dev', 'scaffold')
  },
  pauseCron: false
}

export function createCycle() {
  ensureDir(CYCLES_DIR)

  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const existing = fs.existsSync(CYCLES_DIR) ? fs.readdirSync(CYCLES_DIR) : []
  const todayCount = existing.filter(d => d.startsWith(`cycle-${dateStr}`)).length
  const cycleId = `cycle-${dateStr}-${String(todayCount + 1).padStart(3, '0')}`

  const cycle = {
    cycleId,
    status: 'scouting',
    ideas: [],
    idea: null,
    checkpoints: {
      scout_approved: null,
      build_approved: null,
      publish_approved: null
    },
    appPath: '',
    appName: '',
    buildLog: [],
    testResults: [],
    judgeVerdict: null,
    guardianReport: null,
    docs: null,
    iterations: { build: 0, test: 0 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }

  const cycleDir = path.join(CYCLES_DIR, cycleId)
  ensureDir(cycleDir)
  writeJSON(path.join(cycleDir, 'state.json'), cycle)

  return cycle
}

export function getCycle(cycleId) {
  const stateFile = path.join(CYCLES_DIR, cycleId, 'state.json')
  return readJSON(stateFile)
}

export function getActiveCycle() {
  if (!fs.existsSync(CYCLES_DIR)) return null

  const dirs = fs.readdirSync(CYCLES_DIR)
    .filter(d => d.startsWith('cycle-'))
    .sort()
    .reverse()

  for (const dir of dirs) {
    const cycle = getCycle(dir)
    if (cycle && cycle.status !== 'complete' && cycle.status !== 'failed') {
      return cycle
    }
  }
  return null
}

export function updateCycle(cycleId, updates) {
  const cycle = getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)

  const updated = { ...cycle, ...updates, updatedAt: new Date().toISOString() }
  writeJSON(path.join(CYCLES_DIR, cycleId, 'state.json'), updated)
  return updated
}

export function listCycles({ limit = 10, includeComplete = false } = {}) {
  if (!fs.existsSync(CYCLES_DIR)) return []

  const dirs = fs.readdirSync(CYCLES_DIR)
    .filter(d => d.startsWith('cycle-'))
    .sort()
    .reverse()

  const cycles = []
  for (const dir of dirs) {
    if (cycles.length >= limit) break
    const cycle = getCycle(dir)
    if (cycle) {
      if (!includeComplete && (cycle.status === 'complete' || cycle.status === 'failed')) continue
      cycles.push(cycle)
    }
  }
  return cycles
}

export function getConfig() {
  ensureDir(FACTORY_DIR)
  const config = readJSON(CONFIG_FILE)
  if (!config) {
    writeJSON(CONFIG_FILE, DEFAULT_CONFIG)
    return { ...DEFAULT_CONFIG }
  }
  // Deep merge scoutSources so new defaults (like appStore) aren't lost
  // when user has customized only some sources
  return {
    ...DEFAULT_CONFIG,
    ...config,
    scoutSources: { ...DEFAULT_CONFIG.scoutSources, ...(config.scoutSources || {}) },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(config.thresholds || {}) },
    catalog: { ...DEFAULT_CONFIG.catalog, ...(config.catalog || {}) }
  }
}

export function updateConfig(updates) {
  const config = getConfig()
  const updated = { ...config, ...updates }
  writeJSON(CONFIG_FILE, updated)
  return updated
}

export function getCatalog() {
  return readJSON(CATALOG_FILE, { apps: [], updatedAt: null })
}

export function addToCatalog(app) {
  const catalog = getCatalog()
  const existing = catalog.apps.findIndex(a => a.name === app.name)
  if (existing >= 0) {
    catalog.apps[existing] = app
  } else {
    catalog.apps.push(app)
  }
  catalog.updatedAt = new Date().toISOString()
  writeJSON(CATALOG_FILE, catalog)
  return catalog
}

export function saveLearning(type, data) {
  ensureDir(LEARNINGS_DIR)
  const filename = `${type}-${new Date().toISOString().split('T')[0]}.json`
  const filePath = path.join(LEARNINGS_DIR, filename)
  const existing = readJSON(filePath, [])
  existing.push({ ...data, timestamp: new Date().toISOString() })
  writeJSON(filePath, existing)
}

const DEFAULT_APP_STORE_CACHE = {
  schemaVersion: 1,
  opportunities: [],
  scannedTerms: {},
  updatedAt: null
}

const APP_STORE_CACHE_REQUIRED_FIELDS = ['appId', 'appName', 'mcpFitScore', 'discoveredAt']

export function getAppStoreCache() {
  const cache = readJSON(APP_STORE_CACHE_FILE)
  if (!cache || cache.schemaVersion !== 1) {
    return { ...DEFAULT_APP_STORE_CACHE }
  }
  return cache
}

/**
 * Atomically update the App Store cache.
 * Validates required fields before writing. On validation failure,
 * preserves last-known-good cache.
 *
 * @param {Object[]} opportunities - Validated opportunity objects
 * @param {Object} scannedTerms - Map of term -> ISO timestamp
 * @returns {Object} Updated cache
 */
export function updateAppStoreCache(opportunities, scannedTerms) {
  const existing = getAppStoreCache()

  // Validate all opportunities have required fields
  const valid = opportunities.filter(opp => {
    return APP_STORE_CACHE_REQUIRED_FIELDS.every(field => opp[field] != null)
  })

  if (valid.length !== opportunities.length) {
    console.warn(`[Factory Store] Dropped ${opportunities.length - valid.length} invalid app store opportunities`)
  }

  // Merge: upsert by appId, keep existing that aren't being replaced
  const byId = new Map()
  for (const opp of existing.opportunities) {
    byId.set(opp.appId, opp)
  }
  for (const opp of valid) {
    byId.set(opp.appId, opp)
  }

  const mergedTerms = { ...existing.scannedTerms, ...scannedTerms }

  const cache = {
    schemaVersion: 1,
    opportunities: Array.from(byId.values()),
    scannedTerms: mergedTerms,
    updatedAt: new Date().toISOString()
  }

  // Atomic write: temp file + rename
  ensureDir(path.dirname(APP_STORE_CACHE_FILE))
  const tmpFile = APP_STORE_CACHE_FILE + '.tmp'
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2))
    fs.renameSync(tmpFile, APP_STORE_CACHE_FILE)
  } catch (err) {
    console.error('[Factory Store] Failed to write app store cache:', err.message)
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    return existing // Preserve last-known-good
  }

  return cache
}

/**
 * Publish a completed cycle's app to the scaffold catalog.
 * Reads existing catalog.json from the scaffold repo, upserts the entry, writes back.
 *
 * @param {Object} cycle - Completed cycle state
 * @param {string} scaffoldRepoPath - Path to scaffold repo (default from config)
 * @returns {{ success: boolean, catalogPath: string, error?: string }}
 */
export function publishToCatalog(cycle, scaffoldRepoPath) {
  const config = getConfig()
  const repoPath = scaffoldRepoPath || config.catalog?.scaffoldRepoPath
  if (!repoPath) {
    return { success: false, error: 'No scaffoldRepoPath configured' }
  }

  const catalogPath = path.join(repoPath, 'docs', 'catalog', 'catalog.json')

  // Read existing catalog
  let catalog = readJSON(catalogPath, { apps: [], updatedAt: null })

  // Map cycle to AppEntry
  const entry = {
    name: cycle.appName,
    displayName: cycle.idea?.title || cycle.appName,
    icon: cycle.idea?.icon || '🔧',
    version: '0.0.1',
    category: cycle.idea?.category || 'utilities',
    tags: cycle.idea?.tags || [],
    description: cycle.idea?.summary || '',
    cycleId: cycle.cycleId,
    builtAt: cycle.updatedAt || new Date().toISOString(),
    sourceUrl: `https://github.com/neilopet/scaffold/tree/master/examples/${cycle.appName}`,
    tools: (cycle.idea?.suggestedTools || []).map(t => ({
      name: t, description: ''
    })),
    quality: {
      judgeScore: cycle.judgeVerdict?.score ?? null,
      judgeVerdict: cycle.judgeVerdict?.verdict ?? null,
      personaPassRate: cycle.testResults?.length
        ? cycle.testResults.filter(r => r.passed).length / cycle.testResults.length
        : null,
      buildIterations: cycle.iterations?.build || 1,
      guardianPassed: cycle.guardianReport?.passed ?? null,
      testCount: cycle.testResults?.length || 0
    },
    install: {
      workerUrl: `https://scaffold-${cycle.appName}.neilopet.workers.dev`,
      requiresAuth: true,
      mcpConfig: {
        mcpServers: {
          [cycle.appName]: {
            url: `https://scaffold-${cycle.appName}.neilopet.workers.dev/sse?token=YOUR_TOKEN`
          }
        }
      }
    },
    status: 'beta'
  }

  // Upsert
  const existingIdx = catalog.apps.findIndex(a => a.name === entry.name)
  if (existingIdx >= 0) {
    catalog.apps[existingIdx] = entry
  } else {
    catalog.apps.push(entry)
  }
  catalog.updatedAt = new Date().toISOString()

  // Write atomically
  ensureDir(path.dirname(catalogPath))
  const tmpFile = catalogPath + '.tmp'
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(catalog, null, 2))
    fs.renameSync(tmpFile, catalogPath)
  } catch (err) {
    return { success: false, catalogPath, error: err.message }
  }

  return { success: true, catalogPath }
}

export default {
  createCycle, getCycle, getActiveCycle, updateCycle, listCycles,
  getConfig, updateConfig,
  getCatalog, addToCatalog,
  getAppStoreCache, updateAppStoreCache,
  publishToCatalog,
  saveLearning
}
