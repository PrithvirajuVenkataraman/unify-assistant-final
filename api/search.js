// Simple in-memory rate limiting (resets on server restart)
const rateLimitStore = new Map();

function checkRateLimit(ip, windowMs = 60000, maxRequests = 60) {
  const now = Date.now();
  const key = `${ip}:${windowMs}`;
  
  const entry = rateLimitStore.get(key);
  
  if (rateLimitStore.size > 1000) {
    const tenMinutesAgo = now - 600000;
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetAt < tenMinutesAgo) {
        rateLimitStore.delete(k);
      }
    }
  }
  
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { 
      allowed: false, 
      retryAfter, 
      error: 'Rate limit exceeded' 
    };
  }
  
  entry.count++;
  rateLimitStore.set(key, entry);
  return { allowed: true, remaining: maxRequests - entry.count };
}

function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-real-ip') || 
         'unknown';
}

export const config = {
  runtime: 'edge',
};

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
    const rateLimit = checkRateLimit(clientIp, 60000, 60);
    
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: rateLimit.error, retryAfter: rateLimit.retryAfter }),
        { status: 429, headers: { ...headers, 'Retry-After': rateLimit.retryAfter.toString() } }
      );
    }

    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { status: 400, headers }
      );
    }

    const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

    if (!BRAVE_SEARCH_API_KEY) {
      return new Response(
        JSON.stringify({
          results: [],
          message: 'Search is currently unavailable. Please try again later.',
        }),
        { status: 200, headers }
      );
    }

    // Get 5 results - more causes hallucination
    const searchResponse = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&safesearch=moderate&text_decorations=false`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
        },
      }
    );

    if (!searchResponse.ok) {
      console.error('Brave Search API error:', searchResponse.status);
      return new Response(
        JSON.stringify({ results: [], query: query }),
        { status: 200, headers }
      );
    }

    const searchData = await searchResponse.json();
    
    // Extract results - limit to 5
    const results = (searchData.web?.results || []).slice(0, 5).map(result => ({
      title: result.title || '',
      description: result.description || '',
      url: result.url || '',
      metaUrl: result.meta_url?.hostname || '',
      // Include extra snippets if available
      extraSnippets: result.extra_snippets || [],
    }));

    return new Response(
      JSON.stringify({
        results: results,
        query: query,
        count: results.length,
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Error in search API:', error);
    return new Response(
      JSON.stringify({
        results: [],
        error: 'Search service temporarily unavailable',
      }),
      { status: 200, headers }
    );
  }
}
