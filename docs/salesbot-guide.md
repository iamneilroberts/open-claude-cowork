# Voygent Salesbot User Guide

The salesbot is an AI-powered influencer outreach agent built into Clawd. It autonomously researches travel creators on YouTube and Instagram, drafts personalized outreach emails offering free Voygent Pro accounts with referral links, and manages a full sales pipeline — with human-in-the-loop approval before any email is sent.

The goal: grow Voygent through travel influencer partnerships by finding creators, pitching them on becoming affiliates, and tracking the referral pipeline from first contact to conversion.

## Quick Start

### 1. Enable in config

In `clawd/config.js`, the salesbot block should have `enabled: true` (it is by default).

### 2. Set notification target

You need to tell the salesbot where to send approval requests. Set `notifyPlatform` and `notifyChatId`:

```js
salesbot: {
  enabled: true,
  notifyPlatform: 'telegram',  // or 'whatsapp', 'signal', 'imessage'
  notifyChatId: 'YOUR_CHAT_ID',
  // ...
}
```

Without `notifyChatId`, cron jobs won't schedule and you won't get approval notifications.

### 3. Connect Composio Gmail MCP

The salesbot sends emails via Composio's Gmail integration. Make sure the Composio Gmail MCP server is connected in your Clawd MCP config so the agent can actually send approved emails.

### 4. First run

Start Clawd and open the salesbot dashboard:

```
clawd sales
```

Or from the main Clawd menu, select option 5 ("Salesbot dashboard").

On first run the database is created at `~/.clawd/salesbot/pipeline.db` with default guardrails seeded. The cron jobs will start running on schedule. You'll get your first approval request on Telegram (or your configured platform) when the research cron fires.

## Configuration Reference

All options live in the `salesbot` block of `clawd/config.js`:

```js
salesbot: {
  enabled: true,
  workspace: '~/.clawd/salesbot',
  maxEmailsPerDay: 10,
  cooldownDays: 14,
  maxDraftsPerBatch: 5,
  notifyPlatform: 'telegram',    // telegram | whatsapp | signal | imessage
  notifyChatId: '',               // your chat ID on the chosen platform
  emailAlias: '',                 // optional sender alias for outreach emails
  goals: {
    affiliatesPerWeek: 5,
    referralsPerMonth: 20,
    freeTrialsPerMonth: 50,
    subscriptionsPerMonth: 10
  },
  targetNiches: [
    'travel vlog',
    'budget travel',
    'luxury travel',
    'adventure travel',
    'digital nomad'
  ],
  minSubscribers: 1000,
  maxSubscribers: 500000,
  referralTiers: {
    standard: { threshold: 0, referrerMonths: 1, refereeMonths: 1 },
    silver:   { threshold: 5, referrerMonths: 2, refereeMonths: 1 },
    gold:     { threshold: 15, referrerMonths: 3, refereeMonths: 2 },
    platinum: { threshold: 30, referrerMonths: 6, refereeMonths: 3 }
  },
  cron: {
    research: '0 10 * * 1,3,5',   // Mon/Wed/Fri at 10am
    followUp: '0 14 * * 2,4',     // Tue/Thu at 2pm
    report:   '0 9 * * 1'         // Monday at 9am
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Master switch for the salesbot |
| `workspace` | `~/.clawd/salesbot` | Directory for salesbot data |
| `maxEmailsPerDay` | `10` | Hard cap on emails sent per day |
| `cooldownDays` | `14` | Minimum days between contacting the same prospect |
| `maxDraftsPerBatch` | `5` | Max drafts that can be pending at once |
| `notifyPlatform` | `'telegram'` | Where approval requests are sent |
| `notifyChatId` | `''` | Your chat ID on the notification platform |
| `emailAlias` | `''` | Optional sender alias |
| `goals` | See above | Target metrics for the pipeline |
| `targetNiches` | 5 travel niches | What types of creators to look for |
| `minSubscribers` | `1000` | Minimum subscriber count to target |
| `maxSubscribers` | `500000` | Maximum subscriber count to target |
| `referralTiers` | 4 tiers | Referral code reward structure |
| `cron.research` | MWF 10am | When to run research sessions |
| `cron.followUp` | Tue/Thu 2pm | When to run follow-up sessions |
| `cron.report` | Monday 9am | When to send weekly report |

## Pipeline Stages

Every prospect moves through these stages:

```
researched → drafted → pending_approval → approved → sent → responded → converted
                                        ↘ rejected ↙          ↘ rejected
                                            ↓
                                        researched (recycle)
```

| Stage | Meaning | What triggers it |
|-------|---------|-----------------|
| `researched` | Prospect identified and added to pipeline | Agent finds a creator and calls `add_prospect` |
| `drafted` | Outreach email written | Agent calls `save_draft` for the prospect |
| `pending_approval` | Draft submitted, waiting for you | Agent calls `submit_for_approval` — you get a notification |
| `approved` | You approved the draft | You send `/approve <id>` |
| `rejected` | You rejected the draft | You send `/reject <id>` — prospect can be recycled to `researched` |
| `sent` | Email actually sent via Gmail | Agent calls `record_send` after Composio Gmail sends it |
| `responded` | Creator replied | Agent updates after detecting a response |
| `converted` | Creator signed up as affiliate | Final success state |

Valid transitions are enforced by the database layer. You can't skip stages.

## Commands

### Chat commands (Telegram/WhatsApp/etc.)

```
/approve <id>              Approve outreach draft #id for sending
/reject <id> [feedback]    Reject draft #id, optionally with feedback for the agent
/pipeline                  Show pipeline summary (stages, counts, guardrails)
/sales                     Alias for /pipeline
```

### CLI

```
clawd sales                Open the salesbot dashboard
clawd salesbot             Alias for clawd sales
```

## CLI Dashboard

Run `clawd sales` to get an interactive menu with 6 options:

### 1. View pipeline

Shows prospect counts broken down by stage. Lists up to 5 prospects per stage with their name and details.

### 2. Review pending approvals

Lists all drafts with `pending_approval` status. Shows the subject line and body preview for each, along with the prospect info. You can approve or reject from here.

### 3. View metrics & goals

Shows:
- Pipeline breakdown (how many prospects at each stage)
- Email counts (sent today, total sent)
- Goal progress (current vs target for each metric)
- Referral code stats

### 4. Manage guardrails

Displays current guardrail values:
- `max_emails_per_day` (default: 10)
- `cooldown_days` (default: 14)
- `max_drafts_per_batch` (default: 5)

You can update any guardrail by entering `key=value` (e.g., `max_emails_per_day=15`).

### 5. View activity log

Shows the last 20 activity log entries with timestamps, actions, and details.

### 6. Back

Returns to the main Clawd menu.

## How Outreach Works

End-to-end flow of a research session:

1. **Cron triggers** — On Mon/Wed/Fri at 10am, the research cron fires and sends the agent a message: "Find 3-5 new travel influencers, add them to the pipeline, and draft outreach emails."

2. **Agent checks guardrails** — Before doing anything, the agent calls `check_guardrails` to verify it hasn't hit daily send limits or draft batch limits.

3. **Agent searches for creators** — Uses YouTube/Instagram search to find travel creators matching the configured `targetNiches` and subscriber range (`minSubscribers` to `maxSubscribers`).

4. **Duplicate check** — For each candidate, calls `check_duplicate` with their email to avoid contacting someone already in the pipeline.

5. **Add to pipeline** — Calls `add_prospect` with the creator's details (name, email, platform, channel URL, subscriber count, niche, notes). Prospect enters `researched` stage.

6. **Draft outreach email** — Calls `save_draft` with a personalized email. The agent is instructed to:
   - Keep it under 150 words
   - Reference specific content the creator has made
   - Use genuine, non-corporate tone
   - Mention Voygent Pro free account + referral link
   - Prospect advances to `drafted` stage.

7. **Submit for approval** — Calls `submit_for_approval`. This:
   - Sets the draft status to `pending_approval`
   - Advances the prospect to `pending_approval`
   - Sends you a notification on Telegram/WhatsApp with the full draft and `/approve`/`/reject` instructions

8. **You review** — You see the notification with the prospect details and draft. You reply with `/approve <id>` or `/reject <id> [feedback]`.

9. **Agent sends** — If approved, the agent sends the email via Composio Gmail MCP, then calls `record_send` to log it. Prospect moves to `sent`.

10. **Track responses** — On Tue/Thu follow-up sessions, the agent checks for responses and follows up on non-responses past the cooldown period.

## Guardrails & Safety

The salesbot has three guardrails that are checked before every draft and send operation:

| Guardrail | Default | Purpose |
|-----------|---------|---------|
| `max_emails_per_day` | 10 | Hard cap on daily sends |
| `cooldown_days` | 14 | Min days between contacting the same person |
| `max_drafts_per_batch` | 5 | Max drafts in pending state at once |

The agent's system prompt includes a critical rule: **ALWAYS check guardrails before creating drafts or sending emails.** The `check_guardrails` tool returns `canSendMore` and `canDraftMore` booleans that the agent must respect.

Additional safety measures:
- **No email is ever sent without explicit owner approval.** The approval flow via `/approve` is mandatory — the agent cannot bypass it.
- **All actions are logged** to the `activity_log` table with timestamps, making every operation auditable.
- **Stage transitions are validated** — the database enforces valid transitions so prospects can't skip from `researched` to `sent`.
- **Duplicate detection** prevents contacting someone already in the pipeline.

Guardrails can be adjusted via the CLI dashboard ("Manage guardrails") or directly in the database.

## Referral Codes

When a prospect becomes an affiliate, the agent generates a referral code using `generate_referral_code`.

### Code format

```
VYG-XXXXXXXX
```

Eight random hex characters prefixed with `VYG-`.

### Tier system

Tiers are based on the number of successful referrals the affiliate has generated:

| Tier | Threshold | Free months (referrer) | Free months (referee) |
|------|-----------|----------------------|---------------------|
| Standard | 0 referrals | 1 | 1 |
| Silver | 5+ referrals | 2 | 1 |
| Gold | 15+ referrals | 3 | 2 |
| Platinum | 30+ referrals | 6 | 3 |

Each referral code tracks its `referral_count`. As affiliates hit thresholds, they can be upgraded to higher tiers with better rewards. Use `get_referral_stats` to check any code's current stats.

## MCP Tools Reference

The salesbot exposes 15 tools via its MCP server, all prefixed with `mcp__sales__`:

| Tool | Description |
|------|-------------|
| `add_prospect` | Add a new prospect after research. Checks for duplicates. |
| `update_prospect` | Update prospect info (not stage — that's enforced by transitions). |
| `query_prospects` | Filter prospects by stage, platform, niche. Supports pagination. |
| `get_prospect` | Full prospect details including drafts and recent activity. |
| `save_draft` | Save an outreach email draft. Checks `canDraftMore` guardrail. Auto-advances to `drafted`. |
| `submit_for_approval` | Submit draft for owner review. Sends notification. Advances to `pending_approval`. |
| `get_pending_approvals` | List all drafts awaiting approval, joined with prospect info. |
| `record_send` | Log that an approved email was sent via Gmail. Advances to `sent`. |
| `generate_referral_code` | Create a `VYG-XXXXXXXX` code for a prospect with a tier. |
| `get_referral_stats` | Look up referral count and tier for a code. |
| `check_guardrails` | Returns current limits and `canSendMore`/`canDraftMore` booleans. |
| `check_duplicate` | Check if an email already exists in the pipeline. |
| `get_metrics` | Pipeline breakdown, email stats, goal progress, referral stats. |
| `set_goal` | Set/update a goal (affiliates, referrals, page_visits, free_trials, subscriptions, revenue). |
| `get_activity_log` | Recent activity entries, optionally filtered by prospect. |

## Database

SQLite database at `~/.clawd/salesbot/pipeline.db`. Uses WAL mode with foreign keys enabled.

### Tables

| Table | Purpose |
|-------|---------|
| `prospects` | All prospects with stage, contact info, platform, subscriber count, niche, referral code, cooldown |
| `outreach_drafts` | Email drafts linked to prospects. Tracks version, status, and owner feedback |
| `referral_codes` | Generated codes with tier, referral count, and prospect link |
| `activity_log` | Timestamped log of all actions (prospect adds, stage changes, sends, etc.) |
| `goals` | Target metrics with current progress and period tracking |
| `guardrails` | Key-value store for runtime limits (max emails/day, cooldown, max drafts) |

### Indexes

- `idx_prospects_stage` — fast lookup by pipeline stage
- `idx_prospects_email` — fast duplicate checking
- `idx_drafts_status` — fast pending approval queries
- `idx_drafts_prospect` — drafts by prospect
- `idx_activity_prospect` — activity by prospect
- `idx_activity_created` — activity by date

Data persists across sessions. The database is created on first run and closed cleanly on gateway shutdown.
