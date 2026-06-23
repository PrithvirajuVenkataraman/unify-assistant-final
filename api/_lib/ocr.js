import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const TEXT_MIME_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/csv',
    'application/json'
]);
const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PROVIDER_TIMEOUT_MS = 25_000;
const GEMINI_API_VERSIONS = ['v1beta', 'v1'];
const GEMINI_MODEL_FALLBACKS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-flash-latest'
];
const GROQ_VISION_MODEL_FALLBACKS = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview'
];

export const OCR_LIMITS = Object.freeze({
    maxFileBytes: envInt('OCR_MAX_FILE_BYTES', 6 * 1024 * 1024, 256 * 1024, 20 * 1024 * 1024),
    maxPages: envInt('OCR_MAX_PAGES', 20, 1, 100),
    maxTextChars: envInt('OCR_MAX_TEXT_CHARS', 120_000, 1000, 500_000)
});

export class OcrError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'OcrError';
        this.code = code;
        this.httpStatus = Number(options.httpStatus) || 400;
        this.details = options.details || null;
    }
}

export async function extractTextFromFile(file = {}, options = {}) {
    const normalized = normalizeOcrInput(file);
    const buffer = decodeBase64File(normalized.fileBase64);
    if (buffer.byteLength > OCR_LIMITS.maxFileBytes) {
        throw new OcrError('file_too_large', `File is too large. Maximum supported file size is ${formatBytes(OCR_LIMITS.maxFileBytes)}.`, {
            httpStatus: 413,
            details: { maxFileBytes: OCR_LIMITS.maxFileBytes }
        });
    }

    const metadata = {
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
        sizeBytes: buffer.byteLength,
        provider: '',
        extractionMode: ''
    };

    if (isImageFile(normalized)) {
        return await extractImageOcr(normalized, metadata, options);
    }
    if (isPdfFile(normalized)) {
        return await extractPdfTextOrOcr(normalized, buffer, metadata, options);
    }
    if (isDocxFile(normalized)) {
        return await extractDocxText(buffer, metadata);
    }
    if (isTextFile(normalized)) {
        return extractPlainText(buffer, metadata);
    }

    throw new OcrError('unsupported_file_type', 'Supported uploads are PNG, JPG, JPEG, WebP, PDF, TXT, Markdown, CSV, JSON, and DOCX.', {
        httpStatus: 415,
        details: { mimeType: normalized.mimeType, fileName: normalized.fileName }
    });
}

function normalizeOcrInput(file = {}) {
    const fileName = String(file.fileName || file.name || 'uploaded-file').trim().slice(0, 180) || 'uploaded-file';
    const mimeType = normalizeMimeType(file.mimeType || file.type || '', fileName);
    const fileBase64 = String(file.fileBase64 || file.base64 || '').replace(/^data:[^,]+,/i, '').trim();
    const prompt = String(file.prompt || '').trim().slice(0, 1500);
    if (!fileBase64) {
        throw new OcrError('invalid_request', 'fileBase64 is required.', { httpStatus: 400 });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64)) {
        throw new OcrError('invalid_file_data', 'File data is not valid base64.', { httpStatus: 400 });
    }
    return { fileName, mimeType, fileBase64, prompt };
}

function decodeBase64File(base64) {
    try {
        return Buffer.from(base64, 'base64');
    } catch (_) {
        throw new OcrError('invalid_file_data', 'File data could not be decoded.', { httpStatus: 400 });
    }
}

function normalizeMimeType(value, fileName = '') {
    const mime = String(value || '').toLowerCase().split(';')[0].trim();
    if (mime) return mime === 'image/jpg' ? 'image/jpeg' : mime;
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.pdf')) return PDF_MIME_TYPE;
    if (lower.endsWith('.docx')) return DOCX_MIME_TYPE;
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.txt')) return 'text/plain';
    return 'application/octet-stream';
}

function isImageFile(file) {
    return IMAGE_MIME_TYPES.has(file.mimeType) || /\.(png|jpe?g|webp)$/i.test(file.fileName);
}

function isPdfFile(file) {
    return file.mimeType === PDF_MIME_TYPE || /\.pdf$/i.test(file.fileName);
}

function isDocxFile(file) {
    return file.mimeType === DOCX_MIME_TYPE || /\.docx$/i.test(file.fileName);
}

function isTextFile(file) {
    return TEXT_MIME_TYPES.has(file.mimeType) || /\.(txt|md|markdown|csv|json)$/i.test(file.fileName);
}

async function extractImageOcr(file, metadata, options = {}) {
    const providerText = await callOcrVisionProvider({
        mimeType: file.mimeType,
        fileBase64: file.fileBase64,
        prompt: file.prompt,
        providers: options.providers || getOcrProviders()
    });
    metadata.provider = providerText.provider;
    metadata.extractionMode = 'image_ocr';
    return buildResultFromProviderText(providerText.text, metadata);
}

async function extractPdfTextOrOcr(file, buffer, metadata, options = {}) {
    let parsed = null;
    try {
        parsed = await parsePdfText(buffer);
    } catch (error) {
        metadata.pdfParseError = String(error?.message || error || 'pdf_parse_failed').slice(0, 160);
    }

    const text = normalizeExtractedText(parsed?.text || '').slice(0, OCR_LIMITS.maxTextChars);
    const pages = Math.max(1, Number(parsed?.numpages || parsed?.numrender || 1));
    metadata.pageCount = pages;
    if (pages > OCR_LIMITS.maxPages) {
        throw new OcrError('too_many_pages', `PDF has ${pages} pages. Maximum supported pages: ${OCR_LIMITS.maxPages}.`, {
            httpStatus: 413,
            details: { pages, maxPages: OCR_LIMITS.maxPages }
        });
    }

    if (isUsableExtractedText(text)) {
        metadata.provider = 'pdf-parse';
        metadata.extractionMode = 'pdf_text';
        return createOcrResult({
            text,
            pages: [{ pageNumber: 1, text, blocks: textToBlocks(text, 1), confidence: 'high' }],
            blocks: textToBlocks(text, 1),
            confidence: 'high',
            warnings: [],
            metadata
        });
    }

    const providerText = await callGeminiDocumentOcr({
        mimeType: PDF_MIME_TYPE,
        fileBase64: file.fileBase64,
        prompt: file.prompt,
        providers: options.providers || getOcrProviders()
    });
    metadata.provider = providerText.provider;
    metadata.extractionMode = 'pdf_scanned_ocr';
    return buildResultFromProviderText(providerText.text, metadata, ['PDF had little or no embedded text, so OCR fallback was used.']);
}

async function parsePdfText(buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText({ partial: [1, OCR_LIMITS.maxPages] });
        return {
            text: String(result?.text || '').trim(),
            numpages: Number(result?.total || result?.pages?.length || 1) || 1
        };
    } finally {
        await parser.destroy?.();
    }
}

async function extractDocxText(buffer, metadata) {
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeExtractedText(result?.value || '').slice(0, OCR_LIMITS.maxTextChars);
    const warnings = Array.isArray(result?.messages)
        ? result.messages.map(item => String(item?.message || item || '').trim()).filter(Boolean).slice(0, 6)
        : [];
    metadata.provider = 'mammoth';
    metadata.extractionMode = 'docx_text';
    return createOcrResult({
        text,
        pages: [{ pageNumber: 1, text, blocks: textToBlocks(text, 1), confidence: text ? 'high' : 'low' }],
        blocks: textToBlocks(text, 1),
        confidence: text ? 'high' : 'low',
        warnings: text ? warnings : ['No readable DOCX text was found.'],
        metadata
    });
}

function extractPlainText(buffer, metadata) {
    const text = normalizeExtractedText(buffer.toString('utf8')).slice(0, OCR_LIMITS.maxTextChars);
    metadata.provider = 'native-text';
    metadata.extractionMode = 'plain_text';
    return createOcrResult({
        text,
        pages: [{ pageNumber: 1, text, blocks: textToBlocks(text, 1), confidence: text ? 'high' : 'low' }],
        blocks: textToBlocks(text, 1),
        confidence: text ? 'high' : 'low',
        warnings: text ? [] : ['No readable text was found.'],
        metadata
    });
}

async function callOcrVisionProvider({ mimeType, fileBase64, prompt, providers }) {
    const systemPrompt = buildOcrProviderPrompt(prompt);
    if (providers.groqApiKey) {
        const text = await callGroqVisionOcr({
            apiKey: providers.groqApiKey,
            configuredModel: providers.groqVisionModel,
            mimeType,
            fileBase64,
            systemPrompt
        });
        if (text) return { provider: 'groq-vision', text };
    }
    if (providers.geminiApiKey) {
        const text = await callGeminiInlineOcr({
            apiKey: providers.geminiApiKey,
            configuredModel: providers.geminiModel,
            mimeType,
            fileBase64,
            systemPrompt
        });
        if (text) return { provider: 'gemini-vision', text };
    }
    throw new OcrError('provider_unavailable', 'OCR provider is not configured. Add GROQ_API_KEY or GEMINI_API_KEY for image OCR.', { httpStatus: 503 });
}

async function callGeminiDocumentOcr({ mimeType, fileBase64, prompt, providers }) {
    if (!providers.geminiApiKey) {
        throw new OcrError('provider_unavailable', 'Scanned PDF OCR needs GEMINI_API_KEY or GOOGLE_API_KEY.', { httpStatus: 503 });
    }
    const text = await callGeminiInlineOcr({
        apiKey: providers.geminiApiKey,
        configuredModel: providers.geminiModel,
        mimeType,
        fileBase64,
        systemPrompt: buildOcrProviderPrompt(prompt)
    });
    if (!text) {
        throw new OcrError('empty_provider_response', 'OCR provider returned no readable text.', { httpStatus: 502 });
    }
    return { provider: 'gemini-document', text };
}

function buildOcrProviderPrompt(userPrompt = '') {
    return [
        'You are a production-grade OCR engine for uploaded files.',
        'Return strictly valid JSON only. No markdown fences.',
        'Preserve document structure and do not invent unreadable text.',
        'Detect and preserve headings, paragraphs, lists, tables, code blocks, forms, receipts, invoices, key-value fields, and page order.',
        'For tables, include rows and cells. For code, preserve indentation in text. For receipts/invoices/forms, extract important fields.',
        `User request: ${String(userPrompt || 'Extract readable text and structure.').trim()}`,
        'Schema:',
        '{',
        '  "text": "full extracted text in reading order",',
        '  "pages": [{ "pageNumber": 1, "text": "page text", "blocks": [] }],',
        '  "blocks": [{ "type": "heading|paragraph|list|table|code|key_value|receipt|invoice|form|text", "text": "", "rows": [["A","B"]], "fields": {"key":"value"}, "pageNumber": 1, "confidence": 0.9 }],',
        '  "confidence": "high|medium|low",',
        '  "warnings": ["short uncertainty notes"],',
        '  "metadata": { "language": "best guess", "documentType": "best guess" }',
        '}'
    ].join('\n');
}

async function callGroqVisionOcr({ apiKey, configuredModel, mimeType, fileBase64, systemPrompt }) {
    const candidates = [String(configuredModel || '').trim(), ...GROQ_VISION_MODEL_FALLBACKS].filter(Boolean);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${fileBase64}`;
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
                    temperature: 0,
                    max_tokens: 4000,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: systemPrompt },
                            { type: 'image_url', image_url: { url: dataUrl } }
                        ]
                    }]
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

async function callGeminiInlineOcr({ apiKey, configuredModel, mimeType, fileBase64, systemPrompt }) {
    const models = [String(configuredModel || '').trim(), ...GEMINI_MODEL_FALLBACKS].filter(Boolean);
    let lastError = null;
    for (const version of GEMINI_API_VERSIONS) {
        for (const model of models) {
            try {
                const response = await fetchWithTimeout(
                    `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { text: systemPrompt },
                                    { inlineData: { mimeType, data: fileBase64 } }
                                ]
                            }],
                            generationConfig: {
                                temperature: 0,
                                topP: 0.9,
                                maxOutputTokens: 5000
                            }
                        })
                    }
                );
                if (!response.ok) {
                    lastError = new Error(`gemini_${response.status}`);
                    continue;
                }
                const data = await response.json();
                const text = extractGeminiText(data);
                if (text) return text;
            } catch (error) {
                lastError = error;
            }
        }
    }
    if (lastError) {
        throw new OcrError('provider_error', 'OCR provider failed while processing the file.', { httpStatus: 502 });
    }
    return '';
}

function buildResultFromProviderText(rawText, metadata, extraWarnings = []) {
    const parsed = extractJsonFromText(rawText) || {};
    const rawExtracted = String(parsed?.text || parsed?.fullText || rawText || '').trim();
    const pages = normalizePages(parsed?.pages, rawExtracted);
    const blocks = normalizeBlocks(parsed?.blocks, pages);
    const text = normalizeExtractedText(rawExtracted || pages.map(page => page.text).filter(Boolean).join('\n\n'))
        .slice(0, OCR_LIMITS.maxTextChars);
    const confidence = normalizeConfidence(parsed?.confidence, text);
    const warnings = [
        ...extraWarnings,
        ...(Array.isArray(parsed?.warnings) ? parsed.warnings.map(String) : []),
        ...(!text ? ['No readable text was found.'] : []),
        ...(confidence === 'low' && text ? ['OCR confidence is low; some text may be inaccurate.'] : [])
    ].filter(Boolean).slice(0, 10);
    const providerMetadata = parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {};
    return createOcrResult({
        text,
        pages,
        blocks,
        confidence,
        warnings: Array.from(new Set(warnings)),
        metadata: { ...providerMetadata, ...metadata }
    });
}

function normalizePages(value, fallbackText) {
    const pages = Array.isArray(value) ? value : [];
    const normalized = pages
        .slice(0, OCR_LIMITS.maxPages)
        .map((page, index) => {
            const pageNumber = Number(page?.pageNumber || page?.page || index + 1) || index + 1;
            const text = normalizeExtractedText(page?.text || '');
            const blocks = normalizeBlocks(page?.blocks || [], []);
            return { pageNumber, text, blocks, confidence: normalizeConfidence(page?.confidence, text) };
        })
        .filter(page => page.text || page.blocks.length);
    if (normalized.length) return normalized;
    const text = normalizeExtractedText(fallbackText || '');
    return [{ pageNumber: 1, text, blocks: textToBlocks(text, 1), confidence: normalizeConfidence('', text) }];
}

function normalizeBlocks(value, pages = []) {
    const blocks = Array.isArray(value) ? value : [];
    const normalized = blocks
        .map((block, index) => normalizeBlock(block, index))
        .filter(Boolean);
    if (normalized.length) return normalized;
    return (Array.isArray(pages) ? pages : []).flatMap(page => Array.isArray(page.blocks) ? page.blocks : []);
}

function normalizeBlock(block, index = 0) {
    if (!block || typeof block !== 'object') return null;
    const rows = Array.isArray(block.rows)
        ? block.rows.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '').trim()) : [String(row ?? '').trim()])
        : [];
    const fields = block.fields && typeof block.fields === 'object' && !Array.isArray(block.fields)
        ? Object.fromEntries(Object.entries(block.fields).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()]).filter(([k, v]) => k || v))
        : {};
    let text = String(block.text || '').trim();
    if (!text && rows.length) text = rowsToMarkdownTable(rows);
    if (!text && Object.keys(fields).length) {
        text = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
    }
    if (!text && !rows.length && !Object.keys(fields).length) return null;
    return {
        id: String(block.id || `block-${index + 1}`),
        type: normalizeBlockType(block.type),
        text,
        rows,
        fields,
        pageNumber: Number(block.pageNumber || block.page || 1) || 1,
        confidence: normalizeConfidence(block.confidence, text)
    };
}

function normalizeBlockType(value) {
    const type = String(value || 'text').toLowerCase().replace(/[^a-z_]/g, '');
    return ['heading', 'paragraph', 'list', 'table', 'code', 'key_value', 'receipt', 'invoice', 'form', 'text'].includes(type)
        ? type
        : 'text';
}

function textToBlocks(text, pageNumber = 1) {
    const clean = normalizeExtractedText(text);
    if (!clean) return [];
    return clean
        .split(/\n{2,}/)
        .map((part, index) => ({
            id: `block-${pageNumber}-${index + 1}`,
            type: inferTextBlockType(part),
            text: part.trim(),
            rows: [],
            fields: {},
            pageNumber,
            confidence: 'high'
        }))
        .filter(block => block.text);
}

function inferTextBlockType(text) {
    const raw = String(text || '').trim();
    if (/^#{1,6}\s+/.test(raw) || (raw.length < 90 && !/[.!?]$/.test(raw) && raw === raw.toUpperCase())) return 'heading';
    if (/^(\s*[-*]\s+|\s*\d+\.\s+)/m.test(raw)) return 'list';
    if (/^\s*(function|const|let|var|class|def|import|SELECT|<\w+)/m.test(raw)) return 'code';
    return 'paragraph';
}

function rowsToMarkdownTable(rows) {
    const cleanRows = rows.filter(row => row.some(cell => String(cell || '').trim()));
    if (!cleanRows.length) return '';
    const maxCols = Math.max(...cleanRows.map(row => row.length));
    const pad = row => Array.from({ length: maxCols }, (_, idx) => String(row[idx] || '').replace(/\|/g, '\\|').trim());
    const padded = cleanRows.map(pad);
    const header = padded[0];
    const separator = Array.from({ length: maxCols }, () => '---');
    return [header, separator, ...padded.slice(1)]
        .map(row => `| ${row.join(' | ')} |`)
        .join('\n');
}

function createOcrResult({ text, pages, blocks, confidence, warnings, metadata }) {
    const cleanText = normalizeExtractedText(text).slice(0, OCR_LIMITS.maxTextChars);
    const cleanPages = Array.isArray(pages) ? pages.slice(0, OCR_LIMITS.maxPages) : [];
    const cleanBlocks = Array.isArray(blocks) ? blocks.slice(0, 500) : [];
    return {
        text: cleanText,
        pages: cleanPages,
        blocks: cleanBlocks,
        confidence: normalizeConfidence(confidence, cleanText),
        warnings: Array.from(new Set((Array.isArray(warnings) ? warnings : []).map(String).filter(Boolean))).slice(0, 10),
        metadata: {
            ...(metadata || {}),
            textCharCount: cleanText.length,
            pageCount: cleanPages.length || Number(metadata?.pageCount || 0) || 1,
            blockCount: cleanBlocks.length
        }
    };
}

function normalizeExtractedText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

function isUsableExtractedText(text) {
    const clean = normalizeExtractedText(text);
    if (clean.length < 40) return false;
    const alphaNumeric = (clean.match(/[A-Za-z0-9]/g) || []).length;
    return alphaNumeric >= 20;
}

function normalizeConfidence(value, text = '') {
    const raw = String(value || '').toLowerCase().trim();
    if (['high', 'medium', 'low'].includes(raw)) return raw;
    const n = Number(value);
    if (Number.isFinite(n)) {
        if (n >= 0.8) return 'high';
        if (n >= 0.45) return 'medium';
        return 'low';
    }
    return normalizeExtractedText(text).length ? 'medium' : 'low';
}

function getOcrProviders() {
    return {
        groqApiKey: process.env.GROQ_API_KEY || process.env.GROQ_KEY || '',
        geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
        groqVisionModel: String(process.env.GROQ_VISION_MODEL || '').trim(),
        geminiModel: String(process.env.GEMINI_MODEL || process.env.GEMINI_OCR_MODEL || '').trim()
    };
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

function extractGeminiText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(part => typeof part?.text === 'string' ? part.text : '').join('\n').trim();
}

function extractGroqText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n').trim();
    }
    return '';
}

function extractJsonFromText(text) {
    const raw = String(text || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    try {
        return JSON.parse(raw);
    } catch (_) {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch (_) {}
        }
    }
    return null;
}

function envInt(name, fallback, min, max) {
    const value = Number.parseInt(process.env[name] || '', 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} bytes`;
}

export const __test = {
    normalizeOcrInput,
    normalizeMimeType,
    normalizeBlocks,
    rowsToMarkdownTable,
    textToBlocks,
    isUsableExtractedText,
    buildResultFromProviderText,
    OCR_LIMITS
};
