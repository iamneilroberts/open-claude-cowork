import store from './store.js'

export const STAGES = [
  'scouting',
  'building',
  'testing',
  'judging',
  'guarding',
  'documenting',
  'publishing',
  'complete'
]

const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s, i]))

const CHECKPOINTS = {
  scouting: 'scout_approved',
  building: 'build_approved',
  documenting: 'publish_approved'
}

export function getNextStage(currentStage) {
  const idx = STAGE_ORDER[currentStage]
  if (idx === undefined || idx >= STAGES.length - 1) return null
  return STAGES[idx + 1]
}

export function canAdvance(cycle) {
  const checkpoint = CHECKPOINTS[cycle.status]
  if (checkpoint && !cycle.checkpoints[checkpoint]) {
    return { allowed: false, reason: `Checkpoint "${checkpoint}" not approved. Use the appropriate approve command.` }
  }
  return { allowed: true }
}

export function advanceStage(cycleId) {
  const cycle = store.getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)

  const check = canAdvance(cycle)
  if (!check.allowed) return { advanced: false, ...check }

  const next = getNextStage(cycle.status)
  if (!next) return { advanced: false, reason: 'Already at final stage' }

  store.updateCycle(cycleId, { status: next })
  return { advanced: true, from: cycle.status, to: next }
}

export function approveCheckpoint(cycleId, checkpointName) {
  const cycle = store.getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)

  if (!cycle.checkpoints.hasOwnProperty(checkpointName)) {
    throw new Error(`Unknown checkpoint: ${checkpointName}`)
  }

  if (cycle.checkpoints[checkpointName]) {
    return { approved: false, reason: 'Already approved' }
  }

  const checkpoints = { ...cycle.checkpoints, [checkpointName]: new Date().toISOString() }
  store.updateCycle(cycleId, { checkpoints })
  return { approved: true, checkpoint: checkpointName }
}

export function rejectWithFeedback(cycleId, targetStage, feedback) {
  const cycle = store.getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)

  store.updateCycle(cycleId, {
    status: targetStage,
    rejectionFeedback: feedback,
    iterations: {
      ...cycle.iterations,
      build: (cycle.iterations.build || 0) + 1
    }
  })

  return { rejected: true, rolledBackTo: targetStage }
}

export function getStatus(cycleId) {
  const cycle = store.getCycle(cycleId)
  if (!cycle) return null

  const stageIdx = STAGE_ORDER[cycle.status]
  const totalStages = STAGES.length - 1
  const progress = Math.round((stageIdx / totalStages) * 100)

  return {
    cycleId: cycle.cycleId,
    status: cycle.status,
    progress: `${progress}%`,
    idea: cycle.idea ? { title: cycle.idea.title, summary: cycle.idea.summary } : null,
    appName: cycle.appName || null,
    checkpoints: cycle.checkpoints,
    iterations: cycle.iterations,
    pendingCheckpoint: CHECKPOINTS[cycle.status] || null,
    createdAt: cycle.createdAt,
    updatedAt: cycle.updatedAt
  }
}

export function failCycle(cycleId, reason) {
  store.updateCycle(cycleId, { status: 'failed', failureReason: reason })
}

export default {
  STAGES, getNextStage, canAdvance, advanceStage,
  approveCheckpoint, rejectWithFeedback, getStatus, failCycle
}
