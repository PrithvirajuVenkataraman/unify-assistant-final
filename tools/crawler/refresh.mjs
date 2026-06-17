import { crawlSeeds, parseSeedUrls } from './crawler.js';

const seeds = parseSeedUrls(process.env.CRAWLER_REFRESH_URLS || process.env.CRAWLER_SEED_URLS);
const result = await crawlSeeds({
    seeds,
    maxPages: process.env.CRAWLER_MAX_PAGES || seeds.length,
    maxDepth: 0,
    maxLinksPerPage: 1,
    domainDelayMs: process.env.CRAWLER_DOMAIN_DELAY_MS || 1000
});

console.log(JSON.stringify({
    success: true,
    mode: 'refresh',
    crawledCount: result.crawledCount,
    indexedCount: result.documents.length
}, null, 2));
