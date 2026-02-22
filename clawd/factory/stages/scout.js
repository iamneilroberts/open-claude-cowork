import store from '../store.js'
import pipeline from '../pipeline.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCOUT_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'scout.md')

function getScoutPrompt() {
  try {
    return fs.readFileSync(SCOUT_PROMPT_PATH, 'utf-8')
  } catch {
    return DEFAULT_SCOUT_PROMPT
  }
}

const DEFAULT_SCOUT_PROMPT = `You are scouting for MCP tool app ideas. Evaluate each idea on:
- feasibility (1-5): Can this be built as a single-domain MCP tool with KV storage?
- mcp_fit (1-5): Does it enhance a chat client naturally?
- demand_signal (1-5): Are people expressing frustration or "I wish I had..."?
- uniqueness (1-5): Is it different from existing scaffold apps?

Return JSON array of ideas with scores.`

function buildRedditCommands(subreddits) {
  return subreddits.map(sub =>
    `curl -s "https://www.reddit.com/r/${sub}/top.json?t=week&limit=25" -H "User-Agent: ScaffoldScout/1.0"`
  )
}

function buildHackerNewsCommands() {
  return [
    // Show HN: fetch top 30 story IDs, then fetch first 10 stories
    `curl -s "https://hacker-news.firebaseio.com/v0/showstories.json" | head -c 200`,
    // Ask HN: fetch top 30 story IDs, then fetch first 10 stories
    `curl -s "https://hacker-news.firebaseio.com/v0/askstories.json" | head -c 200`,
  ]
}

/**
 * Run the scouting stage using curl to fetch Reddit/HN JSON APIs.
 * No browser required — uses Reddit's .json endpoints and HN's Firebase API.
 *
 * @param {Object} agent - ClaudeAgent instance
 * @param {string} cycleId - Current cycle ID
 * @param {Object} mcpServers - MCP servers
 * @returns {Object} scouting results
 */
export async function runScout(agent, cycleId, mcpServers) {
  const config = store.getConfig()
  const cycle = store.getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)

  const redditCommands = []
  const hnCommands = []

  // Reddit sources
  if (config.scoutSources.reddit?.length) {
    redditCommands.push(...buildRedditCommands(config.scoutSources.reddit))
  }

  // Hacker News sources
  if (config.scoutSources.hackerNews) {
    hnCommands.push(...buildHackerNewsCommands())
  }

  const existingApps = config.existingApps.join(', ')
  const scoutPrompt = getScoutPrompt()

  const redditSection = redditCommands.length ? `### Reddit

Fetch top posts from each subreddit using curl. The Reddit JSON API returns posts at any reddit URL by appending .json:

${redditCommands.map((cmd, i) => `${i + 1}. \`${cmd}\``).join('\n')}

Parse the response: \`response.data.children[].data\` contains \`{title, selftext, score, num_comments, permalink, url}\`.

Use jq to extract relevant fields:
\`\`\`
curl -s "https://www.reddit.com/r/SUBREDDIT/top.json?t=week&limit=25" -H "User-Agent: ScaffoldScout/1.0" | jq '.data.children[].data | {title, selftext: .selftext[:200], score, num_comments, permalink}'
\`\`\`
` : ''

  const hnSection = hnCommands.length ? `### Hacker News

HN has a Firebase JSON API. Fetch story IDs, then fetch individual stories:

1. Get Show HN story IDs: \`curl -s "https://hacker-news.firebaseio.com/v0/showstories.json"\`
2. Get Ask HN story IDs: \`curl -s "https://hacker-news.firebaseio.com/v0/askstories.json"\`
3. Fetch individual story: \`curl -s "https://hacker-news.firebaseio.com/v0/item/{id}.json"\`

Each story has: \`{title, text, score, descendants (comment count), url}\`.

Fetch the top 10 stories from each list (Show HN + Ask HN).
` : ''

  const message = `You are the Scout stage of the Scaffold App Factory. Your job is to find ideas for new MCP tool apps by researching Reddit and Hacker News.

## Instructions

${scoutPrompt}

## Data Sources

Use \`exec\` or shell commands to run curl and jq. Do NOT use browser tools — use the JSON APIs directly.

${redditSection}
${hnSection}

## Existing Apps (avoid duplicating these)
${existingApps}

## Process

1. Fetch posts from each source using curl commands above
2. Parse the JSON responses with jq to extract titles, descriptions, scores
3. Look for posts where people express needs, frustrations, or "I wish..." sentiments that could be solved by an MCP tool
4. Extract the top ideas you find
5. Score each idea on: feasibility (1-5), mcp_fit (1-5), demand_signal (1-5), uniqueness (1-5)
6. Rank by total score (sum of all 4 criteria, max 20)

## Output Format

After analyzing all sources, respond with EXACTLY this JSON structure (no other text):

\`\`\`json
{
  "ideas": [
    {
      "title": "Short descriptive title",
      "summary": "2-3 sentence description of the app idea",
      "sourceUrl": "URL where you found this idea",
      "sourceQuote": "The key quote or post that inspired this idea",
      "scores": {
        "feasibility": 4,
        "mcp_fit": 5,
        "demand_signal": 3,
        "uniqueness": 4
      },
      "totalScore": 16,
      "suggestedTools": ["tool1_action", "tool2_action"]
    }
  ]
}
\`\`\`

Return exactly 5 ideas ranked by total score (highest first). Only include ideas scoring 12 or higher.`

  const sourceCount = redditCommands.length + hnCommands.length
  console.log('[Factory Scout] Starting scouting run...')
  console.log(`[Factory Scout] Fetching from ${sourceCount} sources...`)

  const sessionKey = `factory:scout:${cycleId}`

  try {
    const response = await agent.runAndCollect({
      message,
      sessionKey,
      platform: 'factory',
      mcpServers
    })

    // Parse the JSON response
    const ideas = parseScoutResponse(response)

    if (!ideas || ideas.length === 0) {
      store.updateCycle(cycleId, { ideas: [], buildLog: [...(cycle.buildLog || []), 'Scout found no ideas'] })
      return { success: false, reason: 'No viable ideas found', rawResponse: response }
    }

    // Filter by minimum score
    const minScore = config.thresholds?.scoutMinScore || 12
    const filteredIdeas = ideas.filter(i => (i.totalScore || sumScores(i.scores)) >= minScore)

    store.updateCycle(cycleId, {
      ideas: filteredIdeas.slice(0, 5),
      buildLog: [...(cycle.buildLog || []), `Scout found ${filteredIdeas.length} ideas`]
    })

    console.log(`[Factory Scout] Found ${filteredIdeas.length} ideas`)
    return { success: true, ideas: filteredIdeas.slice(0, 5) }
  } catch (err) {
    console.error('[Factory Scout] Error:', err.message)
    store.updateCycle(cycleId, {
      buildLog: [...(cycle.buildLog || []), `Scout error: ${err.message}`]
    })
    return { success: false, reason: err.message }
  }
}

function sumScores(scores) {
  if (!scores) return 0
  return (scores.feasibility || 0) + (scores.mcp_fit || 0) +
         (scores.demand_signal || 0) + (scores.uniqueness || 0)
}

function parseScoutResponse(response) {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : response

  try {
    const parsed = JSON.parse(jsonStr.trim())
    return parsed.ideas || parsed
  } catch {
    // Try to find any JSON array in the response
    const arrayMatch = response.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0])
      } catch {
        return null
      }
    }
    // Try to find JSON object with ideas key
    const objMatch = response.match(/\{\s*"ideas"\s*:\s*\[[\s\S]*\]\s*\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]).ideas
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Pick an idea from scouting results
 */
export function pickIdea(cycleId, ideaIndex) {
  const cycle = store.getCycle(cycleId)
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)
  if (!cycle.ideas || cycle.ideas.length === 0) throw new Error('No ideas to pick from. Run /scout first.')
  if (ideaIndex < 1 || ideaIndex > cycle.ideas.length) {
    throw new Error(`Pick a number between 1 and ${cycle.ideas.length}`)
  }

  const idea = cycle.ideas[ideaIndex - 1]

  // Generate app name from title
  const appName = idea.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30)

  store.updateCycle(cycleId, { idea, appName })
  pipeline.approveCheckpoint(cycleId, 'scout_approved')
  pipeline.advanceStage(cycleId)

  return { picked: idea, appName }
}

export function formatIdeas(ideas) {
  if (!ideas || ideas.length === 0) return 'No ideas found.'

  return ideas.map((idea, i) => {
    const scores = idea.scores || {}
    const total = idea.totalScore || sumScores(scores)
    return [
      `${i + 1}. ${idea.title} (Score: ${total}/20)`,
      `   ${idea.summary}`,
      `   Feasibility: ${scores.feasibility || '?'} | MCP-fit: ${scores.mcp_fit || '?'} | Demand: ${scores.demand_signal || '?'} | Unique: ${scores.uniqueness || '?'}`,
      `   Source: ${idea.sourceUrl || 'N/A'}`,
      idea.suggestedTools ? `   Tools: ${idea.suggestedTools.join(', ')}` : ''
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

export default { runScout, pickIdea, formatIdeas }
