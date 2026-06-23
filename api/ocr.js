export const config = { maxDuration: 60 };

import { applyApiSecurity } from './_lib/security.js';
import { extractTextFromFile, OcrError, OCR_LIMITS } from './_lib/ocr.js';

const MIN_OCR_BODY_BYTES = 10 * 1024 * 1024;
const OCR_BODY_JSON_MARGIN_BYTES = 32 * 1024;
const MAX_OCR_BODY_BYTES = Math.max(
    MIN_OCR_BODY_BYTES,
    Math.ceil((OCR_LIMITS.maxFileBytes * 4) / 3) + OCR_BODY_JSON_MARGIN_BYTES
);

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'ocr',
        maxBodyBytes: MAX_OCR_BODY_BYTES,
        rateLimit: { max: 20, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const result = await extractTextFromFile({
            fileBase64: req.body?.fileBase64,
            mimeType: req.body?.mimeType,
            fileName: req.body?.fileName,
            prompt: req.body?.prompt
        });
        return res.status(200).json({
            success: true,
            result
        });
    } catch (error) {
        const status = Number(error?.httpStatus) || 502;
        const code = String(error?.code || 'ocr_failed');
        console.warn('[ocr] extraction failed', {
            code,
            status,
            mimeType: String(req.body?.mimeType || '').slice(0, 80),
            fileName: String(req.body?.fileName || '').slice(0, 120),
            base64Length: String(req.body?.fileBase64 || '').length,
            reason: String(error?.message || 'unknown_error').slice(0, 180)
        });
        return res.status(status).json({
            success: false,
            error: {
                code,
                message: error instanceof OcrError
                    ? error.message
                    : 'OCR processing failed. Please try a clearer or smaller file.',
                details: error?.details || undefined
            }
        });
    }
}
