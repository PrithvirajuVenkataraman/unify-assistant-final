// ========================================
// JARVIS - Edge Function with Multiple Models
// File: api/chat-new.js
// ========================================

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
    console.log('🚀 JARVIS Edge function called');
    
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
        const { message } = await req.json();
        
        if (!message) {
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GEMINI_API_KEY not found!');
            return new Response(JSON.stringify({ 
                response: 'API key not configured. Check Vercel environment variables.',
                intent: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        console.log('✅ API Key found');
        
        // JARVIS System Prompt
        const systemPrompt = `You are JARVIS (Just A Rather Very Intelligent System), an AI assistant inspired by Iron Man's AI. Be sophisticated, helpful, and professional with a touch of British wit.

RESPONSE STYLE RULES:

For TRAVEL PLANNING (itineraries, trip plans, destinations):
- Be COMPREHENSIVE and DETAILED
- Include day-by-day breakdowns
- Suggest specific places, restaurants, activities
- Add timing and practical tips
- Make it complete and actionable

For EVERYTHING ELSE (jokes, facts, weather, calculations, questions):
- Be CONCISE - NO preambles like "Sure!", "Alright!", "Let me tell you"
- Get STRAIGHT to the answer
- Keep under 3 sentences unless specifically asked for more
- For jokes: just tell the joke immediately
- For facts: just state the fact
- Occasionally add subtle British sophistication`;
        
        // Use ONLY the first working model (fastest, no fallback delays)
        const MODEL = 'gemini-3-flash-preview';
        const API_VERSION = 'v1alpha';
        
        const requestBody = {
            contents: [{
                parts: [{
                    text: systemPrompt + '\n\nUser message: ' + message
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4850,
                candidateCount: 1
            }
        };
        
        console.log(`🚀 Using: ${API_VERSION}/models/${MODEL}`);
        
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL}:generateContent?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                }
            );
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ API Error:', errorData);
                return new Response(JSON.stringify({ 
                    response: `I'm having trouble connecting to my AI. Please try again in a moment!`,
                    model: 'error'
                }), {
                    status: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            const data = await response.json();
            console.log(`✅ SUCCESS with ${MODEL}`);
            
            // Extract response text
            let responseText = '';
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                responseText = data.candidates[0].content.parts[0].text;
            } else {
                throw new Error('Invalid API response structure');
            }
            
            return new Response(JSON.stringify({
                response: responseText.trim(),
                model: MODEL
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
            
        } catch (error) {
            console.error('❌ Error:', error);
            return new Response(JSON.stringify({ 
                response: "I'm having trouble connecting to my AI. Please try again in a moment!",
                model: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        
        return new Response(JSON.stringify({ 
            response: "I'm having trouble connecting to my AI. Please try again in a moment!",
            model: 'error'
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
