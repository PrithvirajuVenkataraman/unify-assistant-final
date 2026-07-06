const MONTH_NAME = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SEASON_NAME = '(?:summer|winter|spring|autumn|fall|monsoon|rainy season|dry season)';
const RELATIVE_DATE = '(?:today|tomorrow|tonight|now|right now|currently|this morning|this afternoon|this evening|this week|this month|this year|next week|next month|next year)';

function normalizeQueryTargetText(value) {
    return String(value || '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
        .trim();
}

export function extractQueryTargetMetadata(value) {
    const raw = normalizeQueryTargetText(value).replace(/[?.!]+$/g, '').trim();
    if (!raw) return { target: '', dateContext: '', modifiers: [] };

    const dateContext = [];
    const modifiers = [];
    const collect = (regex, bucket) => {
        for (const match of raw.matchAll(regex)) {
            const found = normalizeQueryTargetText(match[0]).replace(/^[,;\s]+|[,;\s]+$/g, '');
            if (found && !bucket.includes(found)) bucket.push(found);
        }
    };

    collect(new RegExp(`\\b(?:around|about|in|during|for|on|as of|by|before|after|from)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?${MONTH_NAME}(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+(?:19|20)\\d{2})?\\b`, 'gi'), dateContext);
    collect(new RegExp(`\\b(?:around|about|in|during|for)\\s+${SEASON_NAME}\\b`, 'gi'), dateContext);
    collect(/\b(?:in|during|for|as of|by|before|after|from)\s+(?:19|20)\d{2}\b/gi, dateContext);
    collect(/\b(?:on|as of|by)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s*,?\s+(?:19|20)\d{2}\b/gi, dateContext);
    collect(new RegExp(`\\b${RELATIVE_DATE}\\b`, 'gi'), dateContext);
    collect(/\b(?:with sources?|source links?|for beginners?|for kids|for students|step by step|in detail|briefly|short answer|quick answer)\b/gi, modifiers);
    collect(/\bfor\s+(?:breakfast|lunch|dinner|brunch|date night|families|kids|students|beginners?)\b/gi, modifiers);

    let target = raw;
    const stripPatterns = [
        new RegExp(`\\s*,?\\s+(?:around|about|in|during|for|on|as of|by|before|after|from)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?${MONTH_NAME}(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+(?:19|20)\\d{2})?\\s*$`, 'i'),
        new RegExp(`\\s*,?\\s+(?:around|about|in|during|for)\\s+${SEASON_NAME}\\s*$`, 'i'),
        /\s*,?\s+(?:in|during|for|as of|by|before|after|from)\s+(?:19|20)\d{2}\s*$/i,
        /\s*,?\s+(?:on|as of|by)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s*,?\s+(?:19|20)\d{2}\s*$/i,
        new RegExp(`\\s*,?\\s+${RELATIVE_DATE}\\s*$`, 'i'),
        /\s*,?\s+(?:with sources?|source links?|for beginners?|for kids|for students|step by step|in detail|briefly|short answer|quick answer)\s*$/i,
        /\s*,?\s+for\s+(?:breakfast|lunch|dinner|brunch|date night|families|kids|students|beginners?)\s*$/i
    ];

    let changed = true;
    while (changed) {
        changed = false;
        for (const pattern of stripPatterns) {
            const next = target.replace(pattern, '').trim();
            if (next !== target && next) {
                target = next;
                changed = true;
            }
        }
    }

    target = target
        .replace(/\s+(?:around|about|during|for|in|on|as of|by|before|after|from)\s*$/i, '')
        .replace(/[?.!,;]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        target,
        dateContext: dateContext.join(', '),
        modifiers
    };
}

export function cleanQueryTarget(value) {
    return extractQueryTargetMetadata(value).target;
}
