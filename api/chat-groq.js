export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers,
      }
    );
  }

  try {
    // Parse the request body
    const body = await request.json();
    const { message, systemPrompt, userName } = body;

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        {
          status: 400,
          headers,
        }
      );
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({
          response: "I'm currently being configured. Please check back soon!",
          error: 'API key not configured',
        }),
        {
          status: 200,
          headers,
        }
      );
    }

    // Prepare system prompt
    const finalSystemPrompt = systemPrompt || 
      `You are JARVIS, a helpful voice assistant. ${userName ? `The user's name is ${userName}.` : ''} 
       Be conversational, helpful, and concise.`;

    // Call Groq API using native fetch (built into Edge runtime)
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          { role: 'system', content: finalSystemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 5000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content || "I couldn't generate a response.";

    // Return successful response
    return new Response(
      JSON.stringify({
        response: aiResponse,
        meta: {
          model: 'llama3-70b-8192',
          tokens: data.usage?.total_tokens || 0,
        },
      }),
      {
        status: 200,
        headers,
      }
    );

  } catch (error) {
    console.error('Error in chat-groq:', error);
    
    return new Response(
      JSON.stringify({
        response: "Sorry, I'm having trouble processing your request. Please try again.",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
      {
        status: 500,
        headers,
      }
    );
  }
}
