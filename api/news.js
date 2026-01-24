// api/news.js - FREE NEWS API
// Deploy this file to: /api/news.js (Vercel Edge Function)
// No API keys required - uses free RSS feeds and public APIs

export const config = {
  runtime: 'edge',
};

// Rate limiting
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS = 20;

function getClientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('cf-connecting-ip') ||
         'anonymous';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const key = `news:${ip}`;
  const limit = rateLimits.get(key);

  if (!limit || now - limit.timestamp > RATE_LIMIT_WINDOW) {
    rateLimits.set(key, { count: 1, timestamp: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  if (limit.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - limit.timestamp)) / 1000)
    };
  }

  limit.count++;
  rateLimits.set(key, limit);
  return { allowed: true, remaining: MAX_REQUESTS - limit.count };
}

// Country code to news sources mapping
const COUNTRY_NEWS_SOURCES = {
  'IN': {
    name: 'India',
    rss: [
      { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', name: 'Times of India' },
      { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu' },
    ],
    google: 'India'
  },
  'US': {
    name: 'United States',
    rss: [
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', name: 'NY Times' },
      { url: 'https://feeds.npr.org/1001/rss.xml', name: 'NPR' },
    ],
    google: 'United States'
  },
  'GB': {
    name: 'United Kingdom',
    rss: [
      { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News' },
      { url: 'https://www.theguardian.com/uk/rss', name: 'The Guardian' },
    ],
    google: 'United Kingdom'
  },
  'CA': {
    name: 'Canada',
    rss: [
      { url: 'https://www.cbc.ca/cmlink/rss-topstories', name: 'CBC News' },
    ],
    google: 'Canada'
  },
  'AU': {
    name: 'Australia',
    rss: [
      { url: 'https://www.abc.net.au/news/feed/51120/rss.xml', name: 'ABC Australia' },
    ],
    google: 'Australia'
  },
  // Default fallback
  'DEFAULT': {
    name: 'World',
    rss: [
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'NY Times World' },
    ],
    google: 'World'
  }
};

// Category RSS feeds
const CATEGORY_FEEDS = {
  politics: [
    { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', name: 'BBC Politics' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', name: 'NY Times Politics' },
  ],
  sports: [
    { url: 'https://feeds.bbci.co.uk/sport/rss.xml', name: 'BBC Sports' },
    { url: 'https://www.espn.com/espn/rss/news', name: 'ESPN' },
  ],
  technology: [
    { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', name: 'BBC Tech' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', name: 'NY Times Tech' },
    { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge' },
  ],
  business: [
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', name: 'BBC Business' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', name: 'NY Times Business' },
  ],
  entertainment: [
    { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', name: 'BBC Entertainment' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml', name: 'NY Times Arts' },
  ],
  health: [
    { url: 'https://feeds.bbci.co.uk/news/health/rss.xml', name: 'BBC Health' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml', name: 'NY Times Health' },
  ],
  science: [
    { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', name: 'BBC Science' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', name: 'NY Times Science' },
  ],
  world: [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'NY Times World' },
  ]
};

// Parse RSS XML to extract news items
function parseRSS(xmlText, sourceName) {
  const items = [];

  // Simple regex-based XML parsing for RSS
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i;
  const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i;
  const linkRegex = /<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i;
  const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/i;
  const mediaRegex = /<media:thumbnail[^>]*url=["']([^"']+)["']/i;
  const enclosureRegex = /<enclosure[^>]*url=["']([^"']+)["']/i;

  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];

    const titleMatch = titleRegex.exec(itemXml);
    const descMatch = descRegex.exec(itemXml);
    const linkMatch = linkRegex.exec(itemXml);
    const pubDateMatch = pubDateRegex.exec(itemXml);
    const mediaMatch = mediaRegex.exec(itemXml) || enclosureRegex.exec(itemXml);

    if (titleMatch) {
      // Clean up description - remove HTML tags
      let description = descMatch ? descMatch[1] : '';
      description = description.replace(/<[^>]*>/g, '').trim();
      description = description.substring(0, 200) + (description.length > 200 ? '...' : '');

      items.push({
        title: titleMatch[1].replace(/<[^>]*>/g, '').trim(),
        description: description,
        url: linkMatch ? linkMatch[1].trim() : '',
        publishedAt: pubDateMatch ? pubDateMatch[1] : null,
        image: mediaMatch ? mediaMatch[1] : null,
        source: sourceName
      });
    }
  }

  return items;
}

// Fetch RSS feed
async function fetchRSSFeed(feedUrl, sourceName) {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'JARVIS-News-Assistant/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });

    if (!response.ok) {
      console.log(`RSS fetch failed for ${sourceName}: ${response.status}`);
      return [];
    }

    const xmlText = await response.text();
    return parseRSS(xmlText, sourceName);
  } catch (error) {
    console.log(`RSS error for ${sourceName}:`, error.message);
    return [];
  }
}

// Fetch news from Google News RSS (free, no API key)
async function fetchGoogleNews(query, region = 'World') {
  try {
    // Google News RSS feed
    const googleNewsUrl = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en`
      : `https://news.google.com/rss?hl=en&gl=US&ceid=US:en`;

    const response = await fetch(googleNewsUrl, {
      headers: {
        'User-Agent': 'JARVIS-News-Assistant/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });

    if (!response.ok) {
      return [];
    }

    const xmlText = await response.text();
    return parseRSS(xmlText, 'Google News');
  } catch (error) {
    console.log('Google News error:', error.message);
    return [];
  }
}

// Detect news category from query
function detectCategory(query) {
  const lower = query.toLowerCase();

  const categoryKeywords = {
    politics: ['politics', 'political', 'election', 'government', 'minister', 'parliament', 'congress', 'senate', 'vote', 'campaign'],
    sports: ['sports', 'sport', 'football', 'soccer', 'cricket', 'basketball', 'tennis', 'olympics', 'nfl', 'nba', 'fifa', 'match', 'game score'],
    technology: ['tech', 'technology', 'ai', 'artificial intelligence', 'software', 'hardware', 'apple', 'google', 'microsoft', 'startup', 'gadget', 'smartphone'],
    business: ['business', 'economy', 'stock', 'market', 'finance', 'trade', 'company', 'startup', 'investment'],
    entertainment: ['entertainment', 'movie', 'film', 'celebrity', 'music', 'hollywood', 'bollywood', 'tv show', 'streaming'],
    health: ['health', 'medical', 'doctor', 'hospital', 'disease', 'vaccine', 'covid', 'wellness', 'fitness'],
    science: ['science', 'research', 'discovery', 'space', 'nasa', 'climate', 'environment', 'biology', 'physics'],
    world: ['world', 'international', 'global', 'foreign']
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }

  return null;
}

// Main news fetching function
async function fetchNews(options = {}) {
  const {
    countryCode = 'DEFAULT',
    city = null,
    category = null,
    query = null,
    localCount = 2,
    countryCount = 2,
    worldCount = 1
  } = options;

  const results = {
    local: [],
    country: [],
    world: [],
    category: null
  };

  const countryConfig = COUNTRY_NEWS_SOURCES[countryCode] || COUNTRY_NEWS_SOURCES['DEFAULT'];

  // If there's a specific category query
  if (category && CATEGORY_FEEDS[category]) {
    const categoryFeeds = CATEGORY_FEEDS[category];
    const categoryPromises = categoryFeeds.slice(0, 2).map(feed =>
      fetchRSSFeed(feed.url, feed.name)
    );

    const categoryResults = await Promise.all(categoryPromises);
    results.category = categoryResults.flat().slice(0, 5);
    results.categoryName = category.charAt(0).toUpperCase() + category.slice(1);

    return results;
  }

  // If there's a search query
  if (query) {
    const searchResults = await fetchGoogleNews(query);
    results.search = searchResults.slice(0, 5);
    results.searchQuery = query;
    return results;
  }

  // Fetch local/regional news (using Google News with city)
  if (city) {
    const localNews = await fetchGoogleNews(`${city} news`);
    results.local = localNews.slice(0, localCount);
  }

  // Fetch country news from RSS feeds
  const countryPromises = countryConfig.rss.slice(0, 2).map(feed =>
    fetchRSSFeed(feed.url, feed.name)
  );

  const countryResults = await Promise.all(countryPromises);
  results.country = countryResults.flat()
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, countryCount);
  results.countryName = countryConfig.name;

  // Fetch world news
  const worldFeeds = COUNTRY_NEWS_SOURCES['DEFAULT'].rss;
  const worldPromises = worldFeeds.slice(0, 2).map(feed =>
    fetchRSSFeed(feed.url, feed.name)
  );

  const worldResults = await Promise.all(worldPromises);
  // Filter out duplicates with country news
  const countryTitles = new Set(results.country.map(n => n.title.toLowerCase()));
  results.world = worldResults.flat()
    .filter(n => !countryTitles.has(n.title.toLowerCase()))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, worldCount);

  return results;
}

export default async function handler(request) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(clientIp);

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          retryAfter: rateLimit.retryAfter
        }),
        { status: 429, headers }
      );
    }

    const body = await request.json();
    const {
      countryCode = 'DEFAULT',
      city = null,
      category = null,
      query = null
    } = body;

    // Detect category from query if not explicitly provided
    const detectedCategory = category || (query ? detectCategory(query) : null);

    const news = await fetchNews({
      countryCode: countryCode?.toUpperCase() || 'DEFAULT',
      city,
      category: detectedCategory,
      query: detectedCategory ? null : query // Don't search if we have a category
    });

    return new Response(
      JSON.stringify({
        success: true,
        news,
        meta: {
          countryCode,
          city,
          category: detectedCategory,
          query,
          timestamp: new Date().toISOString(),
          rateLimit: { remaining: rateLimit.remaining }
        }
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('News error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'News service temporarily unavailable',
        news: { local: [], country: [], world: [] }
      }),
      { status: 200, headers }
    );
  }
}
