import { configureMeiliIndex, crawlSeeds } from './crawler.js';

await configureMeiliIndex();
const result = await crawlSeeds({
    maxPages: process.env.CRAWLER_MAX_PAGES || 50,
    maxDepth: process.env.CRAWLER_MAX_DEPTH || 1,
    maxLinksPerPage: process.env.CRAWLER_MAX_LINKS_PER_PAGE || 12,
    domainDelayMs: process.env.CRAWLER_DOMAIN_DELAY_MS || 1000
});

console.log(JSON.stringify({
    success: true,
    mode: 'seed',
    crawledCount: result.crawledCount,
    indexedCount: result.documents.length
}, null, 2));
