// api/chat-groq.js - OPTIMIZED FOR GROQ FREE TIER
// Deploy this file to: /api/chat-groq.js (Vercel Edge Function)
// Required ENV: GROQ_API_KEY

export const config = {
  runtime: 'edge',
};

// Simple rate limiting for Groq API conservation
const rateLimits = new Map();
const RATE_LIMIT = 40; // requests per minute
const WINDOW_MS = 60000;

function checkRateLimit(ip) {
  const now = Date.now();
  const key = `chat:${ip}`;
  
  const limit = rateLimits.get(key);
  
  if (!limit || now - limit.timestamp > WINDOW_MS) {
    rateLimits.set(key, { count: 1, timestamp: now });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  
  if (limit.count >= RATE_LIMIT) {
    return { 
      allowed: false, 
      retryAfter: Math.ceil((WINDOW_MS - (now - limit.timestamp)) / 1000)
    };
  }
  
  limit.count++;
  rateLimits.set(key, limit);
  return { allowed: true, remaining: RATE_LIMIT - limit.count };
}

function getClientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous';
}

// Smart model selection to maximize free tier
function selectModel(query) {
  const lower = query.toLowerCase();
  const words = query.split(/\s+/).length;
  
  // Use small model for:
  // - Short queries (< 15 words)
  // - Simple questions
  // - Greetings
  // - Yes/no answers
  
  const smallModel = 'llama-3.1-8b-instant'; // Fastest, cheapest
  const largeModel = 'llama-3.3-70b-versatile'; // Best quality (or use 'llama-3.1-70b-versatile' as fallback)
  
  // Use large model only for:
  if (
    words > 20 ||
    lower.includes('itinerary') ||
    lower.includes('plan a trip') ||
    lower.includes('explain') ||
    lower.includes('compare') ||
    lower.includes('creative') ||
    lower.includes('story') ||
    lower.includes('technical')
  ) {
    return largeModel;
  }
  
  return smallModel; // Default to cheap model
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
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(clientIp);
    
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ 
          error: 'Too many requests',
          retryAfter: rateLimit.retryAfter
        }),
        { 
          status: 429, 
          headers: { ...headers, 'Retry-After': rateLimit.retryAfter.toString() }
        }
      );
    }

    const body = await request.json();
    const { message, systemPrompt, userName, searchContext } = body;

    if (!message?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers }
      );
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({
          response: "Hello! I need my API key configured. Please check the setup.",
        }),
        { status: 200, headers }
      );
    }

    const cleanMessage = message.trim().slice(0, 1000);
    const selectedModel = selectModel(cleanMessage);
    
    // Build system prompt
    const basePrompt = `You are JARVIS, a helpful voice assistant. ${userName ? `The user's name is ${userName}.` : ''}

IMPORTANT RULES:
1. Be CONCISE - use fewer words
2. No markdown formatting
3. Skip unnecessary pleasantries
4. If unsure, admit it rather than guessing
5. For travel queries, give structure only unless you're certain`;

    const finalPrompt = searchContext 
      ? `${basePrompt}\n\nSEARCH RESULTS:\n${searchContext}\n\nUse this information but don't invent details.`
      : `${basePrompt}\n\n${systemPrompt || ''}`;

    // Call Groq API
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: finalPrompt },
          { role: 'user', content: cleanMessage },
        ],
        temperature: 0.7,
        max_tokens: selectedModel.includes('70b') ? 1500 : 800,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      // Fallback to smallest model
      const fallback = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: 'Give a short helpful response.' },
            { role: 'user', content: cleanMessage },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });
      
      if (!fallback.ok) {
        throw new Error('API failed');
      }
      
      const data = await fallback.json();
      const aiResponse = data.choices[0]?.message?.content || "I'm having trouble responding.";
      
      return new Response(
        JSON.stringify({
          response: aiResponse,
          meta: { model: 'llama-3.1-8b-instant-fallback', tokens: 0 }
        }),
        { status: 200, headers }
      );
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content || "I couldn't generate a response.";

    return new Response(
      JSON.stringify({
        response: aiResponse.replace(/\n\s*\n\s*\n/g, '\n\n').trim(),
        meta: {
          model: selectedModel,
          tokens: data.usage?.total_tokens || 0,
          rate_limit: {
            remaining: rateLimit.remaining,
            reset_in: Math.ceil((WINDOW_MS - (Date.now() - (rateLimits.get(`chat:${clientIp}`)?.timestamp || Date.now()))) / 1000),
          }
        }
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Chat error:', error);
    
    return new Response(
      JSON.stringify({
        response: "I apologize, but I'm having technical difficulties. Please try again.",
      }),
      { status: 200, headers }
    );
  }
}
