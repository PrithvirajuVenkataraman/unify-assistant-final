export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { plan } = req.body || {};
        if (!plan || !plan.title || !plan.destination) {
            return res.status(400).json({ success: false, error: 'Missing plan data' });
        }

        const start = nextMorningUtc();
        const end = new Date(start.getTime() + Math.max(1, Number(plan.days || 1)) * 24 * 60 * 60 * 1000);

        const title = plan.title;
        const description = `${plan.notes || 'Trip plan'}\nTotal budget: ${plan.currency} ${plan.totalBudget}`;
        const location = plan.destination;

        const ics = buildIcs({ title, description, location, start, end });
        const icsBase64 = Buffer.from(ics, 'utf8').toString('base64');
        const googleCalendarUrl = buildGoogleCalendarUrl({ title, description, location, start, end });

        return res.status(200).json({
            success: true,
            fileName: `${safeFileName(title)}.ics`,
            icsBase64,
            googleCalendarUrl
        });
    } catch (error) {
        console.error('calendar sync api error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

function nextMorningUtc() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 9, 0, 0));
    return d;
}

function formatIcsDate(dt) {
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const mm = String(dt.getUTCMinutes()).padStart(2, '0');
    const ss = String(dt.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function escapeIcsText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function buildIcs({ title, description, location, start, end }) {
    const uid = `${Date.now()}@unify-assistant`;
    const dtStamp = formatIcsDate(new Date());
    const dtStart = formatIcsDate(start);
    const dtEnd = formatIcsDate(end);

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Unify Assistant//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${escapeIcsText(title)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        `LOCATION:${escapeIcsText(location)}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');
}

function buildGoogleCalendarUrl({ title, description, location, start, end }) {
    const dates = `${formatIcsDate(start)}/${formatIcsDate(end)}`;
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: title,
        dates,
        details: description,
        location
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function safeFileName(name) {
    return String(name || 'trip-plan')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'trip-plan';
}
