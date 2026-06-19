# JARVIS

JARVIS is a browser-based assistant for chat, writing, planning, translation, weather, live vision, public-source media, and everyday help.

The app is intentionally simple to run: a static frontend, small browser modules, and Node/Vercel-style API routes. There is no frontend build step.

## Main Features

- Text chat, explanations, writing, summaries, and planning.
- Voice-to-text input through the browser.
- Live Vision for camera-based questions.
- Weather, location, travel, route, food, hotel, and transport help.
- Public-source live facts for supported current questions.
- Related public images from Wikipedia/Wikimedia for visual topics.
- Optional Crawl4AI URL extraction when a user provides a specific URL.
- Local memory, preferences, chat history, regeneration, interruption, and feedback.

## Standout Feature: Context Copilot

Context Copilot is the app's local follow-up layer. It helps JARVIS understand messages like "latest on it", "compare it", "no, the other one", and "go back to ISRO" without sending the context-resolution decision to a paid model.

It is local, deterministic, private, and free-for-life. AI models still generate answers, but the decision about what a follow-up refers to is handled in the app.

## Live Facts And Search

Live facts use permanent-free public-source routing through Wikipedia, GDELT, RSS/Atom, official shortcuts, Open-Meteo, CoinGecko, NASA EONET, TheSportsDB, OpenStreetMap, and Wikimedia where supported.

There is no required Serper, Brave, Tavily, paid API, trial-credit dependency, or crawler.

Supported categories include:

- Stable LLM answers for general knowledge, coding, math, writing, and explanations.
- News and government updates through public sources.
- Weather through Open-Meteo.
- Crypto prices through public CoinGecko endpoints.
- Disasters through NASA EONET-style public feeds.
- Sports where free public coverage is available.
- Tourism, food, and places through Wikimedia/OpenStreetMap, without open-now or review guarantees.

Unsupported live requests should be answered honestly instead of guessed.

## Public Media Enrichment

Visual topics can call `/api/media-search` to attach relevant public images inside assistant answers. Images come from Wikipedia/Wikimedia public APIs, not Google Images scraping.

Examples:

- `tell me about guitar chords`
- `show me places to visit in Kochi`
- `what does jalebi look like`
- `explain the Eiffel Tower`
- `tell me about Mars`

Each image keeps a source page, source name, license, and attribution when available.

## Crawl4AI Shared Docker Extraction

Crawl4AI is optional shared URL extraction, not the default search system. Normal questions and live facts still use `/api/search`. Crawl4AI is used only when a user provides a specific URL and asks JARVIS to summarize, explain, verify, read, or extract from that URL.

Local Docker only works for you unless you expose it securely. A public VPS/cloud Docker deployment can serve every app user through the Vercel app.

Optional settings:

```bash
CRAWL4AI_URL=https://your-crawl4ai-service.example.com
CRAWL4AI_TOKEN=optional-shared-token
```

When `CRAWL4AI_URL` is missing, `/api/extract-url` clearly reports that URL extraction is unavailable.

## Environment Variables

AI chat needs at least one configured model provider:

```bash
GROQ_API_KEY=...
# or
GEMINI_API_KEY=...
```

Useful optional settings:

```bash
GROQ_MODEL=...
GEMINI_MODEL=...
GEMINI_SEARCH_MODEL=...
CORS_ALLOWED_ORIGINS=https://your-site.example.com
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
LIVE_RETRIEVAL_ENABLED=false
```

## Local Testing

Install and verify:

```bash
npm ci
npm run check
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

Useful prompts:

```text
bitcoin price now
weather in Chennai today
best route to Bangalore from Chidambaram
route from my location to Bangalore
tell me about guitar chords
summarize https://example.com
```

## File Purpose Map

### Root Files

| File | Purpose |
| --- | --- |
| `index.html` | Main application UI and most browser-side assistant workflows. Handles chat rendering, prompt routing, travel/location flows, route planning, media insertion, selection actions, and many feature handlers. |
| `styles.css` | Local CSS for the app shell, chat layout, thinking indicator, mobile behavior, Live Vision preview, maps, controls, and visual polish. |
| `science-format.js` | Browser-safe formatter for scientific notation, chemistry text, units, and speech-friendly science output. |
| `package.json` | Project scripts, module type, Vercel settings, and check commands. |
| `package-lock.json` | Locked npm metadata for reproducible installs. |
| `README.md` | Project overview, setup notes, feature summary, and file-purpose map. |

### Browser Modules

| File | Purpose |
| --- | --- |
| `app/bootstrap.js` | Initializes browser modules and connects app startup pieces. |
| `app/api-client.js` | Small JSON API helper with timeout, error normalization, and CORS-specific messaging. |
| `app/context-engine.js` | Local Context Copilot engine for follow-up resolution, conversation threads, preferences, pending clarifications, and context building. |
| `app/speech-input.js` | Voice-to-text input management and speech recognition state handling. |
| `app/state.js` | Shared app state defaults and state-related helpers. |
| `app/storage.js` | Browser storage helpers for saved app data. |
| `app/search-web.ts` | Typed helper for the legacy self-hosted web-search route. |

### API Routes

| File | Purpose |
| --- | --- |
| `api/index.js` | Central API router used by the local dev server and compatible deployments. Dispatches `/api/*` requests to route handlers. |
| `api/chat-groq.js` | Main chat endpoint. Handles Groq/Gemini model calls, routing strategy, safety checks, quality review, source-grounded answers, and live-search escalation. |
| `api/search.js` | Public-source search endpoint for current facts, news, official shortcuts, Wikipedia/GDELT lookup, Gemini-assisted source enhancement, and keyless live categories. |
| `api/current-facts.js` | Cached current-fact endpoint backed by the local latest-news cache. |
| `api/markets.js` | Market/budget helper endpoint for disabled market mode and local budget planning. |
| `api/vision.js` | Vision endpoint for image understanding, math OCR solve paths, and planner/critic vision flows. |
| `api/extract-url.js` | Thin route wrapper for optional Crawl4AI URL extraction. |
| `api/media-search.js` | Thin route wrapper for public Wikimedia/Wikipedia image lookup. |
| `api/web-search.ts` | Legacy wrapper for the disabled-by-default self-hosted web-search route. |

### API Shared Libraries

| File | Purpose |
| --- | --- |
| `api/_lib/security.js` | Shared API security: CORS, method checks, body-size checks, security headers, and in-memory rate limiting. |
| `api/_lib/crawl4ai-client.js` | Optional Crawl4AI client: validates URLs, blocks private/local targets, calls a shared Crawl4AI service, normalizes extraction output, and handles errors. |
| `api/_lib/media-search.js` | Public media search logic for Wikipedia/Wikimedia images, licensing, attribution, filtering, and response normalization. |
| `api/_lib/web-search-core.js` | Legacy self-hosted SearXNG search core with page extraction, robots checks, caching, and result cleanup. |

### Latest/Public-Source Helpers

| File | Purpose |
| --- | --- |
| `api/_lib/latest/router.js` | Compatibility export for the free-live classifier and route JSON helper. |
| `api/_lib/latest/latest-cache.js` | In-memory/latest cache utilities for saved current-source items. |
| `api/_lib/latest/latest-ingest.js` | Ingests configured latest-source feeds into the cache. |
| `api/_lib/latest/latest-sources.js` | Curated latest-source definitions. |
| `api/_lib/free-live/classifier.js` | Deterministic classifier that routes prompts to LLM, cached latest, live-required, clarify, or unsupported categories. |
| `api/_lib/free-live/providers.js` | Keyless provider implementations for weather, crypto, disasters, sports, tourism, food, places, and related live categories. |
| `api/_lib/free-live/source-registry.js` | Registry describing public/free source categories, TTLs, providers, limitations, and attribution. |

### Type Compatibility Files

| File | Purpose |
| --- | --- |
| `api/_lib/types/latest-cache.ts` | TypeScript compatibility export for latest-cache helpers. |
| `api/_lib/types/latest-ingest.ts` | TypeScript compatibility export for latest-ingest helpers. |
| `api/_lib/types/latest-sources.ts` | TypeScript compatibility export for latest-source helpers. |
| `api/_lib/types/router.ts` | TypeScript compatibility export for route helpers and route type names. |

### Tests

| File | Purpose |
| --- | --- |
| `tests/check-inline-script.mjs` | Extracts the inline script from `index.html` and verifies it parses as JavaScript. |
| `tests/deterministic-checks.mjs` | Contract checks for key frontend/API behavior, routing rules, science formatting, typo handling, media/search hooks, and route parsing. |
| `tests/context-engine.test.mjs` | Unit tests for Context Copilot thread resolution, follow-ups, repairs, pending state, and stale-context prevention. |
| `tests/speech-input.test.mjs` | Unit tests for speech input behavior and language fallback messages. |
| `tests/api-contracts.test.mjs` | API contract tests for route dispatch, search, Crawl4AI extraction, media search, live providers, current facts, markets, and vision request validation. |

### Tools

| File | Purpose |
| --- | --- |
| `tools/local-dev-server.mjs` | Dependency-free local server for `index.html`, static assets, and `/api/*` route testing. |

## Troubleshooting

- Chat backend not configured: set `GROQ_API_KEY`, `GROQ_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`.
- 403 from API on deployment: set `CORS_ALLOWED_ORIGINS` to your deployed site URL, or allow same-origin requests.
- Voice input unavailable: use a browser with Web Speech support and allow microphone permission.
- Weather or "my location" route fails: allow location permission or include a city/place name.
- Live facts look incomplete: free public sources are best-effort; check the cited source for important decisions.
- Crawl4AI URL extraction unavailable: set `CRAWL4AI_URL`, or use normal public-source search instead.

## Privacy Notes

- Chat history, memory, preferences, and feedback are stored in browser `localStorage` when persistence is enabled.
- Camera, microphone, and location require browser permission.
- Provider API keys must stay server-side. Do not put them in `index.html` or frontend JavaScript.
