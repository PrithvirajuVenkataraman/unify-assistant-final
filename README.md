# JARVIS

JARVIS is a browser-based assistant for chat, writing, planning, translation, weather, live vision, saved chats, local memory, source checking, and everyday help.

The app is intentionally simple: a static frontend, small browser modules, and Node/Vercel-style API routes. There is no frontend build step.

## Exact Features

- Text chat, explanations, summaries, writing help & planning.
- Token-by-token streaming for normal chat answers, with JSON fallback for reviewed or structured routes.
- Voice-to-text input through the browser.
- Live Vision for camera-based questions, opened from the left sidebar.
- ChatGPT-style saved chats with search, restore, rename, pin, share, and delete.
- Local Memory Manager for explicit saved memory.
- Prompt-based translation and translator mode.
- Slash command picker for fast prompt templates and Live Vision access.
- Chat export helpers for JSON, TXT, and Markdown.
- Help & Options with custom instructions.
- Weather, location, hotel, food, itinerary, and general transport overview help.
- Verification that checks an answer against retrieved sources.
- Local preferences, chat history, regeneration, interruption, and feedback.
- Crawl4AI fallback for readable extraction when a server-side extractor is configured.

## Standout Feature: Context Copilot

Context Copilot is the local follow-up layer. It helps JARVIS understand messages like "latest on it", "compare it", "tell me more", and "source?" without sending the context-resolution decision to a paid model.

It is local, deterministic, private, and free-for-life. AI models still generate answers, but the decision about what a follow-up refers to is handled in the app.

## Short-Term Memory

Short-term memory lives in the active conversation. JARVIS tracks recent user messages, assistant replies, active topics, entities, and pending clarifications.

When a user sends a short follow-up, Context Copilot checks whether it clearly belongs to the latest thread. If the reply is ambiguous, JARVIS asks for clarification instead of guessing or treating the message as a new topic.

This short-term state is temporary conversation context. It is used to build compact model context, but it is not treated as permanent memory.

## Long-Term Memory

Long-term memory is local and explicit-only. JARVIS saves memory only when the user asks it to remember something or uses a clear memory-style phrase.

Saved memory items include a normalized key, value, category, created time, updated time, and optional source phrase. JARVIS recalls saved memory only when the new question clearly matches it, using exact matching, singular/plural matching, phrase overlap, and typo-tolerant fallback.

Unrelated saved memory is not injected into model context.

## Prompt-Based Translation

Translator features are activated by user prompts, not by a dedicated Help panel. JARVIS supports one-shot translation and translator mode through natural commands.

Example commands:

- `translate "How much does this cost?" to Tamil`
- `say this in Hindi: I need help`
- `what does "vanakkam" mean in English`
- `translate to Kannada`

## Sidebar And Options

The left sidebar is the primary control surface. It contains New chat, Search chats, Vision Analysis, Voice Conversation, Memory, System Instructions, and saved chat recents. Long-press or right-click a saved chat to rename, pin, share, or delete it.

Help & Options intentionally stays small. It contains custom system instructions only.

## Fast Answers

Normal chat answers stream into the active assistant bubble as the model generates text. Structured routes, verification, source-grounded answers, and higher-risk flows can still use the complete JSON response path so review and formatting remain reliable.

Press `/` in an empty prompt box to open the command picker. The picker offers Translate, Verify, Vision, Summarize, Professional, and Study templates. The user must select a command; typing `/` alone does not submit a hidden command.

Chat export supports JSON, TXT, and Markdown. Individual assistant answers can be copied, shared, regenerated, or checked with the two-option More menu.

## Verification

The Verify action uses a dedicated verification path. It checks the previous answer against retrieved evidence, then returns a report with a verdict, evidence used, how it was checked, claims that need source verification, corrections when needed, and source links.

The user does not need to provide links. JARVIS searches from the original question and uses readable extracted source text when available.

## Tech Stack

- Frontend: static HTML, CSS, and vanilla JavaScript.
- Browser modules: app state, storage, speech input, API client, and Context Copilot.
- Backend: Node/Vercel-style API route handlers.
- Model providers: Groq and Gemini, configured server-side.
- Browser APIs: localStorage, Web Speech, camera, microphone, and geolocation permissions where needed.
- Optional extraction: Crawl4AI fallback through the server.

## Project Map

- `index.html`: Main application UI and browser-side assistant workflows.
- `package.json`: Project metadata, scripts, dependency list, and Vercel function settings.
- `README.md`: Project overview and file map.
- `styles.css`: App shell, chat layout, thinking indicator, mobile behavior, Live Vision preview, controls, and visual polish.
- `science-format.js`: Browser-safe formatter for scientific notation, chemistry text, units, and speech-friendly science output.
- `vercel.json`: Vercel routing and deployment settings.
- `app/api-client.js`: Browser JSON API helper with timeout and error handling.
- `app/bootstrap.js`: Browser module startup and app initialization bridge.
- `app/context-engine.js`: Context Copilot short-term context, follow-up resolution, pending clarification state, and explicit memory helpers.
- `app/search-web.ts`: Typed compatibility helper for the legacy web-search route.
- `app/speech-input.js`: Voice-to-text input management.
- `app/state.js`: Shared browser state defaults and state helpers.
- `app/storage.js`: Browser storage helpers.
- `api/index.js`: Central API router for local and deployed `/api/*` requests.
- `api/chat-groq.js`: Main chat endpoint, model calls, answer routing, verification, and source-grounded responses.
- `api/current-facts.js`: Cached current-fact endpoint.
- `api/extract-url.js`: Route wrapper for optional readable URL extraction.
- `api/markets.js`: Market and budget helper endpoint.
- `api/search.js`: Search endpoint for current facts, news, official shortcuts, and keyless live categories.
- `api/vision.js`: Vision endpoint for camera-frame understanding and math solve paths.
- `api/web-search.ts`: Typed compatibility wrapper for the legacy web-search route.
- `api/_lib/crawl4ai-client.js`: Shared readable extraction client and URL safety checks.
- `api/_lib/security.js`: Shared CORS, method, body-size, security header, and rate-limit helpers.
- `api/_lib/web-search-core.js`: Legacy self-hosted web-search core.
- `api/_lib/free-live/classifier.js`: Deterministic prompt classifier for live-capable categories.
- `api/_lib/free-live/providers.js`: Keyless provider implementations used by live-capable categories.
- `api/_lib/free-live/source-registry.js`: Registry of live-capable source categories, TTLs, and limits.
- `api/_lib/latest/latest-cache.js`: In-memory latest-item cache.
- `api/_lib/latest/latest-ingest.js`: Latest-source feed ingestion helper.
- `api/_lib/latest/latest-sources.js`: Curated latest-source definitions.
- `api/_lib/latest/router.js`: Compatibility export for latest/live routing helpers.
- `api/_lib/types/latest-cache.ts`: TypeScript compatibility export for latest cache helpers.
- `api/_lib/types/latest-ingest.ts`: TypeScript compatibility export for latest ingest helpers.
- `api/_lib/types/latest-sources.ts`: TypeScript compatibility export for latest source helpers.
- `api/_lib/types/router.ts`: TypeScript compatibility export for route helper types.
- `tests/api-contracts.test.mjs`: API route and endpoint contract checks.
- `tests/check-inline-script.mjs`: Inline script extraction and JavaScript parse check.
- `tests/context-engine.test.mjs`: Context Copilot and memory behavior tests.
- `tests/deterministic-checks.mjs`: Deterministic frontend/API behavior and source contract checks.
- `tests/speech-input.test.mjs`: Voice input behavior and fallback message tests.
- `tools/local-dev-server.mjs`: Dependency-free local static and API test server.

## Privacy Notes

- Chat history, memory, preferences, and feedback are stored in browser localStorage when persistence is enabled.
- Saved chat actions are managed from the sidebar. Explicit memory items are managed in Memory Manager.
- Camera, microphone, and location require browser permission.
- Provider API keys must stay server-side. Do not put them in frontend files.
