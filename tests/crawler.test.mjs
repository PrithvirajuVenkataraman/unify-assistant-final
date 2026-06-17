import assert from 'node:assert/strict';
import {
    buildCrawlerDocument,
    contentHash,
    createMeiliDocumentId,
    extractHtmlMetadata,
    extractLinks,
    isAllowedByRobots,
    isLikelyBinaryUrl,
    isSameDomainLink,
    normalizeCrawlUrl,
    parseRobotsTxt,
    stripHtmlToText
} from '../tools/crawler/crawler.js';

const html = `
<!doctype html>
<html>
<head>
  <title> Latest ISRO News </title>
  <meta name="description" content="Official updates from ISRO &amp; missions">
  <link rel="canonical" href="/news/latest-isro">
</head>
<body>
  <nav>Menu</nav>
  <h1>Chandrayaan mission update</h1>
  <p>ISRO published a mission update with launch details and official source context.</p>
  <script>window.noise = true;</script>
  <a href="/news/next">Next story</a>
  <a href="https://example.com/file.pdf">PDF</a>
  <a href="https://other.example.org/story">External</a>
</body>
</html>`;

assert.equal(normalizeCrawlUrl('HTTPS://Example.com:443/path?q=1#frag'), 'https://example.com/path?q=1');
assert.equal(normalizeCrawlUrl('javascript:alert(1)'), '');
assert.equal(isLikelyBinaryUrl('https://example.com/report.pdf'), true);
assert.equal(isLikelyBinaryUrl('https://example.com/news/latest'), false);
assert.equal(isSameDomainLink('https://www.isro.gov.in/a', 'https://isro.gov.in/b'), true);

const metadata = extractHtmlMetadata(html, 'https://www.isro.gov.in/root');
assert.equal(metadata.title, 'Latest ISRO News');
assert.equal(metadata.description, 'Official updates from ISRO & missions');
assert.equal(metadata.canonicalUrl, 'https://www.isro.gov.in/news/latest-isro');

const text = stripHtmlToText(html);
assert.match(text, /Chandrayaan mission update/);
assert.doesNotMatch(text, /window\.noise/);

const links = extractLinks(html, 'https://www.isro.gov.in/root', { maxLinks: 10 });
assert.deepEqual(links, ['https://www.isro.gov.in/news/next']);

const robots = parseRobotsTxt(`
User-agent: *
Disallow: /private
Allow: /private/public
`);
assert.equal(isAllowedByRobots('https://example.com/news', robots), true);
assert.equal(isAllowedByRobots('https://example.com/private/secret', robots), false);
assert.equal(isAllowedByRobots('https://example.com/private/public/page', robots), true);

const document = buildCrawlerDocument({
    url: 'https://www.isro.gov.in/root',
    html,
    fetchedAt: '2026-06-17T00:00:00.000Z',
    trusted: true
});
assert.equal(document.canonicalUrl, 'https://www.isro.gov.in/news/latest-isro');
assert.equal(document.domain, 'isro.gov.in');
assert.equal(document.trusted, true);
assert.equal(document.id, createMeiliDocumentId(document.canonicalUrl));
assert.equal(document.contentHash, contentHash(document.text));

console.log('crawler-tests-ok');
