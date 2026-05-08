export const config = { maxDuration: 60 };
import { applyApiSecurity } from './security.js';

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
            return res.status(413).json({ success: false, error: 'Prompt is too long' });
        }
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            return res.status(400).json({ success: false, error: 'imageBase64 is required' });
        }
        if (!/^image\//i.test(String(mimeType || ''))) {
            return res.status(400).json({ success: false, error: 'Unsupported mimeType' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'API key not configured' });
        }

        if (task === 'math_ocr_solve') {
            const result = await runMathOcrSolvePipeline({
                apiKey,
                mimeType,
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
        if (task === 'translate_to_english') {
            const result = await runTranslateToEnglishPipeline({
                apiKey,
                mimeType,
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
        const geminiResponse = await callGeminiVision({
            apiKey,
            systemPrompt,
            mimeType,
            imageBase64
        });

        const rawText = extractGeminiText(geminiResponse);
        if (!rawText) {
            return res.status(502).json({ success: false, error: 'Vision model returned an empty response' });
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
            response: formatVisionResponse(parsed, task),
            details: parsed
        });
    } catch (error) {
        const detail = String(error?.message || '').trim();
        return res.status(500).json({
            success: false,
            error: detail ? `Vision processing failed: ${detail}` : 'Vision processing failed'
        });
    }
}


async function callGeminiVision({ apiKey, systemPrompt, mimeType, imageBase64 }) {
    // Ordered fallback list to survive model deprecations/availability changes.
    const models = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash'
    ];
    let lastError = null;

    for (const model of models) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
                lastError = new Error(`Model ${model} failed with status ${response.status}${suffix}`);
                continue;
            }

            return await response.json();
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('No vision model available');
}

async function callGeminiText({ apiKey, systemPrompt, userPrompt, maxOutputTokens = 2000 }) {
    const models = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash'
    ];
    let lastError = null;

    for (const model of models) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
                lastError = new Error(`Model ${model} failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
                continue;
            }

            const payload = await response.json();
            const text = extractGeminiText(payload);
            if (!text) {
                lastError = new Error(`Model ${model} returned empty text`);
                continue;
            }
            return text;
        } catch (error) {
            lastError = error;
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

async function runMathOcrSolvePipeline({ apiKey, mimeType, imageBase64, userPrompt }) {
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

    const ocrPayload = await callGeminiVision({
        apiKey,
        systemPrompt: extractionPrompt,
        mimeType,
        imageBase64
    });
    const ocrRawText = extractGeminiText(ocrPayload);
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

    const plannerText = await callGeminiText({
        apiKey,
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

    const criticText = await callGeminiText({
        apiKey,
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

    const solverText = await callGeminiText({
        apiKey,
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
            ocr: ocrJson,
            planner: plannerJson,
            critic: criticJson,
            solver: solverJson
        }
    };
}

async function runTranslateToEnglishPipeline({ apiKey, mimeType, imageBase64, userPrompt }) {
    const extractionPrompt = [
        'Extract text from this image with high fidelity.',
        'Return strict JSON only:',
        '{',
        '  "summary": "short useful summary",',
        '  "quality": { "textReadability": "high|medium|low", "notes": "short note" },',
        '  "textDetected": ["snippet 1", "snippet 2"],',
        '  "fullText": "all readable text in original language and order"',
        '}',
        'Rules:',
        '- Preserve original script and punctuation.',
        '- Do not translate at this stage.'
    ].join('\n');

    const ocrPayload = await callGeminiVision({
        apiKey,
        systemPrompt: extractionPrompt,
        mimeType,
        imageBase64
    });
    const ocrRawText = extractGeminiText(ocrPayload);
    if (!ocrRawText) throw new Error('Translation OCR stage returned empty response');

    const ocrJson = extractJsonFromText(ocrRawText) || {};
    const sourceText = normalizeMathOcrText(ocrJson);
    if (!sourceText) {
        throw new Error('Could not detect readable text for translation');
    }

    const translatorSystemPrompt = [
        'You are a precise translation engine.',
        'Translate all provided text to natural English.',
        'Keep numbers, units, names, and technical terms intact unless translation is obvious.',
        'Return strict JSON only:',
        '{',
        '  "detectedLanguage": "<best guess language name>",',
        '  "englishText": "<full English translation>",',
        '  "notes": ["optional short notes about ambiguity"]',
        '}',
        'No markdown, no code fences, no prose outside JSON.'
    ].join('\n');

    const translationText = await callGeminiText({
        apiKey,
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
        response: `${englishText}\n\n${languageLine}`,
        details: {
            pipeline: 'ocr-translate',
            ocr: ocrJson,
            translation: translationJson
        }
    };
}

function buildVisionPrompt(userPrompt, task) {
    const isTextTask = task === 'text_extract' || task === 'bill_summary' || task === 'shopping_extract';
    const taskRule = getTaskRule(task);
    return [
        'You are a production-grade vision OCR and analysis engine.',
        'Analyze the provided image and return strictly valid JSON only.',
        'No markdown, no code fences, no extra text.',
        'Do not hallucinate unreadable text. If uncertain, omit that token.',
        'If text appears, preserve character accuracy, punctuation, and line order.',
        'Detect visible objects including people, animals, food, devices, vehicles, and common items.',
        'If text appears in image, include extracted snippets in textDetected and fullText.',
        `Requested task: ${task}.`,
        `Task-specific requirement: ${taskRule}`,
        `User prompt: ${String(userPrompt || '').trim() || 'Analyze this image.'}`,
        'JSON schema:',
        '{',
        '  "summary": "short useful summary",',
        '  "quality": { "textReadability": "high|medium|low", "notes": "short note" },',
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
        '- Keep summary under 60 words.',
        '- Do not fabricate unreadable text; only include likely readable snippets.',
        isTextTask
            ? '- For OCR tasks: prioritize exact text extraction first. Preserve row order, numbers, totals, units, and symbols exactly.'
            : '- For non-OCR tasks: keep OCR snippets concise and only when clearly readable.'
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
            return 'Provide a balanced scene analysis including objects, people, animals, and visible text.';
    }
}

function extractGeminiText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim();
}

function safeParseJson(text) {
    const cleaned = String(text || '')
        .trim()
        .replace(/^`?json\s*/i, '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

function formatVisionResponse(data, task) {
    const summary = String(data?.summary || 'Image analyzed.');
    const objects = normalizeDetected(data?.objects);
    const people = Array.isArray(data?.people) ? data.people : [];
    const animals = normalizeDetected(data?.animals);
    const textDetected = Array.isArray(data?.textDetected) ? data.textDetected : [];
    const fullText = String(data?.fullText || '').trim();
    const quality = data?.quality && typeof data.quality === 'object' ? data.quality : null;
    const shoppingItems = Array.isArray(data?.shoppingItems) ? data.shoppingItems : [];
    const bill = data?.bill && typeof data.bill === 'object' ? data.bill : { lineItems: [], totals: [] };
    const billItems = Array.isArray(bill.lineItems) ? bill.lineItems : [];
    const billTotals = Array.isArray(bill.totals) ? bill.totals : [];

    const lines = [`Vision summary: ${summary}`];

    if (task === 'people_count') {
        const peopleCountFromList = people.reduce((sum, p) => sum + Number(p?.count || 1), 0);
        const peopleCountFromObjects = objects
            .filter(o => /person|people|human/i.test(String(o?.label || '')))
            .reduce((sum, o) => sum + Number(o?.count || 0), 0);
        const count = Math.max(peopleCountFromList, peopleCountFromObjects);
        lines.push(`People count: ${count}`);
    }

    if (objects.length) {
        const top = objects
            .slice(0, 12)
            .map(o => `${String(o?.label || 'object')} x${Number(o?.count || 1)}${typeof o?.confidence === 'number' ? ` (${Math.round(o.confidence * 100)}%)` : ''}`)
            .join(', ');
        lines.push(`Objects: ${top}`);
    }

    if (people.length) {
        lines.push(`People: ${people.slice(0, 6).map(p => String(p?.description || 'person')).join(', ')}`);
    }

    if (animals.length) {
        lines.push(`Animals: ${animals.slice(0, 8).map(a => `${String(a?.label || 'animal')} x${Number(a?.count || 1)}${typeof a?.confidence === 'number' ? ` (${Math.round(a.confidence * 100)}%)` : ''}`).join(', ')}`);
    }

    if (textDetected.length) {
        lines.push(`Detected text: ${textDetected.slice(0, 8).join(' | ')}`);
    }
    if (task === 'text_extract' && fullText) {
        lines.push(`Full text:\n${fullText.slice(0, 6000)}`);
    }
    if (quality?.textReadability) {
        lines.push(`Readability: ${String(quality.textReadability)}`);
    }

    if (task === 'text_extract' && !textDetected.length) {
        lines.push('No clear text detected.');
    }

    if (task === 'shopping_extract' && shoppingItems.length) {
        lines.push(`Shopping items:\n- ${shoppingItems.slice(0, 20).join('\n- ')}`);
    }

    if (task === 'fridge_items' && shoppingItems.length) {
        lines.push(`Fridge items:\n- ${shoppingItems.slice(0, 20).join('\n- ')}`);
    }

    if (task === 'bill_summary') {
        if (billItems.length) {
            lines.push(`Bill items:\n- ${billItems.slice(0, 12).join('\n- ')}`);
        }
        if (billTotals.length) {
            lines.push(`Bill totals:\n- ${billTotals.slice(0, 8).join('\n- ')}`);
        }
    }

    return lines.join('\n\n');
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




