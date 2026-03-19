import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 22000;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const {
            fileName = 'document',
            mimeType = '',
            fileBase64 = '',
            intent = 'general'
        } = req.body || {};

        if (!fileBase64 || typeof fileBase64 !== 'string') {
            return res.status(400).json({ success: false, error: 'fileBase64 is required' });
        }

        const buffer = Buffer.from(fileBase64, 'base64');
        if (!buffer.length) {
            return res.status(400).json({ success: false, error: 'Invalid file content' });
        }
        if (buffer.length > MAX_FILE_BYTES) {
            return res.status(413).json({ success: false, error: 'File too large. Max 10 MB.' });
        }

        const normalizedMime = String(mimeType || '').toLowerCase();
        const normalizedName = String(fileName || 'document').trim();
        const lowerName = normalizedName.toLowerCase();

        const kind = detectDocumentKind(normalizedMime, lowerName);
        if (!kind) {
            return res.status(415).json({
                success: false,
                error: 'Unsupported file type. Use PDF, DOCX, PPTX, TXT, CSV, or image files.'
            });
        }

        let extractedText = '';
        let extractionMode = 'text-parser';
        let bill = null;

        if (kind === 'pdf') {
            extractedText = await extractPdfText(buffer);
            if (!extractedText.trim()) {
                extractedText = await extractWithGeminiFile(buffer, normalizedMime || 'application/pdf', 'ocr');
                extractionMode = 'model-ocr';
            }
        } else if (kind === 'docx') {
            extractedText = await extractDocxText(buffer);
        } else if (kind === 'pptx') {
            extractedText = await extractPptxText(buffer);
        } else if (kind === 'text') {
            extractedText = buffer.toString('utf8');
        } else if (kind === 'image') {
            extractedText = await extractWithGeminiFile(buffer, normalizedMime || 'image/jpeg', 'ocr');
            extractionMode = 'model-ocr';
        } else {
            return res.status(415).json({
                success: false,
                error: 'Legacy .doc/.ppt files are not supported yet. Please convert to DOCX/PPTX.'
            });
        }

        extractedText = cleanExtractedText(extractedText);
        if (!extractedText.trim()) {
            return res.status(200).json({
                success: false,
                error: 'Could not extract readable text from this file.'
            });
        }

        const trimmedText = extractedText.slice(0, MAX_TEXT_CHARS);
        const isBillLike = isBillIntent(intent) || looksLikeBillText(trimmedText) || isBillFileName(lowerName);
        const summary = await summarizeExtractedText(trimmedText, {
            kind,
            fileName: normalizedName,
            billLike: isBillLike
        });

        if (isBillLike) {
            bill = await buildBillShape(trimmedText, summary);
        }

        return res.status(200).json({
            success: true,
            fileName: normalizedName,
            mimeType: normalizedMime || mimeType || '',
            kind,
            extractionMode,
            extractedText: trimmedText,
            extractedCharCount: trimmedText.length,
            summary,
            bill
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Document processing failed',
            details: String(error?.message || error)
        });
    }
}

function detectDocumentKind(mimeType, fileName) {
    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'pdf';
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileName.endsWith('.docx')
    ) return 'docx';
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        fileName.endsWith('.pptx')
    ) return 'pptx';
    if (mimeType.startsWith('image/') || /\.(png|jpg|jpeg|webp|bmp)$/i.test(fileName)) return 'image';
    if (
        mimeType.startsWith('text/') ||
        /\.(txt|csv|md|log|json)$/i.test(fileName)
    ) return 'text';
    if (fileName.endsWith('.doc') || fileName.endsWith('.ppt')) return 'legacy';
    return '';
}

async function extractPdfText(buffer) {
    try {
        const result = await pdfParse(buffer);
        return String(result?.text || '');
    } catch (e) {
        return '';
    }
}

async function extractDocxText(buffer) {
    try {
        const out = await mammoth.extractRawText({ buffer });
        return String(out?.value || '');
    } catch (e) {
        return '';
    }
}

async function extractPptxText(buffer) {
    try {
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => naturalSlideOrder(a) - naturalSlideOrder(b));

        const chunks = [];
        for (const name of slideFiles) {
            const xml = await zip.files[name].async('text');
            const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
                .map(m => decodeXmlEntities(m[1]))
                .map(s => s.trim())
                .filter(Boolean);
            if (texts.length) {
                chunks.push(`Slide ${naturalSlideOrder(name)}\n${texts.join('\n')}`);
            }
        }
        return chunks.join('\n\n');
    } catch (e) {
        return '';
    }
}

function naturalSlideOrder(path) {
    const m = String(path || '').match(/slide(\d+)\.xml/i);
    return m ? Number(m[1]) : 0;
}

function decodeXmlEntities(text) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanExtractedText(text) {
    return String(text || '')
        .replace(/\u0000/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isBillIntent(intent) {
    const t = String(intent || '').toLowerCase();
    return t.includes('bill') || t.includes('receipt') || t.includes('invoice') || t.includes('expense');
}

function isBillFileName(fileName) {
    return /\b(bill|receipt|invoice|expense|payment)\b/i.test(fileName || '');
}

function looksLikeBillText(text) {
    const t = String(text || '').toLowerCase();
    return (
        /\b(total|subtotal|tax|gst|amount due|invoice|receipt)\b/.test(t) &&
        (/\b(rs|inr|usd|eur|\$|₹)\s?\d/.test(t) || /\b\d+\.\d{2}\b/.test(t))
    );
}

async function summarizeExtractedText(text, meta) {
    const fallback = buildFallbackSummary(text, meta);
    const prompt = [
        'Summarize the uploaded document in concise bullet points.',
        `File type: ${meta?.kind || 'document'}`,
        `File name: ${meta?.fileName || 'document'}`,
        meta?.billLike ? 'This appears to be a bill/receipt. Include merchant, totals, and payment clues.' : '',
        'Return plain text only.',
        '',
        `Document text:\n${text.slice(0, 12000)}`
    ].filter(Boolean).join('\n');

    const llm = await callTextModel(prompt);
    return String(llm || fallback).trim();
}

function buildFallbackSummary(text, meta) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const preview = lines.slice(0, 8);
    const header = meta?.billLike
        ? 'Bill/receipt text extracted successfully.'
        : 'Document text extracted successfully.';
    if (!preview.length) return header;
    return `${header}\n\nKey lines:\n- ${preview.join('\n- ')}`;
}

async function buildBillShape(text, summaryText) {
    const local = extractBillHeuristics(text);
    const prompt = [
        'Extract bill data into strict JSON.',
        'Return ONLY JSON with this shape:',
        '{ "merchant": string, "date": string, "currency": string, "lineItems": [{"name": string, "amount": number}], "subtotal": number|null, "tax": number|null, "total": number|null }',
        'If unknown, use empty string or null.',
        '',
        `Summary:\n${summaryText.slice(0, 3000)}`,
        '',
        `Bill text:\n${text.slice(0, 12000)}`
    ].join('\n');

    const modelText = await callTextModel(prompt);
    const parsed = safeJson(modelText);
    if (parsed && typeof parsed === 'object') {
        return {
            merchant: String(parsed.merchant || local.merchant || ''),
            date: String(parsed.date || local.date || ''),
            currency: String(parsed.currency || local.currency || ''),
            lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems.slice(0, 30) : local.lineItems,
            subtotal: toNumberOrNull(parsed.subtotal, local.subtotal),
            tax: toNumberOrNull(parsed.tax, local.tax),
            total: toNumberOrNull(parsed.total, local.total)
        };
    }
    return local;
}

function extractBillHeuristics(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const merchant = lines[0] || '';
    const dateMatch = String(text || '').match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/);
    const currency = /\bINR|Rs\.?|₹\b/i.test(text) ? 'INR'
        : /\bUSD|\$\b/i.test(text) ? 'USD'
        : /\bEUR|€\b/i.test(text) ? 'EUR'
        : '';

    const amountRegex = /(?:₹|Rs\.?|\$|USD|INR|EUR)?\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/i;
    const lineItems = [];
    for (const line of lines.slice(0, 80)) {
        if (/total|subtotal|tax|gst|vat|invoice|receipt|amount due/i.test(line)) continue;
        const m = line.match(amountRegex);
        if (m) {
            const name = line.replace(m[0], '').replace(/[-:]+$/, '').trim();
            const amount = Number(String(m[1]).replace(/,/g, ''));
            if (name && Number.isFinite(amount)) {
                lineItems.push({ name, amount });
            }
        }
    }

    const subtotal = pickAmountAfterLabel(text, /subtotal/i);
    const tax = pickAmountAfterLabel(text, /\b(tax|gst|vat)\b/i);
    const total = pickAmountAfterLabel(text, /\b(total|amount due|grand total)\b/i);

    return {
        merchant,
        date: dateMatch ? dateMatch[1] : '',
        currency,
        lineItems: lineItems.slice(0, 30),
        subtotal,
        tax,
        total
    };
}

function pickAmountAfterLabel(text, labelRegex) {
    const lines = String(text || '').split('\n');
    for (const line of lines) {
        if (!labelRegex.test(line)) continue;
        const m = line.match(/(?:₹|Rs\.?|\$|USD|INR|EUR)?\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
        if (m) {
            const val = Number(String(m[1]).replace(/,/g, ''));
            if (Number.isFinite(val)) return val;
        }
    }
    return null;
}

function toNumberOrNull(primary, fallback) {
    const p = Number(primary);
    if (Number.isFinite(p)) return p;
    const f = Number(fallback);
    return Number.isFinite(f) ? f : null;
}

function safeJson(text) {
    const raw = String(text || '').trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

async function callTextModel(prompt) {
    const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (groqKey) {
        try {
            const model = String(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.2,
                    max_tokens: 1200,
                    messages: [{ role: 'user', content: prompt }]
                })
            });
            if (response.ok) {
                const data = await response.json();
                return String(data?.choices?.[0]?.message?.content || '').trim();
            }
        } catch (e) {}
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!geminiKey) return '';
    try {
        const model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 1200
                    }
                })
            }
        );
        if (!response.ok) return '';
        const data = await response.json();
        return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    } catch (e) {
        return '';
    }
}

async function extractWithGeminiFile(buffer, mimeType, mode = 'ocr') {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!geminiKey) return '';

    const model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
    const prompt = mode === 'ocr'
        ? 'Extract as much readable text as possible from this file. Preserve line breaks and key fields.'
        : 'Extract structured bill fields and visible text.';

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType, data: buffer.toString('base64') } }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 2400
                    }
                })
            }
        );
        if (!response.ok) return '';
        const data = await response.json();
        return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    } catch (e) {
        return '';
    }
}
