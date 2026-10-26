# PatchPilot

Evidence-checked AI code review. Paste a unified diff or source file, get structured findings whose quoted evidence is verified against your code, ask follow-ups, generate focused test suggestions, and export a Markdown review report.

Built for the **OpenFire Hackathon** (Alan + open models).

## What works

- **Live open-model review** through the Alan harness (`deepseek/deepseek-v4.1-flash`, MIT-licensed open weights) with a server-side key.
- **Evidence verification**: every finding must quote a verbatim excerpt from the submission. Line numbers are recomputed from the parsed diff or source; unsupported findings are dropped.
- **Structured output** validated with Zod. Malformed JSON gets one bounded repair attempt; truncated output is surfaced as a recoverable error and never shown as a partial review.
- **Findings UI** grouped by Critical, High, Medium, Low, and Informational, with severity filters, confidence, explanation, and suggested fix.
- **Ask** follow-up questions grounded in the submitted code and verified findings.
- **Generate Tests**: at most three bounded test suggestions (type, setup, expected result, finding covered) built from the top findings and minimal code context.
- **Markdown report** preview, copy, and download.
- **Alan MCP connector** exposing `review_diff`, `generate_tests`, and `ask_review_question` so Alan agents can call PatchPilot.
- **Sample mode** with deterministic local rules, clearly labelled, when no credentials are configured.

## Verified AI integration

Runtime reviews call the OpenAI-compatible Alan harness endpoint that Alan Code itself uses:

```
https://api.tryalan.ai/public/harness/v1/chat/completions
model: deepseek/deepseek-v4.1-flash
```

- A bounded verification request returned **HTTP 200** on 2026-10-26 with model `deepseek-v4.1-flash-fast` and 64 total tokens.
- The base model is **DeepSeek V4.1 Flash**, MIT-licensed open weights: <https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash>.
- Alan publishes no documented public app-inference API. The harness is configured locally by Alan Code and is **not advertised as a stable public API**. Treat availability as best-effort.
- Provider fallbacks: OpenRouter (default `qwen/qwen3-coder`, Apache-2.0) and any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio, Groq, Together).
- Alan agents can call PatchPilot back over MCP. In Alan: **Settings → team → Plugins → MCP → Add custom connector** and paste the deployed `/api/mcp` URL.

The UI distinguishes **Live configured** (credential present) from **Live verified** (a real model response succeeded in this browser session). Configured is never presented as proof of a successful request.

## Architecture

- Next.js App Router, React, TypeScript, Tailwind CSS.
- Route handlers: `/api/review`, `/api/ask`, `/api/tests`, `/api/status`, `/api/mcp`.
- Provider abstraction in `lib/ai/provider.ts`; configuration in `lib/ai/config.ts`.
- Prompt compression and relevant-context extraction in `lib/ai/prompts.ts` and `lib/ai/context.ts`.
- Diff parsing and evidence location in `lib/diff.ts` and `lib/evidence.ts`.
- No database, authentication, or separate backend.

## Setup

Requires Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
# fill in one provider below
pnpm dev
```

Open <http://localhost:3000>, load the bundled checkout diff, and run a review.

### Provider environment variables

All credentials are server-side. Never expose them with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `PATCHPILOT_PROVIDER` | `alan`, `openrouter`, `openai-compatible`, or `demo` |
| `ALAN_API_KEY` | Durable Alan harness key (required for deployment) |
| `ALAN_MODEL` | Defaults to `deepseek/deepseek-v4.1-flash` |
| `ALAN_BASE_URL` | Defaults to `https://api.tryalan.ai/public/harness/v1` |
| `ALAN_CONVERSATION_ID` | Optional harness header |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | OpenRouter fallback |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | Any OpenAI-compatible endpoint |
| `PATCHPILOT_MAX_INPUT_CHARS` | Max submission size (default 60000) |
| `PATCHPILOT_MAX_PROMPT_CHARS` | Max submission characters per prompt (default 24000) |
| `PATCHPILOT_MAX_OUTPUT_TOKENS` | Response budget (default 2400; provider allows 32768 for this model) |
| `PATCHPILOT_TIMEOUT_MS` | One upstream attempt (default 35000) |
| `PATCHPILOT_DEADLINE_MS` | Whole request budget (default 45000) |
| `PATCHPILOT_MCP_TOKEN` | Required to enable `/api/mcp` in production |

For local development, `PATCHPILOT_PROVIDER=alan` falls back to the Alan Code session's `ALAN_CODE_API_KEY` when `ALAN_API_KEY` is absent. That key is session-scoped; use a durable `ALAN_API_KEY` for deployment.

## Checks

```bash
pnpm test        # Vitest
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm build       # production build
```

## Production credentials

Alan's public documentation describes **no public inference API, no API-key issuance page, and no durable harness credential**. The `api.tryalan.ai/public/harness/v1` endpoint that PatchPilot's `alan` provider uses is configured by the Alan Code desktop agent and authenticated with a **session-scoped** key. That key is not a deployable credential and is not committed or shipped here.

Alan's documented supported pattern for a durable open-model credential is **bring your own provider key**:

- In Alan: **Settings → your team → Alan Agent → Custom provider** — pick an OpenCode-supported provider and paste your own provider API key.
- In PatchPilot, point the server at a supported OpenAI-compatible endpoint with your own key.

So for a deployed PatchPilot, use one of these (all server-side):

```text
# Option A - OpenRouter (hosted open models)
PATCHPILOT_PROVIDER=openrouter
OPENROUTER_API_KEY=<your OpenRouter key>
OPENROUTER_MODEL=qwen/qwen3-coder

# Option B - any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio, Groq, Together)
PATCHPILOT_PROVIDER=openai-compatible
LLM_BASE_URL=https://<host>/v1
LLM_MODEL=<model id>
LLM_API_KEY=<your key>
```

`PATCHPILOT_PROVIDER=alan` with a durable `ALAN_API_KEY` remains supported if Alan provides you with one (for example through the hackathon team). Without a key, PatchPilot starts in **Sample mode**, clearly labelled everywhere, and makes no model request.

## Deploy to Vercel

1. Import the repository in Vercel (framework preset: Next.js, build command `pnpm build`).
2. Add the production environment variables: `PATCHPILOT_PROVIDER` (`openrouter`, `openai-compatible`, or `alan`), the matching provider key and model id, and `PATCHPILOT_MCP_TOKEN`. See "Production credentials" above.
3. Deploy, then verify `/api/status` reports `provider.kind` matching your provider and `provider.mode=live`, and run one live review.
4. For the Alan MCP connector, use `https://<your-deployment>/api/mcp` with the bearer token.

Do not claim deployment until the deployed URL has been verified.

## Security and limitations

- Submitted code is treated as untrusted text and is never executed.
- API keys stay server-side; request bodies, prompts, and model output are not logged.
- Model findings are suggestions, not verified vulnerabilities. Evidence matching proves the quote exists, not exploitability.
- Rate limiting is in-memory and per process; serverless cold starts reset it.
- The Alan harness is undocumented and may change or be unavailable.
- No database or authentication; reviews live only in the browser session.

## License

MIT. See `LICENSE`.