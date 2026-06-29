export const config = { maxDuration: 60 };
import { applyApiSecurity } from './_lib/security.js';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 20_000;

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'vision',
        maxBodyBytes: 8 * 1024 * 1024,
        rateLimit: { max: 10, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const { prompt = '', task = 'general_vision', mimeType = 'image/jpeg', imageBase64 = '' } = req.body || {};
        if (String(prompt).length > 2000 || String(task).length > 120) {
            return sendVisionError(res, 413, 'payload_too_large', 'Prompt or task is too long.');
        }
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            return sendVisionError(res, 400, 'invalid_request', 'imageBase64 is required.');
        }
        const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.has(normalizedMimeType)) {
            return sendVisionError(res, 415, 'unsupported_media_type', 'Supported image types are JPEG, PNG, WebP, and GIF.');
        }
        if (imageBase64.length > MAX_IMAGE_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
            return sendVisionError(res, 413, 'invalid_image', 'Image data is malformed or too large.');
        }

        const providers = getVisionProviders();
        if (!providers.groqApiKey && !providers.geminiApiKey) {
            return sendVisionError(res, 503, 'provider_unavailable', 'Vision provider is not configured.');
        }

        if (task === 'math_ocr_solve') { 
            let fastResult = null;
            try {
                fastResult = await runFastMathOcrSolvePipeline({ 
                    providers, 
                    mimeType: normalizedMimeType, 
                    imageBase64, 
                    userPrompt: prompt 
                });
            } catch (_) {}
            const result = shouldEscalateMathOcrSolve(fastResult, prompt)
                ? await runMathOcrSolvePipeline({ 
                    providers, 
                    mimeType: normalizedMimeType, 
                    imageBase64, 
                    userPrompt: prompt 
                })
                : fastResult; 
            return res.status(200).json({ 
                success: true, 
                task, 
                response: result.response,
                details: result.details
            });
        }
        if (task === 'translate_to_english') {
            const result = await runTranslateToEnglishPipeline({
                providers,
                mimeType: normalizedMimeType,
                imageBase64,
                userPrompt: prompt
            });
            return res.status(200).json({
                success: true,
                task,
                response: result.response,
                details: result.details
            });
        }

        const systemPrompt = buildVisionPrompt(prompt, task);
        const rawText = await callVisionText({
            providers,
            systemPrompt,
            mimeType: normalizedMimeType,
            imageBase64
        });
        if (!rawText) {
            return sendVisionError(res, 502, 'empty_provider_response', 'Vision provider returned an empty response.');
        }

        const parsed = safeParseJson(rawText) || extractJsonFromText(rawText);
        if (!parsed) {
            return res.status(200).json({
                success: true,
                response: rawText,
                task,
                raw: true
            });
        }

        return res.status(200).json({
            success: true,
            task,
            response: formatVisionResponse(parsed, task, prompt),
            details: parsed
        });
    } catch (error) {
        const detail = String(error?.message || '').trim();
        return sendVisionError(
            res,
            502,
            'provider_error',
            detail ? `Vision processing failed: ${detail}` : 'Vision processing failed.'
        );
    }
}

function sendVisionError(res, status, code, message) {
    return res.status(status).json({
        success: false,
        error: { code, message }
    });
}

async function fetchWithTimeout(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

const GEMINI_API_VERSIONS = ['v1beta', 'v1'];
const GEMINI_MODEL_FALLBACKS = [
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-flash-latest'
];
const GROQ_VISION_MODEL_FALLBACKS = [
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview'
];
const GROQ_TEXT_MODEL_FALLBACKS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
];

function getVisionProviders() {
    return {
        groqApiKey: process.env.GROQ_API_KEY || process.env.GROQ_KEY || '',
        geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
        groqVisionModel: String(process.env.GROQ_VISION_MODEL || '').trim(),
        groqModel: String(process.env.GROQ_MODEL || '').trim(),
        geminiModel: String(process.env.GEMINI_MODEL || '').trim()
    };
}

async function callVisionText({ providers, systemPrompt, mimeType, imageBase64 }) {
    if (providers?.geminiApiKey) {
        const payload = await callGeminiVision({
            apiKey: providers.geminiApiKey,
            configuredModel: providers.geminiModel,
            systemPrompt,
            mimeType,
            imageBase64
        });
        const text = extractGeminiText(payload);
        if (text) return text;
    }

    if (providers?.groqApiKey) {
        const text = await callGroqVisionText({
            apiKey: providers.groqApiKey,
            configuredModel: providers.groqVisionModel,
            systemPrompt,
            mimeType,
            imageBase64
        });
        if (text) return text;
    }

    return '';
}

async function callGroqVisionText({ apiKey, configuredModel, systemPrompt, mimeType, imageBase64 }) {
    const candidates = [
        String(configuredModel || '').trim(),
        ...GROQ_VISION_MODEL_FALLBACKS
    ].filter(Boolean);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    for (const model of candidates) {
        try {
            const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.15,
                    max_tokens: 3000,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: systemPrompt },
                                { type: 'image_url', image_url: { url: dataUrl } }
                            ]
                        }
                    ]
                })
            });
            if (!response.ok) continue;
            const data = await response.json();
            const text = extractGroqText(data);
            if (text) return text;
        } catch (_) {}
    }
    return '';
}

async function callGeminiVision({ apiKey, configuredModel = '', systemPrompt, mimeType, imageBase64 }) {
    let lastError = null;
    const modelFallbacks = [
        String(configuredModel || '').trim(),
        ...GEMINI_MODEL_FALLBACKS
    ].filter(Boolean);

    for (const apiVersion of GEMINI_API_VERSIONS) {
        for (const model of modelFallbacks) {
            try {
                const response = await fetchWithTimeout(
                    `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [
                                {
                                    parts: [
                                        { text: systemPrompt },
                                        {
                                            inlineData: {
                                                mimeType,
                                                data: imageBase64
                                            }
                                        }
                                    ]
                                }
                            ],
                            generationConfig: {
                                temperature: 0.2,
                                topP: 0.9,
                                maxOutputTokens: 1500
                            }
                        })
                    }
                );

                if (!response.ok) {
                    let errorDetail = '';
                    try {
                        const raw = await response.text();
                        if (raw) {
                            try {
                                const parsed = JSON.parse(raw);
                                errorDetail = String(parsed?.error?.message || parsed?.error || raw).trim();
                            } catch (_) {
                                errorDetail = String(raw).trim();
                            }
                        }
                    } catch (_) {}
                    const suffix = errorDetail ? `: ${errorDetail}` : '';
                    lastError = new Error(`Model ${model} (${apiVersion}) failed with status ${response.status}${suffix}`);
                    continue;
                }

                return await response.json();
            } catch (err) {
                lastError = err;
            }
        }
    }

    throw lastError || new Error('No vision model available');
}

async function callModelText({ providers, systemPrompt, userPrompt, maxOutputTokens = 2000 }) {
    if (providers?.groqApiKey) {
        const text = await callGroqText({
            apiKey: providers.groqApiKey,
            configuredModel: providers.groqModel,
            systemPrompt,
            userPrompt,
            maxOutputTokens
        });
        if (text) return text;
    }

    if (providers?.geminiApiKey) {
        return await callGeminiText({
            apiKey: providers.geminiApiKey,
            configuredModel: providers.geminiModel,
            systemPrompt,
            userPrompt,
            maxOutputTokens
        });
    }

    return '';
}

async function callGroqText({ apiKey, configuredModel, systemPrompt, userPrompt, maxOutputTokens = 2000 }) {
    const candidates = [
        String(configuredModel || '').trim(),
        ...GROQ_TEXT_MODEL_FALLBACKS
    ].filter(Boolean);

    for (const model of candidates) {
        try {
            const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.15,
                    max_tokens: maxOutputTokens,
                    messages: [
                        { role: 'system', content: String(systemPrompt || '').trim() },
                        { role: 'user', content: String(userPrompt || '').trim() }
                    ]
                })
            });
            if (!response.ok) continue;
            const payload = await response.json();
            const text = extractGroqText(payload);
            if (text) return text;
        } catch (_) {}
    }
    return '';
}

async function callGeminiText({ apiKey, configuredModel = '', systemPrompt, userPrompt, maxOutputTokens = 2000 }) {
    let lastError = null;
    const modelFallbacks = [
        String(configuredModel || '').trim(),
        ...GEMINI_MODEL_FALLBACKS
    ].filter(Boolean);

    for (const apiVersion of GEMINI_API_VERSIONS) {
        for (const model of modelFallbacks) {
            try {
                const response = await fetchWithTimeout(
                    `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [
                                {
                                    parts: [
                                        { text: String(systemPrompt || '').trim() },
                                        { text: String(userPrompt || '').trim() }
                                    ]
                                }
                            ],
                            generationConfig: {
                                temperature: 0.15,
                                topP: 0.9,
                                maxOutputTokens
                            }
                        })
                    }
                );

                if (!response.ok) {
                    const raw = await response.text().catch(() => '');
                    const detail = String(raw || '').trim();
                    lastError = new Error(`Model ${model} (${apiVersion}) failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
                    continue;
                }

                const payload = await response.json();
                const text = extractGeminiText(payload);
                if (!text) {
                    lastError = new Error(`Model ${model} (${apiVersion}) returned empty text`);
                    continue;
                }
                return text;
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError || new Error('No text model available');
}

function extractJsonFromText(text) {
    const parsed = safeParseJson(text);
    if (parsed) return parsed;
    const src = String(text || '').trim();
    const start = src.indexOf('{');
    const end = src.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return safeParseJson(src.slice(start, end + 1));
    }
    return null;
}

function normalizeMathOcrText(details = {}) { 
    const fullText = String(details?.fullText || '').trim(); 
    const snippets = Array.isArray(details?.textDetected) 
        ? details.textDetected.map(v => String(v || '').trim()).filter(Boolean) 
        : []; 
    if (fullText) return fullText; 
    return snippets.join('\n').trim(); 
} 

async function runFastMathOcrSolvePipeline({ providers, mimeType, imageBase64, userPrompt }) {
    const prompt = [
        'Read the math problem from the image and solve it in one pass.',
        'Return strict JSON only:',
        '{',
        '  "problemText": "<normalized problem statement with equations>",',
        '  "steps": ["short step 1", "short step 2"],',
        '  "finalAnswer": "<final answer>",',
        '  "verification": ["brief check when useful"],',
        '  "ambiguities": ["unreadable or uncertain symbols"],',
        '  "ocrConfidence": "high|medium|low",',
        '  "confidence": "high|medium|low"',
        '}',
        'Rules:',
        '- Preserve symbols, exponents, fractions, and equation structure.',
        '- Keep steps concise unless the user asks for detailed/hard step-by-step solving.',
        '- If a core number, operator, or symbol is unreadable, put it in ambiguities and set ocrConfidence to low.',
        `User intent: ${String(userPrompt || 'Solve the problem in the image.').trim()}`
    ].join('\n');

    const rawText = await callVisionText({
        providers,
        systemPrompt: prompt,
        mimeType,
        imageBase64
    });
    if (!rawText) throw new Error('Fast math OCR returned empty response');

    const parsed = extractJsonFromText(rawText) || safeParseJson(rawText) || {};
    const problemText = String(parsed?.problemText || '').trim();
    const steps = Array.isArray(parsed?.steps) ? parsed.steps.map(s => String(s || '').trim()).filter(Boolean) : [];
    const verification = Array.isArray(parsed?.verification) ? parsed.verification.map(s => String(s || '').trim()).filter(Boolean) : [];
    const ambiguities = Array.isArray(parsed?.ambiguities) ? parsed.ambiguities.map(s => String(s || '').trim()).filter(Boolean) : [];
    const finalAnswer = String(parsed?.finalAnswer || '').trim();
    const ocrConfidence = String(parsed?.ocrConfidence || '').trim().toLowerCase();
    const confidence = String(parsed?.confidence || '').trim().toLowerCase();
    if (!problemText || !finalAnswer) {
        throw new Error('Fast math OCR could not read and solve the problem clearly');
    }

    const lines = [];
    lines.push(`Problem: ${problemText}`);
    if (ambiguities.length) lines.push(`Ambiguities: ${ambiguities.join(' | ')}`);
    if (steps.length) {
        lines.push('Solution:');
        steps.forEach((step, idx) => lines.push(`${idx + 1}. ${step}`));
    }
    lines.push(`Final answer: ${finalAnswer}`);
    if (verification.length) lines.push(`Verification: ${verification.join(' | ')}`);
    lines.push(`Confidence: ${confidence || ocrConfidence || 'medium'}`);

    return {
        response: lines.join('\n\n'),
        details: {
            pipeline: 'fast-math-ocr-solve',
            fullText: problemText,
            textDetected: [problemText],
            ocrConfidence: ocrConfidence || 'medium',
            confidence: confidence || ocrConfidence || 'medium',
            ambiguities,
            solver: parsed
        }
    };
}

function shouldEscalateMathOcrSolve(result, userPrompt = '') {
    if (!result || typeof result !== 'object') return true;
    const prompt = String(userPrompt || '').toLowerCase();
    if (/\b(hard|difficult|advanced|detailed|full steps|step by step|prove|derivation|derive)\b/.test(prompt)) return true;
    const details = result?.details && typeof result.details === 'object' ? result.details : {};
    const confidence = String(details?.ocrConfidence || details?.confidence || '').toLowerCase();
    const ambiguities = Array.isArray(details?.ambiguities) ? details.ambiguities.filter(Boolean) : [];
    return confidence === 'low' || ambiguities.length > 0;
}

async function runMathOcrSolvePipeline({ providers, mimeType, imageBase64, userPrompt }) { 
    const extractionPrompt = [
        'Extract the math problem from the image.',
        'Return strict JSON only:',
        '{',
        '  "problemText": "<normalized problem statement with equations>",',
        '  "knowns": ["..."],',
        '  "unknowns": ["..."],',
        '  "ambiguities": ["..."],',
        '  "ocrConfidence": "high|medium|low"',
        '}',
        'Rules:',
        '- Preserve symbols and equation structure.',
        '- If unreadable, mention in ambiguities.',
        `User intent: ${String(userPrompt || 'Solve the problem in the image.').trim()}`
    ].join('\n');

    const ocrRawText = await callVisionText({
        providers,
        systemPrompt: extractionPrompt,
        mimeType,
        imageBase64
    });
    if (!ocrRawText) throw new Error('OCR stage returned empty response');

    const ocrJson = extractJsonFromText(ocrRawText) || {};
    const normalizedProblem = String(ocrJson?.problemText || '').trim();
    const fallbackDetails = extractJsonFromText(ocrRawText) || {};
    const fallbackText = normalizeMathOcrText(fallbackDetails);
    const effectiveProblem = normalizedProblem || fallbackText;
    if (!effectiveProblem) {
        throw new Error('Could not read the math problem clearly from image');
    }

    const plannerSystemPrompt = [
        'You are Planner Agent for hard math.',
        'Return strict JSON only:',
        '{',
        '  "classification": "<algebra|calculus|geometry|number_theory|probability|other>",',
        '  "strategy": ["step1", "step2", "step3"],',
        '  "keyFormulas": ["..."],',
        '  "riskPoints": ["..."]',
        '}',
        'No prose outside JSON.'
    ].join('\n');

    const plannerText = await callModelText({
        providers,
        systemPrompt: plannerSystemPrompt,
        userPrompt: `Problem:\n${effectiveProblem}`
    });
    const plannerJson = extractJsonFromText(plannerText);
    if (!plannerJson) throw new Error('Planner stage returned invalid JSON');

    const criticSystemPrompt = [
        'You are Critic Agent for math solving quality.',
        'Review OCR output and plan.',
        'Return strict JSON only:',
        '{',
        '  "approved": true,',
        '  "issues": ["..."],',
        '  "revisedPlan": ["..."],',
        '  "normalizedProblem": "<clean canonical problem text>",',
        '  "assumptions": ["..."]',
        '}',
        'Set approved=false if core symbols/values are ambiguous.'
    ].join('\n');

    const criticText = await callModelText({
        providers,
        systemPrompt: criticSystemPrompt,
        userPrompt: `OCR JSON:\n${JSON.stringify(ocrJson, null, 2)}\n\nPlanner JSON:\n${JSON.stringify(plannerJson, null, 2)}`
    });
    const criticJson = extractJsonFromText(criticText);
    if (!criticJson) throw new Error('Critic stage returned invalid JSON');

    const approved = Boolean(criticJson?.approved);
    const canonicalProblem = String(criticJson?.normalizedProblem || effectiveProblem).trim();
    if (!canonicalProblem) throw new Error('Critic stage did not produce a valid problem statement');

    const solverSystemPrompt = [
        'You are Solver Agent for advanced math.',
        'Use the approved/revised plan and solve correctly.',
        'Return strict JSON only:',
        '{',
        '  "steps": ["step 1 ...", "step 2 ..."],',
        '  "finalAnswer": "<final answer>",',
        '  "verification": ["check 1", "check 2"],',
        '  "confidence": "high|medium|low"',
        '}',
        'No prose outside JSON.'
    ].join('\n');

    const planToUse = Array.isArray(criticJson?.revisedPlan) && criticJson.revisedPlan.length
        ? criticJson.revisedPlan
        : (Array.isArray(plannerJson?.strategy) ? plannerJson.strategy : []);

    const solverText = await callModelText({
        providers,
        systemPrompt: solverSystemPrompt,
        userPrompt: [
            `Problem:\n${canonicalProblem}`,
            `Plan:\n${JSON.stringify(planToUse, null, 2)}`,
            `Issues from critic:\n${JSON.stringify(criticJson?.issues || [], null, 2)}`,
            `Assumptions:\n${JSON.stringify(criticJson?.assumptions || [], null, 2)}`
        ].join('\n\n'),
        maxOutputTokens: 3000
    });
    const solverJson = extractJsonFromText(solverText);
    if (!solverJson) throw new Error('Solver stage returned invalid JSON');

    const steps = Array.isArray(solverJson?.steps) ? solverJson.steps.map(s => String(s || '').trim()).filter(Boolean) : [];
    const checks = Array.isArray(solverJson?.verification) ? solverJson.verification.map(s => String(s || '').trim()).filter(Boolean) : [];
    const issues = Array.isArray(criticJson?.issues) ? criticJson.issues.map(s => String(s || '').trim()).filter(Boolean) : [];
    const assumptions = Array.isArray(criticJson?.assumptions) ? criticJson.assumptions.map(s => String(s || '').trim()).filter(Boolean) : [];
    const finalAnswer = String(solverJson?.finalAnswer || '').trim() || 'Unable to compute final answer confidently.';
    const confidence = String(solverJson?.confidence || (approved ? 'medium' : 'low')).trim();

    const lines = [];
    lines.push(`Problem: ${canonicalProblem}`);
    if (issues.length) lines.push(`Critic notes: ${issues.join(' | ')}`);
    if (assumptions.length) lines.push(`Assumptions: ${assumptions.join(' | ')}`);
    if (steps.length) {
        lines.push('Solution:');
        steps.forEach((step, idx) => lines.push(`${idx + 1}. ${step}`));
    }
    lines.push(`Final answer: ${finalAnswer}`);
    if (checks.length) lines.push(`Verification: ${checks.join(' | ')}`);
    lines.push(`Confidence: ${confidence}`);

    return {
        response: lines.join('\n\n'),
        details: { 
            pipeline: 'planner-critic-solver', 
            fullText: canonicalProblem,
            textDetected: [canonicalProblem],
            ocrConfidence: String(ocrJson?.ocrConfidence || '').trim() || (approved ? 'medium' : 'low'),
            confidence,
            ocr: ocrJson, 
            planner: plannerJson, 
            critic: criticJson, 
            solver: solverJson
        }
    };
}

async function runTranslateToEnglishPipeline({ providers, mimeType, imageBase64, userPrompt }) {
    const expectedLanguage = inferExpectedTranslationLanguage(userPrompt);
    const extractionPrompt = [
        'Extract text from this image with high fidelity.',
        expectedLanguage
            ? `Expected source language/script: ${expectedLanguage}. Pay special attention to that script.`
            : 'The source language may be Hindi, Kannada, Malayalam, Telugu, Tamil, or another language.',
        'Return strict JSON only:',
        '{',
        '  "summary": "short useful summary",',
        '  "textDetected": ["snippet 1", "snippet 2"],',
        '  "fullText": "all readable text in original language and order"',
        '}',
        'Rules:',
        '- Preserve original script and punctuation.',
        '- Do not translate at this stage.'
    ].join('\n');

    const ocrRawText = await callVisionText({
        providers,
        systemPrompt: extractionPrompt,
        mimeType,
        imageBase64
    });
    if (!ocrRawText) throw new Error('Translation OCR stage returned empty response');

    const ocrJson = extractJsonFromText(ocrRawText) || {};
    const sourceText = normalizeMathOcrText(ocrJson);
    if (!sourceText) {
        throw new Error('Could not detect readable text for translation');
    }

    const translatorSystemPrompt = [
        'You are a precise translation engine.',
        'Translate all provided text to natural English.',
        expectedLanguage ? `The expected source language is ${expectedLanguage}.` : 'The source may be Hindi, Kannada, Malayalam, Telugu, Tamil, or mixed text.',
        'Keep numbers, units, names, and technical terms intact unless translation is obvious.',
        'Return strict JSON only:',
        '{',
        '  "detectedLanguage": "<best guess language name>",',
        '  "englishText": "<full English translation>",',
        '  "notes": ["optional short notes about ambiguity"]',
        '}',
        'No markdown, no code fences, no prose outside JSON.'
    ].join('\n');

    const translationText = await callModelText({
        providers,
        systemPrompt: translatorSystemPrompt,
        userPrompt: [
            `User intent: ${String(userPrompt || 'Translate this image text to English.').trim()}`,
            'Source text:',
            sourceText
        ].join('\n\n'),
        maxOutputTokens: 2500
    });
    const translationJson = extractJsonFromText(translationText);
    if (!translationJson) throw new Error('Translation stage returned invalid JSON');

    const englishText = String(translationJson?.englishText || '').trim();
    if (!englishText) throw new Error('Translation stage returned empty English text');
    const detectedLanguage = String(translationJson?.detectedLanguage || '').trim();
    const languageLine = detectedLanguage ? `Language: ${detectedLanguage}` : 'Language: Unknown';

    return {
        response: `Original text:\n${sourceText}\n\nEnglish translation:\n${englishText}\n\n${languageLine}`,
        details: {
            pipeline: 'ocr-translate',
            fullText: sourceText,
            textDetected: Array.isArray(ocrJson?.textDetected) ? ocrJson.textDetected : [sourceText],
            ocr: ocrJson,
            translation: translationJson
        }
    };
}

function inferExpectedTranslationLanguage(userPrompt = '') {
    const t = String(userPrompt || '').toLowerCase();
    if (/\bhindi\b/.test(t)) return 'Hindi';
    if (/\bkannada\b/.test(t)) return 'Kannada';
    if (/\bmalayalam\b/.test(t)) return 'Malayalam';
    if (/\btelugu\b/.test(t)) return 'Telugu';
    if (/\btamil\b/.test(t)) return 'Tamil';
    return '';
}

function buildVisionPrompt(userPrompt, task) {
    const isTextTask = task === 'text_extract' || task === 'bill_summary' || task === 'shopping_extract';
    const taskRule = getTaskRule(task);
    return [
        'You are a production-grade vision and OCR engine.',
        'Analyze the provided image and return strictly valid JSON only.',
        'No markdown, no code fences, no extra text.',
        'Do not hallucinate unreadable text. If uncertain, omit that token.',
        'Primary focus policy:',
        isTextTask
            ? '- For OCR/document tasks, focus on readable text first.'
            : '- For general vision, focus on the most prominent foreground object first. Do not let small background text dominate the answer.',
        '- Ignore wall color/background/decor unless user explicitly asks for background.',
        '- If a clear product or object is prominent, name it in answer and summary.',
        '- For phones, tablets, laptops, earbuds, watches, and other consumer electronics, identify the likely brand and model only from visible evidence such as logos, camera layout, button placement, ports, colors, screen UI, or readable text.',
        '- If the exact model is uncertain, say "likely" and explain the visible evidence. Do not pretend certainty.',
        'If text appears, preserve character accuracy, punctuation, and line order.',
        'Detect visible objects including products, people, animals, food, devices, vehicles, and common items.',
        'If user asks "what is this" or "explain this product/part", identify the most likely item and explain its practical purpose briefly.',
        'If text appears in image, include extracted snippets in textDetected and fullText.',
        `Requested task: ${task}.`,
        `Task-specific requirement: ${taskRule}`,
        `User prompt: ${String(userPrompt || '').trim() || 'Analyze this image.'}`,
        'JSON schema:',
        '{',
        '  "summary": "short useful summary",',
        '  "answer": "direct concise answer to user prompt",',
        '  "brand": "visible or likely brand when supported, otherwise empty string",',
        '  "model": "visible or likely product/model when supported, otherwise empty string",',
        '  "modelEvidence": ["visible clue supporting the brand/model"],',
        '  "distinctiveFeatures": ["camera layout, logo, color, ports, UI, shape, or other useful visual details"],',
        '  "uncertainty": "short uncertainty note, or empty string when confident",',
        '  "objects": [',
        '    { "label": "person", "count": 2, "confidence": 0.88 }',
        '  ],',
        '  "people": [',
        '    { "description": "adult standing near table", "count": 1 }',
        '  ],',
        '  "animals": [',
        '    { "label": "dog", "count": 1, "confidence": 0.85 }',
        '  ],',
        '  "textDetected": ["sample text"],',
        '  "fullText": "full OCR text with line breaks when available",',
        '  "shoppingItems": ["milk", "eggs"],',
        '  "bill": {',
        '    "lineItems": ["Milk - $3.99"],',
        '    "totals": ["Total: $23.11"]',
        '  }',
        '}',
        'Rules:',
        '- Use empty arrays when a section does not apply.',
        '- Confidence values must be between 0 and 1.',
        '- Keep summary under 45 words.',
        '- Keep answer under 140 words for product/object identification, otherwise under 80 words.',
        '- Do not fabricate unreadable text; only include likely readable snippets.',
        isTextTask
            ? '- For OCR tasks: prioritize exact text extraction first. Preserve row order, numbers, totals, units, and symbols exactly.'
            : '- For non-OCR tasks: answer with the main visible object first. For product/device identification, include likely brand/model, evidence, distinctive features, and uncertainty when useful.'
    ].join('\n');
}

function getTaskRule(task) {
    switch (task) {
        case 'bill_summary':
            return 'Focus on bill line items and totals. Include tax and grand total when visible.';
        case 'shopping_extract':
            return 'Focus on purchasable item names and quantities. Exclude payment metadata.';
        case 'fridge_items':
            return 'Focus on food and drink items visible in fridge shelves and door.';
        case 'people_count':
            return 'Focus on counting people/humans accurately and include count in summary.';
        case 'animal_detect':
            return 'Focus on animals and species labels. Include counts and confidence.';
        case 'object_detect':
            return 'Focus on broad object detection with labels and counts.';
        case 'text_extract':
            return 'Focus on OCR text extraction from signs, labels, and printed text.';
        case 'math_ocr_solve':
            return 'Extract and solve difficult math content using planner, critic, and solver stages.';
        case 'translate_to_english':
            return 'Extract visible text and translate it accurately to English.';
        default:
            return 'Answer the user query with useful object/product detail. Prefer the prominent foreground item. For devices, infer brand/model only from visible evidence and qualify uncertainty.';
    }
}

function extractGeminiText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim();
}

function extractGroqText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                return '';
            })
            .join('\n')
            .trim();
    }
    return '';
}

function safeParseJson(text) {
    const cleaned = String(text || '').trim();
    const unwrapped = cleaned
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/^json\s*/i, '')
        .trim();
    try {
        return JSON.parse(unwrapped);
    } catch (e) {
        return null;
    }
}

function wantsDetailedVisionResponse(task, userPrompt) {
    const text = String(userPrompt || '').toLowerCase();
    if (/\b(tell me everything|everything|all details|full details|detailed|in detail|explain fully|complete breakdown|show all|what is this|what's this|identify|which model|what model|what phone|which phone|brand|product)\b/.test(text)) {
        return true;
    }
    // OCR-focused tasks should remain detailed by default.
    if (task === 'text_extract' || task === 'bill_summary' || task === 'shopping_extract' || task === 'fridge_items') {
        return true;
    }
    return false;
}

function formatVisionResponse(data, task, userPrompt = '') {
    const summary = String(data?.summary || '').trim();
    const directAnswer = String(data?.answer || '').trim();
    const objects = normalizeDetected(data?.objects);
    const people = Array.isArray(data?.people) ? data.people : [];
    const animals = normalizeDetected(data?.animals);
    const textDetected = Array.isArray(data?.textDetected)
        ? data.textDetected.map(v => String(v || '').trim()).filter(Boolean)
        : [];
    const fullText = String(data?.fullText || '').trim();
    const shoppingItems = Array.isArray(data?.shoppingItems) ? data.shoppingItems : [];
    const bill = data?.bill && typeof data.bill === 'object' ? data.bill : { lineItems: [], totals: [] };
    const billItems = Array.isArray(bill.lineItems) ? bill.lineItems : [];
    const billTotals = Array.isArray(bill.totals) ? bill.totals : [];
    const hasReadableText = Boolean(fullText || textDetected.length);
    const compactText = fullText || textDetected.slice(0, 12).join('\n');
    const brand = String(data?.brand || '').trim();
    const model = String(data?.model || '').trim();
    const modelEvidence = Array.isArray(data?.modelEvidence) ? data.modelEvidence.map(v => String(v || '').trim()).filter(Boolean) : [];
    const distinctiveFeatures = Array.isArray(data?.distinctiveFeatures) ? data.distinctiveFeatures.map(v => String(v || '').trim()).filter(Boolean) : [];
    const uncertainty = String(data?.uncertainty || '').trim();

    if (task === 'text_extract') {
        if (compactText) return `Detected text:\n${compactText.slice(0, 6000)}`;
        return 'No clear readable text detected.';
    }

    if (task === 'bill_summary') {
        const topTotals = billTotals.slice(0, 3);
        const topItems = billItems.slice(0, 5);
        const parts = [];
        if (topTotals.length) parts.push(`Totals: ${topTotals.join(' | ')}`);
        if (topItems.length) parts.push(`Items: ${topItems.join(' | ')}`);
        if (compactText && !parts.length) parts.push(`Detected text:\n${compactText.slice(0, 1200)}`);
        return parts.join('\n\n') || conciseVisionFallback(directAnswer, summary, objects);
    }

    if (task === 'shopping_extract' || task === 'fridge_items') {
        if (shoppingItems.length) {
            return `${task === 'fridge_items' ? 'Fridge items' : 'Shopping items'}: ${shoppingItems.slice(0, 12).join(', ')}`;
        }
        if (compactText) return `Detected text:\n${compactText.slice(0, 1200)}`;
        return conciseVisionFallback(directAnswer, summary, objects);
    }

    if (task === 'people_count') {
        const peopleCountFromList = people.reduce((sum, p) => sum + Number(p?.count || 1), 0);
        const peopleCountFromObjects = objects
            .filter(o => /person|people|human/i.test(String(o?.label || '')))
            .reduce((sum, o) => sum + Number(o?.count || 0), 0);
        const count = Math.max(peopleCountFromList, peopleCountFromObjects);
        return `People count: ${count}`;
    }

    const explainIntent = isObjectExplanationIntent(userPrompt);
    const detailedIntent = wantsDetailedVisionResponse(task, userPrompt);
    const objectFirstAnswer = buildObjectFirstVisionAnswer({
        directAnswer,
        summary,
        objects,
        brand,
        model,
        modelEvidence,
        distinctiveFeatures,
        uncertainty,
        compactText,
        explainIntent,
        detailedIntent,
        includeText: hasReadableText
    });
    if (objectFirstAnswer) {
        return objectFirstAnswer;
    }

    return conciseVisionFallback(directAnswer, summary, objects);
}

function buildObjectFirstVisionAnswer({ directAnswer, summary, objects, brand, model, modelEvidence, distinctiveFeatures, uncertainty, compactText, explainIntent, detailedIntent, includeText }) {
    const topObject = pickTopObjectLabel(objects);
    const topObjectMeta = pickTopObjectMeta(objects);
    const answer = removeDetectedTextLead(compactSingleLine(directAnswer || summary));
    const parts = [];
    const identity = [brand, model].filter(Boolean).join(' ').trim();
    const confidence = normalizeVisionConfidence(topObjectMeta?.confidence, uncertainty);

    if (identity) {
        const qualified = uncertainty ? `likely ${identity}` : identity;
        parts.push(`Likely item: ${topObject ? `${qualified} (${topObject})` : qualified}.`);
    } else if (topObject) {
        parts.push(detailedIntent || explainIntent ? `Likely item: ${topObject}.` : `Visible item: ${topObject}.`);
    } else if (answer) {
        parts.push(answer);
    }

    if ((explainIntent || detailedIntent) && answer && (!identity || !answer.toLowerCase().includes(identity.toLowerCase()))) {
        parts.push(answer);
    }

    if (detailedIntent && modelEvidence?.length) {
        parts.push(`Evidence: ${modelEvidence.slice(0, 3).join('; ')}.`);
    }

    if (detailedIntent && distinctiveFeatures?.length) {
        parts.push(`Visible details: ${distinctiveFeatures.slice(0, 4).join('; ')}.`);
    }

    if (uncertainty) {
        parts.push(`Uncertainty: ${uncertainty}`);
    }

    if (confidence) {
        parts.push(`Confidence: ${confidence}.`);
    }

    if (includeText && compactText) {
        parts.push(`Readable text: "${compactTextForMention(compactText)}."`);
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function pickTopObjectLabel(objects) {
    return pickTopObjectMeta(objects)?.label || '';
}

function pickTopObjectMeta(objects) {
    if (!Array.isArray(objects) || !objects.length) return '';
    const skip = /^(text|words|lettering|logo|label|screen|display|brand|writing|document|paper)$/i;
    const sorted = objects
        .map(item => ({
            label: String(item?.label || '').trim(),
            confidence: Number(item?.confidence || 0)
        }))
        .filter(item => item.label && !skip.test(item.label))
        .sort((a, b) => b.confidence - a.confidence);
    return sorted[0] || null;
}

function normalizeVisionConfidence(score, uncertainty = '') {
    if (uncertainty) return 'medium';
    const value = Number(score);
    if (!Number.isFinite(value)) return '';
    if (value >= 0.82) return 'high';
    if (value >= 0.55) return 'medium';
    return 'low';
}

function withArticle(label) {
    const clean = String(label || '').trim();
    if (!clean) return 'an object';
    if (/^(a|an|the)\s+/i.test(clean)) return clean;
    return /^[aeiou]/i.test(clean) ? `an ${clean}` : `a ${clean}`;
}

function compactTextForMention(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
        .replace(/["]+/g, "'");
}

function removeDetectedTextLead(text) {
    return String(text || '')
        .replace(/^detected text:\s*[^.?!]+[.?!]?\s*/i, '')
        .replace(/^i can read\s+[^.?!]+[.?!]?\s*/i, '')
        .trim();
}

function compactSingleLine(text) {
    const value = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!value) return '';
    return value.slice(0, 280);
}

function conciseVisionFallback(directAnswer, summary, objects) {
    const conciseAnswer = compactSingleLine(directAnswer);
    if (conciseAnswer) return conciseAnswer;
    const conciseSummary = compactSingleLine(summary);
    if (conciseSummary) return conciseSummary;
    if (Array.isArray(objects) && objects.length) {
        const top = objects.slice(0, 3).map(o => `${String(o?.label || 'object')} x${Number(o?.count || 1)}`).join(', ');
        return `Visible objects: ${top}`;
    }
    return 'I can see the image, but there is not enough clear detail to answer confidently.';
}

function isObjectExplanationIntent(userPrompt) {
    const text = String(userPrompt || '').toLowerCase();
    return /\b(what is this|what's this|what is that|identify|explain|about this|about that|product|part|component|use|used for|purpose|how it works|what phone|which phone|what model|which model|brand)\b/.test(text);
}

function normalizeDetected(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map(item => ({
            label: String(item?.label || '').trim() || 'object',
            count: Math.max(1, Number(item?.count || 1)),
            confidence: typeof item?.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : null
        }))
        .sort((a, b) => {
            const ca = a.confidence ?? -1;
            const cb = b.confidence ?? -1;
            if (cb !== ca) return cb - ca;
            return b.count - a.count;
        });
}




