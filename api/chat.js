// Vercel Edge Function - No timeout limits on free tier!
export const config = {
  runtime: 'edge',
};

// Gemini AI Handler - Optimized for Free Tier with 4850 tokens
export default async function handler(req) {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        });
    }
    
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const { message, systemPrompt, userName } = await req.json();
        
        if (!message) {
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Get API key from environment variable
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            return new Response(JSON.stringify({ error: 'API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Use gemini-1.5-flash-latest (stable and fast)
        const MODEL = 'gemini-1.5-flash-latest';
        
        // Call Gemini API
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: systemPrompt + '\n\nUser message: ' + message
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 4850, // ✅ Your requested token count for valid responses
                        candidateCount: 1
                    }
                })
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Gemini API error:', errorData);
            
            // Better error handling for rate limits
            if (response.status === 429) {
                return new Response(JSON.stringify({ 
                    response: "I'm getting too many requests right now. Please wait a moment and try again!",
                    intent: 'error'
                }), {
                    status: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            return new Response(JSON.stringify({ 
                error: 'AI service error',
                details: errorData,
                response: "Sorry, I'm having trouble right now. Please try again!"
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const data = await response.json();
        
        // Extract text from Gemini response
        let aiText = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            aiText = data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Invalid response from Gemini API');
        }
        
        // Try to parse as JSON (for structured responses)
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            // If not JSON, treat as plain text response
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText,
                action: null
            };
        }
        
        return new Response(JSON.stringify(parsedResponse), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
        
    } catch (error) {
        console.error('Server error:', error);
        return new Response(JSON.stringify({ 
            error: 'Internal server error',
            message: error.message,
            response: "Oops! Something went wrong. Please try again!"
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
