// Vercel Edge Function - Optimized for Free Tier with 4850 tokens
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
    console.log('🚀 Edge function called');
    
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
        console.log('❌ Wrong method:', req.method);
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const { message, systemPrompt, userName } = await req.json();
        console.log('📨 Received message:', message?.substring(0, 100));
        
        if (!message) {
            console.log('❌ No message provided');
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Get API key from environment variable
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GEMINI_API_KEY not found in environment!');
            return new Response(JSON.stringify({ 
                error: 'API key not configured',
                response: 'Configuration error. Please check Vercel environment variables.'
            }), {
                status: 500,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        console.log('✅ API Key found');
        
        // Use known working Gemini models (try in order)
        const MODELS_TO_TRY = [
            'gemini-1.5-flash-8b',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-pro'
        ];
        
        let MODEL = MODELS_TO_TRY[0]; // Start with first model
        let modelIndex = 0;
        
        console.log('🤖 Using model:', MODEL);
        
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
        
        console.log('📤 Calling Gemini API...');
        
        let response;
        let lastError;
        
        // Try each model until one works
        for (let i = 0; i < MODELS_TO_TRY.length; i++) {
            MODEL = MODELS_TO_TRY[i];
            console.log(`🧪 Attempt ${i + 1}: Trying ${MODEL}`);
            
            try {
                response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    }
                );
                
                if (response.ok) {
                    console.log(`✅ Success with ${MODEL}`);
                    break; // Found a working model!
                } else {
                    const errorData = await response.json();
                    lastError = errorData;
                    console.log(`❌ ${MODEL} failed:`, errorData.error?.message || 'Unknown error');
                    
                    // If not found, try next model
                    if (i < MODELS_TO_TRY.length - 1) {
                        continue;
                    }
                }
            } catch (err) {
                console.log(`❌ ${MODEL} error:`, err.message);
                lastError = err;
                if (i < MODELS_TO_TRY.length - 1) {
                    continue;
                }
            }
        }
        
        console.log('📥 Gemini status:', response.status);
        
        if (!response.ok) {
            console.error('❌ All models failed. Last error:', JSON.stringify(lastError));
            
            if (response.status === 429) {
                return new Response(JSON.stringify({ 
                    response: "Too many requests. Wait a moment!",
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
                response: `API Error: ${lastError?.error?.message || 'All models failed'}`,
                intent: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const data = await response.json();
        console.log('✅ Got Gemini response');
        
        let aiText = '';
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            aiText = data.candidates[0].content.parts[0].text;
            console.log('✅ Text length:', aiText.length);
        } else {
            console.error('❌ Invalid structure');
            throw new Error('Invalid API response');
        }
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText
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
        console.error('❌ Error:', error);
        
        return new Response(JSON.stringify({ 
            response: "Something went wrong! " + error.message,
            intent: 'error'
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
