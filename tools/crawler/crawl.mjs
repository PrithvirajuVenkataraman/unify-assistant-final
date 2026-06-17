import { crawlSeeds } from './crawler.js';

const result = await crawlSeeds({
    maxPages: process.env.CRAWLER_MAX_PAGES,
    maxDepth: process.env.CRAWLER_MAX_DEPTH,
    maxLinksPerPage: process.env.CRAWLER_MAX_LINKS_PER_PAGE,
    domainDelayMs: process.env.CRAWLER_DOMAIN_DELAY_MS
});

console.log(JSON.stringify({
    success: true,
    crawledCount: result.crawledCount,
    indexedCount: result.documents.length
}, null, 2));
