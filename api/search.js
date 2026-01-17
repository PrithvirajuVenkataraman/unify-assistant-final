// FREE TIER VERSION - No paid services required
export const config = {
  runtime: 'edge',
};

// Simple in-memory rate limiting (resets on cold starts)
// For Edge Functions, this is per instance - good enough for free tier
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 30; // 30 requests per minute (free tier conservative)

// Free search APIs (no API keys required)
const FREE_SEARCH_APIS = {
  // DuckDuckGo Instant Answer API (free, no key)
  duckduckgo: (query) => 
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
  
  // Wikipedia API (free, no key)
  wikipedia: (query) =>
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5`,
  
  // OpenStreetMap Nominatim (free, requires user agent)
  openstreetmap: (query) =>
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`,
};

function getClientIp(request) {
  // Simple IP detection for rate limiting
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         request.headers.get('cf-connecting-ip') || 
         'anonymous';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const key = `rate:${ip}`;
  
  const limit = rateLimits.get(key);
  
  // Clean up old entries occasionally
  if (Math.random() < 0.01) { // 1% chance to cleanup
    for (const [k, v] of rateLimits.entries()) {
      if (now - v.timestamp > RATE_LIMIT_WINDOW * 2) {
        rateLimits.delete(k);
      }
    }
  }
  
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

// Smart search detection - FREE version
function shouldUseSearch(query) {
  const lower = query.toLowerCase();
  
  // Definitely DON'T search for these
  const noSearch = [
    'hi', 'hello', 'hey', 'thank', 'please', 'sorry',
    'how are you', 'what can you do', 'help',
    'my name is', 'call me', 'who are you',
    'tell me a joke', 'story', 'poem',
  ];
  
  if (noSearch.some(term => lower.includes(term))) {
    return false;
  }
  
  // Definitely DO search for these
  const yesSearch = [
    // Time-sensitive
    'today', 'now', 'current', 'latest', '2024', '2025',
    // News
    'news', 'breaking', 'update',
    // Locations
    'in ', 'at ', 'near ', 'hotel', 'restaurant', 'cafe',
    // Questions
    'who is ', 'what is ', 'where is ', 'when is ', 'how to ',
    // Specific lookups
    'weather', 'temperature', 'forecast', 'price', 'hours',
  ];
  
  if (yesSearch.some(term => lower.includes(term))) {
    return true;
  }
  
  // For short queries, don't search
  if (query.split(' ').length < 3) {
    return false;
  }
  
  // Default: don't search (to save API calls)
  return false;
}

// Fetch from FREE APIs
async function fetchFreeSearch(query) {
  const results = [];
  
  try {
    // Try DuckDuckGo first (best for instant answers)
    const ddgResponse = await fetch(FREE_SEARCH_APIS.duckduckgo(query), {
      headers: {
        'User-Agent': 'JARVIS-Voice-Assistant/1.0 (https://yourdomain.com)'
      }
    });
    
    if (ddgResponse.ok) {
      const ddgData = await ddgResponse.json();
      
      if (ddgData.AbstractText) {
        results.push({
          title: ddgData.Heading || 'DuckDuckGo',
          description: ddgData.AbstractText,
          url: ddgData.AbstractURL || '',
          source: 'duckduckgo',
          type: 'instant_answer'
        });
      }
      
      // Add related topics
      if (ddgData.RelatedTopics) {
        ddgData.RelatedTopics.slice(0, 3).forEach(topic => {
          if (topic.Text && !topic.Text.includes('Category:')) {
            results.push({
              title: topic.Text.split(' - ')[0] || 'Related',
              description: topic.Text,
              url: topic.FirstURL || '',
              source: 'duckduckgo',
              type: 'related_topic'
            });
          }
        });
      }
    }
  } catch (error) {
    console.log('DuckDuckGo failed:', error.message);
  }
  
  // If DuckDuckGo didn't give good results, try Wikipedia
  if (results.length < 2) {
    try {
      const wikiResponse = await fetch(FREE_SEARCH_APIS.wikipedia(query), {
        headers: {
          'User-Agent': 'JARVIS-Voice-Assistant/1.0 (https://yourdomain.com)'
        }
      });
      
      if (wikiResponse.ok) {
        const wikiData = await wikiResponse.json();
        
        wikiData.query?.search?.slice(0, 3).forEach(item => {
          results.push({
            title: item.title,
            description: item.snippet.replace(/<[^>]*>/g, '') + '...',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
            source: 'wikipedia',
            type: 'encyclopedia'
          });
        });
      }
    } catch (error) {
      console.log('Wikipedia failed:', error.message);
    }
  }
  
  // For location queries, add OpenStreetMap
  if (query.match(/\b(in|at|near|to)\s+[A-Za-z]/i)) {
    try {
      // Small delay to respect OSM's rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const osmResponse = await fetch(FREE_SEARCH_APIS.openstreetmap(query), {
        headers: {
          'User-Agent': 'JARVIS-Voice-Assistant/1.0 (https://yourdomain.com)',
          'Accept-Language': 'en'
        }
      });
      
      if (osmResponse.ok) {
        const osmData = await osmResponse.json();
        
        osmData.slice(0, 2).forEach(place => {
          results.push({
            title: place.display_name.split(',')[0],
            description: `Located in ${place.display_name.split(',').slice(1, 3).join(', ').trim()}`,
            url: `https://www.openstreetmap.org/#map=15/${place.lat}/${place.lon}`,
            source: 'openstreetmap',
            type: 'location',
            coordinates: { lat: place.lat, lon: place.lon }
          });
        });
      }
    } catch (error) {
      console.log('OpenStreetMap failed:', error.message);
    }
  }
  
  return results.slice(0, 5); // Return max 5 results
}

// Cache using Response cache headers (Edge Function built-in)
async function getCachedSearch(query) {
  // Create a cache key
  const cacheKey = new Request(`https://cache/search/${encodeURIComponent(query)}`);
  
  try {
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);
    
    if (cachedResponse) {
      const data = await cachedResponse.json();
      // Check if cache is fresh (5 minutes)
      const cachedAt = new Date(cachedResponse.headers.get('x-cached-at')).getTime();
      if (Date.now() - cachedAt < 5 * 60 * 1000) {
        return data;
      }
    }
  } catch (error) {
    // Cache errors are non-fatal
    console.log('Cache error:', error.message);
  }
  
  return null;
}

async function setCache(query, data) {
  const cacheKey = new Request(`https://cache/search/${encodeURIComponent(query)}`);
  const response = new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300', // 5 minutes
      'x-cached-at': new Date().toISOString(),
    }
  });
  
  try {
    const cache = caches.default;
    await cache.put(cacheKey, response.clone());
  } catch (error) {
    // Non-fatal
  }
  
  return response;
}

export default async function handler(request) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  // Only POST allowed
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {
    // Simple rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(clientIp);
    
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ 
          error: 'Too many requests', 
          retryAfter: rateLimit.retryAfter,
          message: 'Please wait a minute before trying again'
        }),
        { 
          status: 429, 
          headers: { ...headers, 'Retry-After': rateLimit.retryAfter.toString() }
        }
      );
    }

    // Parse request
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers }
      );
    }

    const { query } = body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: 'Valid query required (min 2 chars)' }),
        { status: 400, headers }
      );
    }

    const cleanQuery = query.trim().slice(0, 200); // Limit length

    // Check if we should even search
    if (!shouldUseSearch(cleanQuery)) {
      return new Response(
        JSON.stringify({
          results: [],
          query: cleanQuery,
          search_performed: false,
          reason: 'Query type does not require web search',
          suggestion: 'Try asking about current information, locations, or specific facts'
        }),
        { status: 200, headers }
      );
    }

    // Check cache first
    const cached = await getCachedSearch(cleanQuery);
    if (cached) {
      return new Response(
        JSON.stringify({
          ...cached,
          cached: true,
          rate_limit: { remaining: rateLimit.remaining }
        }),
        { status: 200, headers }
      );
    }

    // Perform free search
    const results = await fetchFreeSearch(cleanQuery);
    
    // Prepare response
    const responseData = {
      results: results,
      query: cleanQuery,
      count: results.length,
      search_performed: true,
      cached: false,
      sources_used: [...new Set(results.map(r => r.source))],
      rate_limit: { remaining: rateLimit.remaining, limit: MAX_REQUESTS },
      timestamp: new Date().toISOString(),
    };

    // Cache and return
    const response = await setCache(cleanQuery, responseData);
    const responseBody = await response.json();
    
    return new Response(
      JSON.stringify(responseBody),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Search error:', error);
    
    // User-friendly error
    return new Response(
      JSON.stringify({
        results: [],
        error: 'Search service temporarily unavailable',
        message: 'Search APIs are experiencing issues. Please try again in a moment.',
        fallback_suggestion: 'You can try asking general questions instead of web searches.'
      }),
      { status: 200, headers } 
    );
  }
}
