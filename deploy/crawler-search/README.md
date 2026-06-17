# Permanent Crawler Search Target

This replaces Meilisearch. It is a permanent self-hosted search target owned by this repo:

```text
Any device -> Vercel app -> /api/search -> https://search.yourdomain.com/search -> crawler JSONL index
```

No Meilisearch Cloud, no Meilisearch server, no Serper credits required.

## 1. VPS Setup

Use an Ubuntu VPS with Docker and Docker Compose. Point DNS to the VPS:

```text
search.yourdomain.com -> VPS public IP
```

Copy this repo to the VPS, including `deploy/crawler-search`.

## 2. Configure

```bash
cd deploy/crawler-search
cp .env.example .env
nano .env
```

Set:

```text
CRAWLER_DOMAIN=search.yourdomain.com
CRAWLER_SEARCH_KEY=your-long-random-secret-key
CRAWLER_SEED_URLS=https://www.isro.gov.in/,https://www.nasa.gov/,https://www.bbc.com/news,https://apnews.com/
```

## 3. Start Public HTTPS Search Server

```bash
docker compose up -d
```

Check:

```bash
curl https://search.yourdomain.com/health
```

Expected:

```json
{"status":"available"}
```

## 4. Build The Index

Run the crawler on the VPS from the repo root:

```bash
export CRAWLER_INDEX_FILE="$(pwd)/crawler-index.jsonl"
export CRAWLER_SEED_URLS="https://www.isro.gov.in/,https://www.nasa.gov/,https://www.bbc.com/news,https://apnews.com/"
npm run crawler:seed
```

Then copy the index into the Docker volume:

```bash
docker cp crawler-index.jsonl jarvis-crawler-search:/data/crawler-index.jsonl
docker restart jarvis-crawler-search
```

Refresh later:

```bash
npm run crawler:refresh
docker cp crawler-index.jsonl jarvis-crawler-search:/data/crawler-index.jsonl
docker restart jarvis-crawler-search
```

## 5. Configure Vercel

Set:

```text
CRAWLER_SEARCH_ENDPOINT=https://search.yourdomain.com
CRAWLER_SEARCH_KEY=your-long-random-secret-key
LIVE_RETRIEVAL_ENABLED=true
```

Redeploy Vercel.

## 6. Test From Any Device

Open the Vercel app on phone or laptop and run:

```js
fetch('/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'latest ISRO news' })
}).then(async r => ({ status: r.status, body: await r.json() })).then(console.log)
```

Expected:

```text
status: 200
body.provider: "crawler_index"
body.results.length > 0
```
