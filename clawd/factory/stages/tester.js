import store from '../store.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PERSONAS_DIR = path.join(__dirname, '..', 'personas')

function loadPersona(name) {
  const filePath = path.join(PERSONAS_DIR, `${name}.md`)
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function getToolsFromBuild(appDir) {
  // Read the tools.ts file to understand what tools are available
  const toolsFile = path.join(appDir, 'src', 'tools.ts')
  try {
    return fs.readFileSync(toolsFile, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Run persona tests against the built app.
 * Each persona gets its own agent session that interacts with the app's tools.
 *
 * @param {Object} agent - ClaudeAgent instance
 * @param {string} cycleId - Current cycle ID
 * @param {Object} mcpServers - MCP servers
 * @returns {Object} test results
 */
export async function runTester(agent, cycleId, mcpServers) {
  const config = store.getConfig()
  const cycle = store.getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)
  if (!cycle.appPath) throw new Error('No app path. Build first.')

  const toolsSource = getToolsFromBuild(cycle.appPath)
  if (!toolsSource) {
    return { success: false, reason: `Could not read tools from ${cycle.appPath}/src/tools.ts` }
  }

  // MVP: 2 personas
  const personaNames = ['casual-user', 'adversarial-tester']
  const results = []

  for (const personaName of personaNames) {
    const personaPrompt = loadPersona(personaName)
    if (!personaPrompt) {
      console.log(`[Factory Tester] Skipping persona ${personaName} - file not found`)
      continue
    }

    console.log(`[Factory Tester] Running persona: ${personaName}`)

    const result = await runPersonaTest(agent, cycle, personaName, personaPrompt, toolsSource, mcpServers)
    results.push(result)
  }

  store.updateCycle(cycleId, {
    testResults: results,
    iterations: { ...cycle.iterations, test: (cycle.iterations.test || 0) + 1 },
    buildLog: [...(cycle.buildLog || []), `Testing complete: ${results.length} personas, ${results.filter(r => r.passed).length} passed`]
  })

  const allPassed = results.every(r => r.passed)
  console.log(`[Factory Tester] ${allPassed ? 'All' : 'Some'} personas ${allPassed ? 'passed' : 'had issues'}`)

  return { success: true, results, allPassed }
}

async function runPersonaTest(agent, cycle, personaName, personaPrompt, toolsSource, mcpServers) {
  const appName = cycle.appName
  const appDir = cycle.appPath

  const message = `You are a test persona for the Scaffold App Factory. You will test a newly built MCP tool app by simulating realistic usage.

## Your Persona

${personaPrompt}

## App Under Test

**Name:** ${appName}
**Idea:** ${cycle.idea.title} - ${cycle.idea.summary}
**App directory:** ${appDir}

## Available Tool Source Code

Here are the tools available in this app:

\`\`\`typescript
${toolsSource}
\`\`\`

## Testing Instructions

You need to test this app by actually using the tools via Bash commands. Since this is a scaffold app, we'll test the tool handlers directly.

1. First, read the test file at ${appDir}/src/__tests__/tools.test.ts to understand the testing setup
2. Run the existing tests: cd ${appDir} && npx vitest run
3. Then create additional test scenarios based on your persona by writing to a new test file: ${appDir}/src/__tests__/persona-${personaName}.test.ts
4. Run your persona tests: cd ${appDir} && npx vitest run src/__tests__/persona-${personaName}.test.ts

## Your Testing Goals (based on persona)

Make 5-10 tool calls covering:
- Basic functionality (create, read, update, delete operations)
- Edge cases relevant to your persona
- Error handling (invalid inputs, missing data)
- Data isolation (ensure userId prefix isolation works)

## Output Format

After testing, respond with EXACTLY this JSON:

\`\`\`json
{
  "persona": "${personaName}",
  "passed": true,
  "toolCalls": 8,
  "successes": 7,
  "failures": 1,
  "findings": [
    {
      "severity": "low|medium|high|critical",
      "description": "What you found",
      "tool": "tool:name",
      "input": {},
      "expected": "what should happen",
      "actual": "what actually happened"
    }
  ],
  "commentary": "Overall assessment from this persona's perspective",
  "testsWritten": 5,
  "testsPass": true
}
\`\`\``

  const sessionKey = `factory:tester:${cycle.cycleId}:${personaName}`

  try {
    const response = await agent.runAndCollect({
      message,
      sessionKey,
      platform: 'factory',
      mcpServers
    })

    const result = parseTestResponse(response, personaName)
    return result || {
      persona: personaName,
      passed: false,
      reason: 'Could not parse test results',
      rawResponse: response.slice(0, 500)
    }
  } catch (err) {
    console.error(`[Factory Tester] ${personaName} error:`, err.message)
    return {
      persona: personaName,
      passed: false,
      reason: err.message
    }
  }
}

function parseTestResponse(response, personaName) {
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : response

  try {
    return JSON.parse(jsonStr.trim())
  } catch {
    const objMatch = response.match(/\{\s*"persona"\s*:[\s\S]*?\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0])
      } catch {
        return null
      }
    }
    return null
  }
}

export function formatTestResults(results) {
  if (!results || results.length === 0) return 'No test results.'

  return results.map(r => {
    const status = r.passed ? 'PASS' : 'FAIL'
    const findings = r.findings?.length
      ? r.findings.map(f => `  - [${f.severity}] ${f.description}`).join('\n')
      : '  No issues found'

    return [
      `${status} - ${r.persona}`,
      `  Tool calls: ${r.toolCalls || '?'}, Successes: ${r.successes || '?'}, Failures: ${r.failures || '?'}`,
      findings,
      r.commentary ? `  Commentary: ${r.commentary}` : ''
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

export default { runTester, formatTestResults }
