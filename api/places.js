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
        const { query = '', type = 'hotel' } = req.body || {};
        const destination = extractDestination(query);

        if (!destination) {
            return res.status(200).json({
                success: false,
                message: 'Destination not found in query',
                places: []
            });
        }

        const geo = await geocode(destination);
        if (!geo) {
            return res.status(200).json({
                success: false,
                message: 'Could not geocode destination',
                places: []
            });
        }

        const places = await fetchVerifiedPlaces(geo.lat, geo.lon, type);

        return res.status(200).json({
            success: true,
            type,
            locationName: geo.display_name || destination,
            center: { lat: geo.lat, lon: geo.lon },
            places
        });
    } catch (error) {
        console.error('places api error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

function extractDestination(query) {
    const q = String(query || '').trim();
    const patterns = [
        /\b(?:in|near|around|at)\s+([a-zA-Z][a-zA-Z\s,.-]{1,60})$/i,
        /\b(?:in|near|around|at)\s+([a-zA-Z][a-zA-Z\s,.-]{1,60})\b/i,
        /\bto\s+([a-zA-Z][a-zA-Z\s,.-]{1,60})\b/i
    ];

    for (const p of patterns) {
        const m = q.match(p);
        if (m && m[1]) return m[1].trim();
    }

    return '';
}

async function geocode(place) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'unify-assistant/1.0'
        }
    });

    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return {
        lat: Number(data[0].lat),
        lon: Number(data[0].lon),
        display_name: data[0].display_name
    };
}

async function fetchVerifiedPlaces(lat, lon, type) {
    const radius = 5000;
    const isRestaurant = String(type).toLowerCase().includes('restaurant');

    const query = isRestaurant
        ? `
[out:json][timeout:25];
(
  node["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lon});
  way["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lon});
  relation["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lon});
);
out center tags 25;
`
        : `
[out:json][timeout:25];
(
  node["tourism"~"hotel|guest_house|hostel|motel"](around:${radius},${lat},${lon});
  way["tourism"~"hotel|guest_house|hostel|motel"](around:${radius},${lat},${lon});
  relation["tourism"~"hotel|guest_house|hostel|motel"](around:${radius},${lat},${lon});
);
out center tags 25;
`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString()
    });

    if (!response.ok) return [];
    const data = await response.json();
    const elements = Array.isArray(data.elements) ? data.elements : [];

    const mapped = elements
        .map(el => {
            const pLat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
            const pLon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
            const tags = el.tags || {};
            const name = tags.name || null;
            if (!name || typeof pLat !== 'number' || typeof pLon !== 'number') return null;

            const addressParts = [
                tags['addr:housenumber'],
                tags['addr:street'],
                tags['addr:city'] || tags['addr:town'] || tags['addr:village']
            ].filter(Boolean);

            return {
                name,
                lat: pLat,
                lon: pLon,
                address: addressParts.join(', '),
                source: 'OpenStreetMap'
            };
        })
        .filter(Boolean);

    const uniqueByName = [];
    const seen = new Set();
    for (const p of mapped) {
        const key = p.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueByName.push(p);
    }

    return uniqueByName.slice(0, 10);
}
