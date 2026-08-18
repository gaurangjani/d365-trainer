# D365 Trainer — Live Microsoft Learn Grounded Training Guides (OpenRouter + custom MCP client)

A single-page tool: type a Dynamics 365 Finance & Operations task or question — e.g. "Post an
approved expense report" — and get back a structured training guide (context, functionality,
step-by-step navigation, understanding check, tips, and Microsoft Learn references).

This app **actually searches Microsoft Learn live** before answering. Instead of using a
provider-specific connector, it implements a minimal MCP (Model Context Protocol) client itself
— see `lib/mcpClient.ts` — that talks directly to the official, public Microsoft Learn MCP server
(`https://learn.microsoft.com/api/mcp`, no auth required). The app runs its own tool-calling loop:
ask the model via OpenRouter → if it wants to search/fetch docs, call the real MCP server → feed
the real results back → repeat until the model has enough to answer → return the final guide, only
citing URLs actually retrieved.

This keeps you on OpenRouter (any tool-calling-capable model, your choice of pricing) instead of
being tied to a single provider's built-in MCP connector.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- `lib/mcpClient.ts` — hand-rolled MCP client over Streamable HTTP (JSON-RPC 2.0), following the
  Microsoft Learn MCP server's own "build a custom client" guidance: tools are discovered
  dynamically via `tools/list`, never hardcoded, so this keeps working if Microsoft changes tool
  names or schemas.
- `app/api/train/route.ts` — orchestrates the loop: OpenRouter chat completion (OpenAI-style
  `tools`/`tool_calls`) ↔ real MCP tool calls, up to 6 rounds, then returns the final answer.
- No database, no auth beyond your OpenRouter key, no other integrations.

## 1. Push to GitHub

```bash
cd d365-trainer
git init
git add .
git commit -m "Initial commit: D365 Trainer (OpenRouter + custom MCP client)"
gh repo create d365-trainer --public --source=. --remote=origin --push
```

(Or create an empty repo on github.com and `git remote add origin <url>` then `git push -u origin main`.)

## 2. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
2. Framework preset: Vercel auto-detects **Next.js** — no changes needed.
3. Add these **Environment Variables** in Vercel → Project → Settings → Environment Variables:

   | Name | Value | Required |
   |---|---|---|
   | `OPENROUTER_API_KEY` | your key from [openrouter.ai/keys](https://openrouter.ai/keys) | Yes |
   | `OPENROUTER_MODEL` | must support tool/function calling, e.g. `anthropic/claude-3.5-sonnet`, `openai/gpt-4o` (default if unset: `anthropic/claude-3.5-sonnet`) | No |
   | `SITE_URL` | cosmetic only | No |

4. Deploy.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in OPENROUTER_API_KEY
npm run dev
```

Visit http://localhost:3000.

## How the grounding works

1. On each request, the server connects to the Microsoft Learn MCP server and calls `tools/list`
   to discover the current tools (typically `microsoft_docs_search` and `microsoft_docs_fetch`) —
   never hardcoded, so it adapts if Microsoft adds/changes tools.
2. Those tools are converted into OpenAI-style function-calling `tools` and sent to OpenRouter
   along with your question.
3. If the model requests a tool call, the app calls the **real** Microsoft Learn MCP server (not a
   simulation), gets the actual search/fetch result, and feeds it back to the model as a `tool`
   message. This repeats for up to 6 rounds.
4. Once the model stops requesting tools, its final message is the structured guide. Any
   `contentUrl` values found in the raw search results are surfaced separately as
   "Sources consulted" — so the reference list reflects what was actually retrieved, not what the
   model claims it retrieved.

## Notes on model choice

`OPENROUTER_MODEL` must be a model OpenRouter serves with OpenAI-compatible tool/function calling
support (most frontier chat models qualify — Claude, GPT-4o/4.1, Gemini, etc.). If a model doesn't
support tool calling, it will just answer from memory without ever calling `tools/list`/`tools/call`
— no error, just no grounding — so pick a model known to support tools if you change the default.

## Notes

- Runtime: this can take longer than a plain chat completion since it involves several real
  network round trips (MCP server + OpenRouter, possibly repeated). `maxDuration` is set to 60s;
  if you're on Vercel Pro and see timeouts on complex questions, raise it (Pro allows up to 300s
  for Node functions).
- The MCP client in `lib/mcpClient.ts` is intentionally minimal (no persistent session reuse
  across requests, no server-push streaming) — sufficient for this search-then-answer flow, but
  not a general-purpose MCP SDK.
- No data is stored; each request is stateless.
