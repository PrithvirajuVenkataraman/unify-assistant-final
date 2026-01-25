// Vercel Serverless Function to send push notifications via Firebase Admin SDK
// This uses the FCM HTTP v1 API (modern approach)

export const config = {
  runtime: 'edge',
};

// Get OAuth2 access token using service account
async function getAccessToken() {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  };

  if (!serviceAccount.private_key || !serviceAccount.client_email) {
    throw new Error('Firebase service account not configured');
  }

  // Create JWT for OAuth2
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  // Base64URL encode
  const base64URLEncode = (obj) => {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const encodedHeader = base64URLEncode(header);
  const encodedClaim = base64URLEncode(claim);
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  // Sign with RSA-SHA256
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureInput);

  // Import the private key
  const pemContents = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data);
  const encodedSignature = base64URLEncode(String.fromCharCode(...new Uint8Array(signature)));

  const jwt = `${signatureInput}.${encodedSignature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}

export default async function handler(req) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const { token, title, body, data } = await req.json();

    if (!token) {
      return new Response(JSON.stringify({ error: 'FCM token required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Get access token
    const accessToken = await getAccessToken();
    const projectId = process.env.FIREBASE_PROJECT_ID;

    // FCM v1 API endpoint
    const FCM_URL = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const message = {
      message: {
        token: token,
        notification: {
          title: title || '⏰ JARVIS Reminder',
          body: body || 'You have a reminder!'
        },
        webpush: {
          notification: {
            icon: '/jarvis-icon.png',
            badge: '/jarvis-badge.png',
            requireInteraction: true,
            vibrate: [200, 100, 200]
          },
          fcm_options: {
            link: '/'
          }
        },
        data: data || {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            click_action: 'OPEN_APP'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      }
    };

    const response = await fetch(FCM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(message)
    });

    const result = await response.json();

    if (response.ok) {
      return new Response(JSON.stringify({ success: true, messageId: result.name }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } else {
      console.error('FCM Error:', result);
      return new Response(JSON.stringify({ error: 'Failed to send notification', details: result }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

  } catch (error) {
    console.error('Notification error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
