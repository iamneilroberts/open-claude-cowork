import store from '../factory/store.js'
import pipeline from '../factory/pipeline.js'
import { runScout, pickIdea, formatIdeas } from '../factory/stages/scout.js'
import { runBuilder, approveBuild, rejectBuild } from '../factory/stages/builder.js'
import { runTester, formatTestResults } from '../factory/stages/tester.js'

/**
 * Factory command handler — routes /scout, /build, /test, /factory commands
 */
export default class FactoryHandler {
  constructor(gateway) {
    this.gateway = gateway
  }

  /**
   * Execute a factory command
   * @returns {Object} { handled: boolean, response?: string }
   */
  async execute(command, args, sessionKey, adapter, chatId) {
    try {
      switch (command) {
        case 'scout':
          return await this.handleScout(args, sessionKey, adapter, chatId)
        case 'build':
          return await this.handleBuild(args, sessionKey, adapter, chatId)
        case 'test':
          return await this.handleTest(args, sessionKey, adapter, chatId)
        case 'judge':
          return this.handleJudge(args)
        case 'docs':
          return this.handleDocs(args)
        case 'publish':
          return this.handlePublish(args)
        case 'factory':
          return this.handleFactory(args)
        default:
          return { handled: false }
      }
    } catch (err) {
      return { handled: true, response: `Factory error: ${err.message}` }
    }
  }

  async handleScout(args, sessionKey, adapter, chatId) {
    // /scout pick N — approve an idea
    if (args.startsWith('pick ')) {
      const n = parseInt(args.split(' ')[1])
      const cycle = store.getActiveCycle()
      if (!cycle) return { handled: true, response: 'No active cycle. Run /scout first.' }

      const result = pickIdea(cycle.cycleId, n)
      return {
        handled: true,
        response: [
          `Picked idea #${n}: ${result.picked.title}`,
          `App name: ${result.appName}`,
          '',
          'Cycle advanced to BUILD stage.',
          'Run /build to start building the app.'
        ].join('\n')
      }
    }

    // /scout — start scouting run
    let cycle = store.getActiveCycle()
    if (!cycle) {
      cycle = store.createCycle()
    } else if (cycle.status !== 'scouting') {
      return {
        handled: true,
        response: `Active cycle ${cycle.cycleId} is in ${cycle.status} stage. Use /factory to see status.`
      }
    }

    // Send initial message
    if (adapter && chatId) {
      await adapter.sendMessage(chatId, `Scouting for ideas... (cycle: ${cycle.cycleId})`)
    }

    const agent = this.gateway.agentRunner.agent
    const mcpServers = this.gateway.mcpServers

    const result = await runScout(agent, cycle.cycleId, mcpServers)

    if (!result.success) {
      return {
        handled: true,
        response: `Scouting failed: ${result.reason}`
      }
    }

    const updatedCycle = store.getCycle(cycle.cycleId)
    const formatted = formatIdeas(updatedCycle.ideas)

    return {
      handled: true,
      response: [
        `Found ${updatedCycle.ideas.length} ideas:`,
        '',
        formatted,
        '',
        'Pick an idea: /scout pick <number>'
      ].join('\n')
    }
  }

  async handleBuild(args, sessionKey, adapter, chatId) {
    const cycle = store.getActiveCycle()
    if (!cycle) return { handled: true, response: 'No active cycle. Run /scout first.' }

    // /build approve — approve the build
    if (args === 'approve') {
      if (cycle.status !== 'building') {
        return { handled: true, response: `Cycle is in ${cycle.status} stage, not building.` }
      }
      const result = approveBuild(cycle.cycleId)
      return {
        handled: true,
        response: [
          'Build approved!',
          'Cycle advanced to TESTING stage.',
          'Run /test to start persona testing.'
        ].join('\n')
      }
    }

    // /build reject <feedback> — reject with feedback
    if (args.startsWith('reject ')) {
      const feedback = args.slice(7).trim()
      if (!feedback) return { handled: true, response: 'Provide feedback: /build reject <what to fix>' }

      const result = rejectBuild(cycle.cycleId, feedback)
      if (result.failed) {
        return { handled: true, response: `Build rejected too many times. Cycle failed: ${result.reason}` }
      }
      return {
        handled: true,
        response: `Build rejected with feedback. Run /build to rebuild.`
      }
    }

    // /build — start building
    if (cycle.status !== 'building') {
      // If scouting is done and checkpoint approved, advance to building
      if (cycle.status === 'scouting' && cycle.checkpoints.scout_approved) {
        pipeline.advanceStage(cycle.cycleId)
      } else if (cycle.status !== 'building') {
        return { handled: true, response: `Cycle is in ${cycle.status} stage. ${cycle.status === 'scouting' ? 'Pick an idea first: /scout pick <N>' : ''}` }
      }
    }

    if (adapter && chatId) {
      await adapter.sendMessage(chatId, `Building ${cycle.appName}... This may take a few minutes.`)
    }

    const agent = this.gateway.agentRunner.agent
    const mcpServers = this.gateway.mcpServers

    const result = await runBuilder(agent, cycle.cycleId, mcpServers)

    if (!result.success) {
      return {
        handled: true,
        response: [
          `Build failed: ${result.reason}`,
          '',
          'Options:',
          '  /build — retry the build',
          '  /build reject <feedback> — reject with specific feedback'
        ].join('\n')
      }
    }

    return {
      handled: true,
      response: [
        `Build complete: ${cycle.appName}`,
        `  Tools: ${result.toolCount || '?'}`,
        `  Tests: ${result.testsPass ? 'passing' : 'failing'}`,
        `  Typecheck: ${result.typecheckPass ? 'passing' : 'failing'}`,
        `  Iterations: ${result.iterations || 1}`,
        result.notes ? `  Notes: ${result.notes}` : '',
        '',
        'Review the build, then:',
        '  /build approve — advance to testing',
        '  /build reject <feedback> — rebuild with changes'
      ].filter(Boolean).join('\n')
    }
  }

  async handleTest(args, sessionKey, adapter, chatId) {
    const cycle = store.getActiveCycle()
    if (!cycle) return { handled: true, response: 'No active cycle.' }

    if (cycle.status === 'testing' && cycle.testResults?.length > 0 && !args) {
      // Show existing results
      return {
        handled: true,
        response: [
          'Test Results:',
          '',
          formatTestResults(cycle.testResults)
        ].join('\n')
      }
    }

    if (cycle.status !== 'testing') {
      return { handled: true, response: `Cycle is in ${cycle.status} stage. Approve the build first: /build approve` }
    }

    if (adapter && chatId) {
      await adapter.sendMessage(chatId, `Running persona tests on ${cycle.appName}...`)
    }

    const agent = this.gateway.agentRunner.agent
    const mcpServers = this.gateway.mcpServers

    const result = await runTester(agent, cycle.cycleId, mcpServers)

    return {
      handled: true,
      response: [
        `Testing complete${result.allPassed ? ' - all passed!' : ' - some issues found'}`,
        '',
        formatTestResults(result.results),
        '',
        result.allPassed
          ? 'All personas passed. Cycle ready to advance.'
          : 'Some issues were found. Review above.'
      ].join('\n')
    }
  }

  handleJudge(args) {
    const cycle = store.getActiveCycle()
    if (!cycle) return { handled: true, response: 'No active cycle.' }

    if (cycle.judgeVerdict) {
      return {
        handled: true,
        response: [
          `Judge Verdict: ${cycle.judgeVerdict.verdict}`,
          cycle.judgeVerdict.summary || '',
          cycle.judgeVerdict.improvements ? `Improvements: ${cycle.judgeVerdict.improvements.join(', ')}` : ''
        ].filter(Boolean).join('\n')
      }
    }
    return { handled: true, response: 'Judge stage not reached yet. (Phase 2)' }
  }

  handleDocs(args) {
    const cycle = store.getActiveCycle()
    if (!cycle) return { handled: true, response: 'No active cycle.' }

    if (cycle.docs) {
      return { handled: true, response: `Documentation generated at ${cycle.appPath}/docs/` }
    }
    return { handled: true, response: 'Documentation stage not reached yet. (Phase 2)' }
  }

  handlePublish(args) {
    const cycle = store.getActiveCycle()
    if (!cycle) return { handled: true, response: 'No active cycle.' }

    if (args === 'approve') {
      return { handled: true, response: 'Publish stage not implemented yet. (Phase 3)' }
    }
    return { handled: true, response: 'Publish stage not implemented yet. (Phase 3)' }
  }

  handleFactory(args) {
    if (args === 'history') {
      const cycles = store.listCycles({ limit: 10, includeComplete: true })
      if (cycles.length === 0) return { handled: true, response: 'No factory cycles yet. Start with /scout.' }

      const lines = cycles.map(c => {
        const idea = c.idea ? c.idea.title : 'No idea selected'
        return `  ${c.cycleId} | ${c.status} | ${idea}`
      })

      return {
        handled: true,
        response: ['Factory History:', '', ...lines].join('\n')
      }
    }

    if (args === 'config') {
      const config = store.getConfig()
      return {
        handled: true,
        response: [
          'Factory Config:',
          '',
          `  Reddit subs: ${config.scoutSources.reddit.join(', ')}`,
          `  Hacker News: ${config.scoutSources.hackerNews ? 'enabled' : 'disabled'}`,
          `  Product Hunt: ${config.scoutSources.productHunt ? 'enabled' : 'disabled'}`,
          `  Persona count: ${config.personaCount}`,
          `  Max build iterations: ${config.maxBuildIterations}`,
          `  Min scout score: ${config.thresholds.scoutMinScore}`,
          `  Existing apps: ${config.existingApps.join(', ')}`
        ].join('\n')
      }
    }

    if (args === 'pause') {
      store.updateConfig({ pauseCron: true })
      return { handled: true, response: 'Factory paused. Resume with /factory resume.' }
    }

    if (args === 'resume') {
      store.updateConfig({ pauseCron: false })
      return { handled: true, response: 'Factory resumed.' }
    }

    // Default: show current status
    const cycle = store.getActiveCycle()
    if (!cycle) {
      return {
        handled: true,
        response: [
          'App Factory',
          '',
          'No active cycle. Start with /scout to find ideas.',
          '',
          'Commands:',
          '  /scout — find app ideas',
          '  /scout pick <N> — select an idea',
          '  /build — build the selected idea',
          '  /build approve — approve build',
          '  /build reject <feedback> — reject with feedback',
          '  /test — run persona tests',
          '  /factory — this status view',
          '  /factory history — past cycles',
          '  /factory config — view configuration'
        ].join('\n')
      }
    }

    const status = pipeline.getStatus(cycle.cycleId)

    const lines = [
      `App Factory — ${status.cycleId}`,
      '',
      `  Stage: ${status.status} (${status.progress})`,
      status.idea ? `  Idea: ${status.idea.title}` : '  Idea: Not selected',
      status.appName ? `  App: ${status.appName}` : '',
      '',
      '  Checkpoints:',
      `    Scout: ${status.checkpoints.scout_approved ? 'approved' : 'pending'}`,
      `    Build: ${status.checkpoints.build_approved ? 'approved' : 'pending'}`,
      `    Publish: ${status.checkpoints.publish_approved ? 'approved' : 'pending'}`,
      '',
      `  Build iterations: ${status.iterations.build}`,
      `  Test iterations: ${status.iterations.test}`,
      status.pendingCheckpoint ? `\n  Next: Approve checkpoint "${status.pendingCheckpoint}"` : ''
    ].filter(Boolean)

    return { handled: true, response: lines.join('\n') }
  }
}
