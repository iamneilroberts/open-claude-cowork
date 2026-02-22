import fs from 'fs'
import path from 'path'
import os from 'os'

const FACTORY_DIR = path.join(os.homedir(), 'clawd', 'factory')
const CONFIG_FILE = path.join(FACTORY_DIR, 'config.json')
const CATALOG_FILE = path.join(FACTORY_DIR, 'catalog.json')
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
    twitter: false
  },
  personaCount: 2,
  maxBuildIterations: 3,
  maxRebuildRounds: 2,
  thresholds: {
    scoutMinScore: 12,
    judgingPassScore: 70
  },
  existingApps: ['notes-app', 'travel', 'bbq', 'local-guide', 'watch-recommender'],
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
  return { ...DEFAULT_CONFIG, ...config }
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

export default {
  createCycle, getCycle, getActiveCycle, updateCycle, listCycles,
  getConfig, updateConfig,
  getCatalog, addToCatalog,
  saveLearning
}
