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
        const origin = normalizePoint(req.body?.origin);
        const destination = normalizePoint(req.body?.destination);
        const mode = normalizeMode(req.body?.mode);

        if (!origin || !destination) {
            return res.status(400).json({ success: false, error: 'origin and destination are required' });
        }

        const tomTomKey = process.env.TOMTOM_API_KEY || process.env.TOMTOM_KEY;
        if (tomTomKey) {
            const trafficResult = await fetchTomTomRoute({ origin, destination, mode, apiKey: tomTomKey });
            if (trafficResult) {
                return res.status(200).json({
                    success: true,
                    liveTraffic: true,
                    provider: 'tomtom',
                    ...trafficResult
                });
            }
        }

        const fallback = buildFallbackEstimate(origin, destination, mode);
        return res.status(200).json({
            success: true,
            liveTraffic: false,
            provider: 'fallback',
            ...fallback
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'route estimate failed',
            details: String(error?.message || error)
        });
    }
}

function normalizePoint(value) {
    const lat = Number(value?.lat);
    const lon = Number(value?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
        lat,
        lon,
        label: String(value?.label || '').trim()
    };
}

function normalizeMode(mode) {
    const raw = String(mode || 'drive').toLowerCase();
    if (raw === 'walk' || raw === 'walking') return 'walk';
    if (raw === 'transit' || raw === 'bus' || raw === 'train') return 'transit';
    return 'drive';
}

async function fetchTomTomRoute({ origin, destination, mode, apiKey }) {
    const travelMode = mode === 'walk' ? 'pedestrian' : 'car';
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lon}:${destination.lat},${destination.lon}/json?traffic=true&travelMode=${travelMode}&routeType=fastest&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const route = Array.isArray(data?.routes) ? data.routes[0] : null;
    const summary = route?.summary;
    if (!summary) return null;

    return {
        durationMinutes: Number(summary.travelTimeInSeconds || 0) / 60,
        trafficDelayMinutes: Number(summary.trafficDelayInSeconds || 0) / 60,
        distanceMiles: Number(summary.lengthInMeters || 0) / 1609.344
    };
}

function buildFallbackEstimate(origin, destination, mode) {
    const straightLineMiles = haversineMiles(origin.lat, origin.lon, destination.lat, destination.lon);
    const roadMiles = Math.max(0.1, straightLineMiles * 1.22);
    const mph = mode === 'walk' ? 3.1 : mode === 'transit' ? 16 : 26;
    return {
        durationMinutes: Math.max(3, (roadMiles / mph) * 60),
        trafficDelayMinutes: 0,
        distanceMiles: roadMiles
    };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const R = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
