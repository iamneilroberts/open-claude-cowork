/**
 * Default search terms targeting MCP-feasible categories.
 * Each term should surface iOS apps whose underlying need maps to
 * a chat-native CRUD tool with KV storage.
 */
export const DEFAULT_TERMS = [
  'driving log',
  'habit tracker',
  'checkbook register',
  'flashcard maker',
  'symptom diary',
  'pet health tracker',
  'book reading log',
  'workout log',
  'meal planner',
  'grocery list',
  'budget tracker',
  'wine journal',
  'plant care tracker',
  'medication reminder log',
  'daily journal',
  'collection catalog',
  'contacts manager simple',
  'time tracker freelance',
  'recipe box',
  'fishing log'
]

/**
 * Build curl commands for the iTunes Search API.
 * Returns { commands, cachedOpps, freshTerms } based on cache freshness.
 *
 * @param {Object} config - scoutSources.appStore config
 * @param {Object} cache - current app store cache
 * @returns {{ commands: string[], cachedOpps: Object[], freshTerms: string[] }}
 */
export function buildAppStoreCommands(config, cache) {
  const terms = config.searchTerms || DEFAULT_TERMS
  const cacheTermDays = config.cacheTermDays || 7
  const maxFreshTerms = 10 // Rate limit: max 10 fresh terms per cycle

  const now = Date.now()
  const cacheCutoff = now - (cacheTermDays * 24 * 60 * 60 * 1000)

  const freshTerms = []
  const cachedTerms = []

  for (const term of terms) {
    if (freshTerms.length >= maxFreshTerms) break

    const lastScanned = cache.scannedTerms?.[term]
    if (lastScanned && new Date(lastScanned).getTime() > cacheCutoff) {
      cachedTerms.push(term)
    } else {
      freshTerms.push(term)
    }
  }

  // Gather cached opportunities for terms we're not re-fetching
  const cachedOpps = (cache.opportunities || []).filter(opp =>
    cachedTerms.includes(opp.searchTerm) && !isExpired(opp, config.cacheOpportunityDays || 30)
  )

  const commands = freshTerms.map(term => {
    const encoded = encodeURIComponent(term)
    return `curl -s "https://itunes.apple.com/search?term=${encoded}&entity=software&limit=200&country=us"`
  })

  return { commands, cachedOpps, freshTerms }
}

/**
 * Build curl commands to fetch App Store reviews for candidate apps.
 * Best-effort: the RSS endpoint is legacy/unstable.
 *
 * @param {number[]} candidateAppIds - Up to 5 app IDs to fetch reviews for
 * @returns {string[]} curl commands
 */
export function buildReviewCommands(candidateAppIds) {
  const maxReviews = 5
  return candidateAppIds.slice(0, maxReviews).map(appId =>
    `curl -s "https://itunes.apple.com/rss/customerreviews/id=${appId}/sortBy=mostRecent/json"`
  )
}

/**
 * Parse the agent's response to extract validated App Store opportunities.
 * Implements 3-level fallback matching existing scout conventions.
 *
 * @param {string} response - Agent response text
 * @returns {Object[]|null} Validated opportunities array or null
 */
export function parseAppStoreResponse(response) {
  const parsed = extractJSON(response)
  if (!parsed) return null

  const opportunities = parsed.opportunities || parsed
  if (!Array.isArray(opportunities)) return null

  // Validate and filter
  return opportunities.filter(opp => {
    const required = ['appId', 'appName', 'mcpFitScore', 'mcpOpportunity']
    const hasRequired = required.every(field => opp[field] != null)
    if (!hasRequired) return false

    // Enforce score ranges
    if (typeof opp.mcpFitScore !== 'number' || opp.mcpFitScore < 1 || opp.mcpFitScore > 5) return false

    return true
  }).map(opp => ({
    appId: opp.appId,
    appName: opp.appName,
    genre: opp.genre || null,
    allTimeRating: opp.allTimeRating ?? null,
    recentAvgRating: opp.recentAvgRating ?? null,
    ratingDrift: opp.ratingDrift ?? null,
    ratingCount: opp.ratingCount ?? null,
    monthsAbandoned: opp.monthsAbandoned ?? null,
    complaints: Array.isArray(opp.complaints) ? opp.complaints : [],
    mcpFitScore: opp.mcpFitScore,
    mcpOpportunity: opp.mcpOpportunity,
    searchTerm: opp.searchTerm || null,
    discoveredAt: new Date().toISOString(),
    usedInCycleId: null
  }))
}

/**
 * Build the agent message section for App Store scouting.
 * Parallel to redditSection/hnSection in scout.js.
 *
 * @param {string[]} commands - curl commands for iTunes Search API
 * @param {string[]} freshTerms - which terms are being fetched
 * @param {Object[]} cachedOpps - previously cached opportunities
 * @param {string[]} reviewCommands - curl commands for review RSS (may be empty)
 * @param {Object} config - appStore config
 * @returns {string} Message section for the agent
 */
export function buildAppStoreSection(commands, freshTerms, cachedOpps, reviewCommands, config) {
  const minRatingCount = config.minRatingCount || 200
  const minMonthsAbandoned = config.minMonthsAbandoned || 18
  const maxDistressRating = config.maxDistressRating || 3.2

  let section = `### iOS App Store

Search the App Store for abandoned or failing apps whose underlying need maps to an MCP tool.

**Fetch app data** using the iTunes Search API:

${commands.map((cmd, i) => `${i + 1}. Term "${freshTerms[i]}": \`${cmd}\``).join('\n')}

Each response has \`results[]\` with: \`trackId, trackName, averageUserRating, userRatingCount, currentVersionReleaseDate, primaryGenreName, description, price\`.

**Opportunity detection (Tier 1 — metadata only):**
- Abandoned + demand: last update >= ${minMonthsAbandoned} months ago AND ratingCount >= ${minRatingCount}
- Actively failing: rating < ${maxDistressRating} AND ratingCount >= ${minRatingCount}
- Only include apps where the underlying need fits an MCP tool (scaffold_fit >= 3)

**MCP fit criteria** (score 1-5):
- 5: Pure CRUD with KV (driving hours log, collection catalog, checkbook register)
- 4: CRUD + free external API (Discogs client, TMDB recommender, public data lookups)
- 3: Core fits but secondary features don't translate (charts, visual calendars)
- 2: Needs UI that can't replicate in chat (diagramming, route mapping)
- 1: Fundamentally visual/auditory (games, media editors, GPS navigation)

Only surface opportunities with scaffold_fit >= 3.`

  if (reviewCommands.length > 0) {
    section += `

**Tier 2 enrichment (best-effort)** — fetch recent reviews for top candidates:

${reviewCommands.map((cmd, i) => `${i + 1}. \`${cmd}\``).join('\n')}

Review response: \`feed.entry[]\` — entry[0] is app metadata, reviews start at entry[1].
Each review has \`im:rating.label\` (1-5) and \`content.label\` (review text).

If the reviews endpoint returns 404 or fails, proceed with Tier 1 data alone.
Calculate rating drift: allTimeRating vs average of recent review ratings.
Extract top complaints from review text.`
  }

  if (cachedOpps.length > 0) {
    section += `

**Previously found opportunities (cached, do not re-analyze):**
${cachedOpps.map(o => `- ${o.appName} (ID: ${o.appId}, fit: ${o.mcpFitScore}/5): ${o.mcpOpportunity}`).join('\n')}`
  }

  section += `

**Output format for App Store opportunities:**

\`\`\`json
{
  "opportunities": [
    {
      "appId": 699534935,
      "appName": "RoadReady",
      "genre": "Education",
      "allTimeRating": 2.08,
      "recentAvgRating": null,
      "ratingDrift": null,
      "ratingCount": 3282,
      "monthsAbandoned": 25,
      "complaints": [],
      "mcpFitScore": 5,
      "mcpOpportunity": "Student driving hours log: tools for log-drive, get-total-hours, export-summary",
      "searchTerm": "driving log"
    }
  ]
}
\`\`\`

Fields \`recentAvgRating\`, \`ratingDrift\`, and \`complaints\` are nullable (reviews may fail).
Include the search term that found each app.`

  return section
}

// --- Internal helpers ---

function extractJSON(response) {
  // Level 1: ```json block
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim())
    } catch { /* fall through */ }
  }

  // Level 2: bare JSON object with opportunities key
  const objMatch = response.match(/\{\s*"opportunities"\s*:\s*\[[\s\S]*?\]\s*\}/)
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0])
    } catch { /* fall through */ }
  }

  // Level 3: bare JSON array
  const arrayMatch = response.match(/\[\s*\{[\s\S]*?\}\s*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0])
    } catch { /* fall through */ }
  }

  return null
}

function isExpired(opportunity, maxDays) {
  if (!opportunity.discoveredAt) return true
  const age = Date.now() - new Date(opportunity.discoveredAt).getTime()
  return age > maxDays * 24 * 60 * 60 * 1000
}

export default {
  DEFAULT_TERMS,
  buildAppStoreCommands,
  buildReviewCommands,
  parseAppStoreResponse,
  buildAppStoreSection
}
