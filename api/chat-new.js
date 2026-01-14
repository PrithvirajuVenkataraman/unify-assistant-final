// Vercel Edge Function - WORKING VERSION
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
    console.log('🚀 JARVIS API called');
    
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
        const { message, systemPrompt } = await req.json();
        
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
                response: 'API key not configured.'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // Use stable proven models
        const MODEL = 'gemini-1.5-flash-latest';
        const API_VERSION = 'v1beta';
        
        console.log(`🚀 Using: ${API_VERSION}/models/${MODEL}`);
        
        const requestBody = {
            contents: [{
                parts: [{
                    text: (systemPrompt || '') + '\n\nUser: ' + message
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4850
            }
        };
        
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
                response: "I'm having trouble connecting to my AI. Please try again!"
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const data = await response.json();
        console.log('✅ SUCCESS');
        
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
        
        return new Response(JSON.stringify({
            response: aiText.trim()
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return new Response(JSON.stringify({ 
            response: "Error: " + error.message
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
