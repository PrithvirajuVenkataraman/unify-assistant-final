# JARVIS

JARVIS is a text-first assistant for chat, writing, planning, translation, weather, live vision, current-information lookup, and everyday tasks.

It is built as a static frontend plus Vercel-style serverless API routes. There is no frontend build step and no npm runtime dependencies.

## Tech Stack

- Frontend: plain `index.html`, `styles.css`, browser JavaScript, and small ES modules in `app/`.
- Styling: Tailwind CDN plus local CSS.
- Backend: Node.js ES modules under `api/`, designed for Vercel serverless functions.
- Local dev server: `tools/local-dev-server.mjs`, a dependency-free Node server for testing static files and `/api/*` routes locally.
- Tests: Node built-in test style with `node:assert/strict` and syntax checks through `node --check`.
- Storage: browser `localStorage` for chat history, memory, preferences, and feedback when persistence is enabled.
- Browser APIs: Web Speech API for voice-to-text, Geolocation API for location/weather flows, MediaDevices/camera APIs for Live Vision.
- External public data sources: Wikipedia API, GDELT Doc API, selected official-source shortcuts, optional Serper fallback.
- External AI providers: Groq first when configured, Gemini fallback and optional search enhancer.

## AI Models

Chat uses `/api/chat-groq`.

Groq is tried first when `GROQ_API_KEY` or `GROQ_KEY` exists:

- `GROQ_MODEL` if set
- `openai/gpt-oss-120b`
- `openai/gpt-oss-20b`
- `llama-3.3-70b-versatile`
- `llama-3.1-8b-instant`

Gemini is used as fallback when `GEMINI_API_KEY` or `GOOGLE_API_KEY` exists:

- `GEMINI_MODEL` if set
- `gemini-3.5-flash`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`
- `gemini-2.0-flash`

Additional model hooks:

- Safety classification can use `GROQ_SAFETY_MODEL`, defaulting to `openai/gpt-oss-safeguard-20b`.
- Quality review can use `GROQ_QUALITY_MODEL`, defaulting to `llama-3.1-8b-instant`.
- Gemini quality review uses `GEMINI_QUALITY_MODEL`, defaulting to `gemini-2.5-flash-lite`.
- Search enhancement uses `GEMINI_SEARCH_MODEL`, then `GEMINI_MODEL`, then `gemini-2.5-flash-lite`.
- Vision uses configured Groq/Gemini vision models with fallbacks in `api/vision.js`.

## Live Web Search

Live search is handled by `/api/search`.

## How Search Works

The search route does this:

1. Normalizes the query.
2. Optionally asks Gemini to rewrite the query into 2-4 better public-source queries.
3. Searches public sources:
   - Wikipedia search API
   - Wikipedia page summary API
   - GDELT Doc API
   - official-source shortcuts for ISRO, NASA, WHO, CDC, RBI, SEC, IMF, World Bank, NOAA, USA.gov, and GOV.UK
4. Normalizes and deduplicates results.
5. Ranks results locally by relevance, trusted domains, source type, title/domain matches, and date.
6. Optionally asks Gemini to rerank and rewrite snippets using only title, domain, date, URL, and existing snippets.
7. Falls back to Serper only if public-source results are too weak and `SERPER_API_KEY` or `SERPER_KEY` exists.
8. Returns normalized sources to chat, where `/api/chat-groq` builds a RAG context with source label, source type, freshness, date, and URL.

Gemini is not the web index. It only improves planning, ranking, and summaries for sources already found through public APIs.

## What Works

- Official-source shortcuts for known public institutions, for example ISRO and NASA.
- Wikipedia reference lookup for stable entities and background information.
- GDELT-backed news discovery for many current public news topics.
- Source metadata for RAG: source label, source type, freshness, date, trusted flag, and URL.
- Stable deterministic facts, such as country capitals, bypass live search and return immediately.
- Optional Gemini enhancement for better public-source queries and snippets.
- Optional Serper fallback if you configure it.

## What Does Not Work

- This is not Google-scale full-web search.
- It does not crawl the entire internet.
- It does not index private pages, social feeds, paywalled pages, or JavaScript-only pages.
- It cannot guarantee every latest event is found.
- GDELT coverage can miss smaller local sources or very recent pages.
- Wikipedia is not a live news source.
- Official shortcuts point to trusted official sites, but they do not scrape every page inside those sites.
- Gemini cannot create live facts by itself. It only improves handling of sources the search route already found.
- Real-time market prices and exchange rates are not enabled unless a separate provider is added.

## How Many Live Searches Work?

The app has its own API rate limits:

- `/api/search`: 60 requests per minute per server instance/IP.
- `/api/chat-groq`: 25 requests per minute per server instance/IP.
- `/api/vision`: 10 requests per minute per server instance/IP.

One `/api/search` request can fan out internally:

- Up to 5 public-source query variants.
- For each query variant, Wikipedia search and GDELT search are attempted.
- Wikipedia summary calls are made for returned Wikipedia titles.
- If Gemini is configured, search may make up to 2 Gemini calls: one for query planning and one for result enhancement.
- If Serper is configured and public results are weak, Serper may be called as fallback.

So the local app limit is 60 search requests/minute, but the practical free-for-life limit is lower if upstream public APIs throttle you. For personal use and light testing, it should work. For heavy public traffic, add caching and a shared rate limiter.

## Environment Variables

Required for AI chat:

- `GROQ_API_KEY` or `GROQ_KEY`
- or `GEMINI_API_KEY` / `GOOGLE_API_KEY`

Optional model settings:

- `GROQ_MODEL`
- `GROQ_SAFETY_MODEL`
- `GROQ_QUALITY_MODEL`
- `GEMINI_MODEL`
- `GEMINI_SEARCH_MODEL`
- `GEMINI_QUALITY_MODEL`

Optional live search settings:

- `SERPER_API_KEY` or `SERPER_KEY`, only for fallback
- `LIVE_RETRIEVAL_ENABLED=false` to explicitly disable live retrieval in chat

Security/rate limit settings:

- `CORS_ALLOWED_ORIGINS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`

## Local Testing

Install and verify:

```bash
npm ci
npm run check
```

Start the local server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

Test search directly:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/search' `
  -Method POST `
  -ContentType 'application/json' `
  -Body '{"query":"latest ISRO news","limit":3}' |
  ConvertTo-Json -Depth 8
```

Test Gemini enhancement:

```powershell
$env:GEMINI_API_KEY="your_key_here"
npm run dev
```

Then call `/api/search` again. A successful enhancement returns:

```json
{ "geminiEnhanced": true }
```

## Main Features

- Text chat and explanations
- Writing, summaries, and planning
- Response styles: balanced, witty, chatty, supportive, debate
- Custom reply instructions
- Voice-to-text input
- Live Vision for camera-based questions
- Weather and location help
- Translation mode
- Travel and budget planning
- Local memory and chat history
- Selection helper for explain, verify, rewrite, translate, and follow-up questions
- Regeneration, interruption, feedback, and local preference learning
- Public-source live search with citations

## Privacy Notes

- Chat history, saved memory, preferences, and feedback are stored in browser `localStorage` when enabled.
- Camera, microphone, and location require browser permission.
- API keys must stay server-side. Do not put provider keys in `index.html` or frontend JavaScript.
- Rate limiting is in-memory per server instance. Multi-instance production deployments need shared rate limiting for global enforcement.

## Troubleshooting

- Voice input unavailable: use a Chromium-based browser and allow microphone permission.
- No speech detected: check the selected input language and microphone.
- Live Vision is unclear: improve lighting, focus, framing, and camera stability.
- Weather fails: allow location access or include a city name.
- Search results look incomplete: use a more specific query and check the cited official source.
- `geminiEnhanced` is false: set `GEMINI_API_KEY` or `GOOGLE_API_KEY`, restart the server, and retry.
- Chat says the AI backend is not configured: set `GROQ_API_KEY`, `GROQ_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`.
