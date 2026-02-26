# Salesbot User Guide — Session Prompt

Write a user guide document for the Voygent Salesbot at `docs/salesbot-guide.md` in `/home/neil/dev/open-claude-cowork`. The salesbot code lives in `clawd/salesbot/` on the `feature/salesbot-referral` branch (worktree at `.worktrees/salesbot/`). Read the actual source files to verify details before writing.

**What the salesbot is:** An AI-powered influencer outreach agent built into Clawd (the Voygent operations bot). It autonomously researches travel creators on YouTube/Instagram, drafts personalized outreach emails offering free Voygent Pro accounts + referral links, and manages a full sales pipeline — all with human-in-the-loop approval before any email is sent.

**Document structure — cover these sections:**

1. **Overview** — What it does, why it exists (grow Voygent through travel influencer partnerships), how it fits into Clawd

2. **Quick Start** — Minimum config to get running: enable in config, set `notifyPlatform` + `notifyChatId`, ensure Composio Gmail MCP is connected. First run walkthrough.

3. **Configuration Reference** — All config options from `clawd/config.js` salesbot block: `enabled`, `workspace`, `maxEmailsPerDay`, `cooldownDays`, `maxDraftsPerBatch`, `notifyPlatform` (telegram/whatsapp/signal/imessage), `notifyChatId`, `emailAlias`, `goals` (affiliatesPerWeek, referralsPerMonth, etc.), `targetNiches`, `minSubscribers`/`maxSubscribers`, `referralTiers` (standard/silver/gold/platinum with thresholds and free month amounts), `cron` schedules (research MWF 10am, follow-up Tue/Thu 2pm, report Monday 9am)

4. **Pipeline Stages** — The full lifecycle: researched → drafted → pending_approval → approved → sent → responded → converted → rejected. What each stage means and what triggers transitions.

5. **Commands** — `/approve <id>`, `/reject <id> [feedback]`, `/pipeline` (alias `/sales`). Also the CLI dashboard via `clawd sales`.

6. **CLI Dashboard** — The 6 interactive menus: view pipeline, review pending approvals, view metrics & goals, manage guardrails, view activity log, back.

7. **How Outreach Works** — End-to-end flow: cron triggers research session → agent searches for creators → checks duplicates → adds to pipeline → drafts personalized email (under 150 words, references specific content, genuine tone) → submits for approval → owner gets notification on Telegram/WhatsApp → owner approves/rejects → agent sends via Composio Gmail → records send → tracks responses

8. **Guardrails & Safety** — Max emails/day (default 10), cooldown between contacts (14 days), max pending drafts (5). Agent MUST check guardrails before drafting/sending. All actions logged to activity_log. No email ever sent without explicit owner approval.

9. **Referral Codes** — Auto-generated VYG-XXXXXXXX codes. Tiered system: standard (0 referrals, 1/1 free months), silver (5+, 2/1), gold (15+, 3/2), platinum (30+, 6/3). Tracks referral counts per code.

10. **MCP Tools Reference** — Brief table of all 15 tools: add_prospect, update_prospect, query_prospects, get_prospect, save_draft, submit_for_approval, get_pending_approvals, record_send, generate_referral_code, get_referral_stats, check_guardrails, check_duplicate, get_metrics, set_goal, get_activity_log

11. **Database** — SQLite at `~/.clawd/salesbot/sales.db`. 6 tables: prospects, outreach_drafts, referral_codes, activity_log, goals, guardrails. Data persists across sessions.

**Tone:** Practical, concise, aimed at the product owner (me) who operates the bot day-to-day. Not marketing copy — a real reference doc. Use code blocks for config examples and command syntax.
