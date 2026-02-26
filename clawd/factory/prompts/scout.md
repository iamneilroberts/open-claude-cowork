# Scout Evaluation Criteria

You are scouting for MCP tool app ideas. An MCP (Model Context Protocol) tool app is a lightweight server that provides tools to an AI assistant via the MCP protocol. Each tool is a function the AI can call to perform actions.

## What Makes a Good MCP Tool App

### Must Have
- **Single domain focus**: One clear problem area (e.g., notes, recipes, bookmarks — not "productivity suite")
- **KV storage fit**: Data can be stored as key-value pairs (not relational joins, not streaming data)
- **Chat-native UX**: The tool enhances conversation naturally (user says something, tool does something useful)
- **Stateful**: Needs to persist data across conversations (not just a calculator or formatter)
- **No paid APIs or complex auth**: Avoid apps requiring paid API keys or OAuth flows. Free public APIs (Discogs, TMDB, Wikipedia, public data) are encouraged — they enable richer tools

### Should Have
- **Clear CRUD pattern**: Create, Read, Update, Delete operations map naturally
- **User isolation**: Data is per-user (multi-tenant by design)
- **3-7 tools**: Enough to be useful, not so many it's overwhelming
- **Obvious value**: "Oh, that would be useful" reaction

### Avoid
- Apps that need real-time data feeds (stock prices, weather)
- Apps requiring paid APIs or complex auth flows (OAuth, paid API keys)
- Apps that duplicate existing scaffold examples: notes, travel planning, BBQ tracker, local guides, watch recommender
- Apps that are really just thin wrappers around a single API with no user-owned state
- Apps that need media/file storage (images, videos, documents)

## Scoring Rubric

### Feasibility (1-5)
- 5: Could build in 1-2 hours, straightforward CRUD with KV
- 4: Buildable with minor complexity (some business logic)
- 3: Moderate complexity, might need careful data modeling
- 2: Significant complexity, unclear if KV is sufficient
- 1: Would require external services, complex infrastructure

### MCP-Fit (1-5)
- 5: Perfect for chat — natural language in, structured action out
- 4: Good fit — most interactions work well in chat
- 3: Decent fit — some operations feel clunky in chat
- 2: Poor fit — would be better as a GUI app
- 1: Terrible fit — chat is the wrong interface

### Demand Signal (1-5)
- 5: Multiple people expressing strong frustration or need, "I'd pay for this"
- 4: Clear demand from several posts, "I wish I had..."
- 3: Some interest, a few people mentioning the need
- 2: Niche interest, one or two mentions
- 1: No clear demand, just an idea

### Uniqueness (1-5)
- 5: Novel concept, nothing like it exists as an MCP tool
- 4: Exists in other forms but not as MCP/chat tool
- 3: Similar things exist but this has a unique angle
- 2: Close to existing tools with minor differentiation
- 1: Direct duplicate of existing scaffold app

### Scaffold Fit (1-5)

How well does the underlying need map to an MCP tool built on the scaffold framework?

- 5: Pure CRUD with KV storage — driving hours log, collection catalog, checkbook register, reading log
- 4: CRUD + free external API enrichment — Discogs-powered music catalog, TMDB-powered recommender, public data lookups
- 3: Core need fits but secondary features don't translate well — apps with charts, visual calendars, or dashboards (chat can do the data, not the visualization)
- 2: Underlying need requires UI that can't replicate in chat — play diagramming, route mapping, visual scheduling
- 1: Fundamentally visual/auditory — games, media editors, GPS navigation, music players

**Ideas with scaffold_fit < 3 are not eligible regardless of other scores.**

Free external APIs (Discogs, TMDB, Wikipedia, OpenLibrary, etc.) are a plus, not a penalty — they enable richer, more useful tools.

## Source-Specific Guidance

### App Store Source
When ideas come from the iOS App Store:
- The **sourceQuote** should be the top user complaint from reviews (if reviews are available), or a representative line from the app description if reviews are unavailable
- The **sourceUrl** should be the App Store listing URL: `https://apps.apple.com/us/app/id{trackId}`
- Note the app's rating count and last update date as evidence of demand + abandonment
