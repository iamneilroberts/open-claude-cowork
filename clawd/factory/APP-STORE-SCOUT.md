# App Store Opportunity Finder

A scout data source that scans the iOS App Store for failing or abandoned apps whose underlying need maps to an MCP tool. Runs alongside the existing Reddit/HN sources.

## Commands

```
/scout appstore          — Run App Store scan (uses cache for fresh terms)
/scout appstore cache    — View cached opportunities
/scout appstore refresh  — Force re-scan all terms, ignoring cache
/scout                   — Normal scout run (includes App Store if enabled in config)
```

## Enabling

App Store scouting is opt-in. Enable it in factory config:

```json
{
  "scoutSources": {
    "appStore": {
      "enabled": true
    }
  }
}
```

Or edit config directly: `/factory config` shows current settings.

## How It Works

### Data Sources

**Primary — iTunes Search API** (always available):
```
https://itunes.apple.com/search?term={term}&entity=software&limit=200&country=us
```
Returns app metadata: name, rating, rating count, last update date, genre, description, price.

**Secondary — App Store Reviews RSS** (best-effort):
```
https://itunes.apple.com/rss/customerreviews/id={appId}/sortBy=mostRecent/json
```
Returns recent reviews with ratings and text. This is a legacy endpoint — if it fails, the opportunity still qualifies on metadata alone.

### Opportunity Detection

**Tier 1** (metadata only — always available):
- Abandoned + demand: last update >= 18 months ago AND rating count >= 200
- Actively failing: rating < 3.2 AND rating count >= 200

**Tier 2** (review enrichment — best-effort):
- Rating drift: all-time rating >= 4.0 but recent reviews average < 3.0
- Top complaints extracted from review text

### MCP Fit Filter

Only surfaces ideas where the underlying need fits scaffold. Uses `scaffold_fit` score (1-5):

| Score | Meaning | Examples |
|-------|---------|----------|
| 5 | Pure CRUD with KV | Driving hours log, collection catalog, checkbook register |
| 4 | CRUD + free external API | Discogs client, TMDB recommender |
| 3 | Core fits, secondary features don't | Apps with charts, visual calendars |
| 2 | Needs non-chat UI | Diagramming, route mapping |
| 1 | Fundamentally visual/auditory | Games, media editors |

**Only score >= 3 is eligible.**

## Search Terms

20 default terms targeting MCP-feasible categories:

driving log, habit tracker, checkbook register, flashcard maker, symptom diary, pet health tracker, book reading log, workout log, meal planner, grocery list, budget tracker, wine journal, plant care tracker, medication reminder log, daily journal, collection catalog, contacts manager simple, time tracker freelance, recipe box, fishing log

Override in config:
```json
{
  "scoutSources": {
    "appStore": {
      "enabled": true,
      "searchTerms": ["my custom term", "another term"]
    }
  }
}
```

## Caching

Cache lives at `~/clawd/factory/app-store-cache.json`.

- Search terms fresh within 7 days are skipped (cached results used)
- Opportunities expire after 30 days
- Max 10 fresh terms per scan cycle (~10 API calls)
- Max 5 review fetches per cycle
- `usedInCycleId` tracks which opportunities have been picked

Cache writes are atomic (temp file + rename) to prevent corruption from interruptions.

### Cache Tuning

```json
{
  "scoutSources": {
    "appStore": {
      "cacheTermDays": 7,
      "cacheOpportunityDays": 30,
      "minRatingCount": 200,
      "minMonthsAbandoned": 18,
      "maxDistressRating": 3.2
    }
  }
}
```

## Architecture

Key boundary: **the agent analyzes, JS persists.** The agent runs curl commands and returns structured JSON. JavaScript validates the schema and writes the cache atomically. This prevents malformed JSON from corrupting the cache.

```
Agent (curl + analysis)  →  JSON response  →  parseAppStoreResponse()  →  validate  →  atomic write
```

### Files

| File | Role |
|------|------|
| `stages/app-store-scout.js` | buildAppStoreCommands, buildReviewCommands, parseAppStoreResponse, buildAppStoreSection |
| `stages/scout.js` | Orchestrates all sources; calls app-store-scout functions |
| `store.js` | getAppStoreCache, updateAppStoreCache (atomic write) |
| `prompts/scout.md` | scaffold_fit rubric, App Store source guidance |
| `commands/factory-handler.js` | /scout appstore command routing |
