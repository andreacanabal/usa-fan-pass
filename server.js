// ═══════════════════════════════════════════════════════════════════
//  USA Fan Pass — Railway Backend
//  Stack: Express + Stripe + Brevo + Meta CAPI
// ═══════════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://www.usfanpass.com',
    'https://usfanpass.com',
    'https://usa-fan-pass.vercel.app',
    /\.vercel\.app$/,
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// ── GUIDE URL MAP (fill in after guides are published) ─────────────
const GUIDE_URLS = {
  'price_1TeUZHDOZDPnW2si7YRj9qhG': 'https://usa-fan-pass.vercel.app/nynj-worldcup-guide.html',
  'price_1TeUaIDOZDPnW2sipYerWpA2': 'https://usa-fan-pass.vercel.app/la-fan-pass-2026.html',
  'price_1TeUb8DOZDPnW2siOvLfQ7RX': 'https://usa-fan-pass.vercel.app/dallas-fan-pass-2026.html',
  'price_1TeUdqDOZDPnW2sipYiOrfNv': 'https://usa-fan-pass.vercel.app/miami-fan-pass.html',
  'price_1TeUeMDOZDPnW2sip35GFYKj': 'https://usa-fan-pass.vercel.app/boston-fan-pass-2026.html',
  'price_1TeUp8DOZDPnW2si7hiuKE0z': 'https://usa-fan-pass.vercel.app/healthcare-survival-guide-wc2026.html',
  'price_1TeUpwDOZDPnW2siFr72aDX3': 'https://usa-fan-pass.vercel.app/know-your-rights-worldcup2026.html',
  'price_1TeUqkDOZDPnW2sizJjJbRMA': 'https://usa-fan-pass.vercel.app/wc2026-survival-guide.html',
  'price_1TeUgxDOZDPnW2siWe11knVD': 'https://usa-fan-pass.vercel.app/nynj-worldcup-guide.html',
  'price_1TeUhhDOZDPnW2si5yoobFtz': 'https://usa-fan-pass.vercel.app/la-fan-pass-2026.html',
  'price_1TeUigDOZDPnW2siaJlOGcbH': 'https://usa-fan-pass.vercel.app/nynj-worldcup-guide.html',
  'price_1TeUjgDOZDPnW2siK0DVCXCw': 'https://usa-fan-pass.vercel.app/nynj-worldcup-guide.html',
};

// ── BREVO HELPERS ─────────────────────────────────────────────────
async function addBuyerToBrevo({ email, firstName, lastName, cities, orderValue, guideUrls }) {
  const body = {
    email,
    attributes: {
      FIRSTNAME:   firstName  || '',
      LASTNAME:    lastName   || '',
      CITIES:      cities     || '',
      ORDER_VALUE: orderValue || 0,
      GUIDE_URLS:  guideUrls  || '',
      SOURCE:      'USA Fan Pass — Confirmed Purchase',
    },
    listIds: [parseInt(process.env.BREVO_BUYERS_LIST_ID || '5')],
    updateEnabled: true,
  };

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if(!res.ok) {
    const err = await res.text();
    console.error('Brevo buyer error:', err);
  } else {
    console.log('Brevo buyer added:', email);
  }
}

async function captureLeadBrevo({ email, name, cities, orderValue }) {
  const nameParts = (name || '').split(' ');
  const body = {
    email,
    attributes: {
      FIRSTNAME:   nameParts[0] || '',
      LASTNAME:    nameParts.slice(1).join(' ') || '',
      CITIES:      cities     || '',
      ORDER_VALUE: orderValue || 0,
      SOURCE:      'USA Fan Pass — Lead',
    },
    listIds: [parseInt(process.env.BREVO_LEADS_LIST_ID || '3')],
    updateEnabled: true,
  };

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if(!res.ok) console.error('Brevo lead error:', await res.text());
  else console.log('Brevo lead captured:', email);
}

// ── META CAPI HELPER ──────────────────────────────────────────────
async function sendMetaCAPI({ email, value, currency, eventId, priceIds, userAgent, sourceUrl }) {
  const pixelId = process.env.META_PIXEL_ID;
  const token   = process.env.META_CAPI_TOKEN;
  if(!pixelId || !token) { console.warn('Meta CAPI not configured'); return; }

  const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

  const payload = {
    data: [{
      event_name:       'Purchase',
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         eventId,
      event_source_url: sourceUrl || 'https://usfanpass.com',
      action_source:    'website',
      user_data: {
        em:         [hashedEmail],
        client_user_agent: userAgent || '',
      },
      custom_data: {
        value:        value,
        currency:     currency || 'USD',
        content_ids:  priceIds || [],
        content_type: 'product',
      },
    }],
  };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  const result = await res.json();
  if(result.error) console.error('Meta CAPI error:', result.error);
  else console.log('Meta CAPI Purchase fired. Events received:', result.events_received);
}

// ═══════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'usa-fan-pass', ts: new Date().toISOString() });
});

// ── Buyer count ───────────────────────────────────────────────────
app.get('/buyer-count', async (req, res) => {
  try {
    const BASE_COUNT = 1204; // seed number shown before real data
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
    });
    const count = BASE_COUNT + sessions.data.length;
    res.json({ count });
  } catch(err) {
    console.error('buyer-count error:', err.message);
    res.json({ count: 1204 });
  }
});

// ── Capture lead (email gate — before payment) ────────────────────
app.post('/capture-lead', async (req, res) => {
  const { email, name, cities, orderValue } = req.body;
  if(!email) return res.status(400).json({ error: 'Email required' });

  try {
    await captureLeadBrevo({ email, name, cities, orderValue });
    res.json({ ok: true });
  } catch(err) {
    console.error('capture-lead error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Create Stripe Embedded Checkout session ───────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const { lineItems, email } = req.body;

  if(!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'No items in cart' });
  }

  const origin = req.headers.origin || 'https://usafanpass.com';

  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode:              'embedded',
      mode:                 'payment',
      currency:             'usd',
      line_items:           lineItems,
      customer_email:       email || undefined,
      return_url:           `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      payment_method_types: ['card', 'link'],
      locale:               'en',
      customer_creation:    'always',
      metadata: {
        source: 'usa-fan-pass',
      },
    });

    res.json({ clientSecret: session.client_secret });
  } catch(err) {
    console.error('create-checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Verify session + trigger Brevo + Meta CAPI ────────────────────
app.get('/verify-session', async (req, res) => {
  const { session_id } = req.query;
  if(!session_id) return res.status(400).json({ error: 'session_id required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'customer'],
    });

    if(session.status !== 'complete') {
      return res.json({ status: session.status });
    }

    // Parse customer info
    const email     = session.customer_details?.email || session.customer_email || '';
    const fullName  = session.customer_details?.name  || '';
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName  = nameParts.slice(1).join(' ') || '';
    const amount    = (session.amount_total || 0) / 100;
    const currency  = session.currency?.toUpperCase() || 'USD';

    // Build guide URLs + product names from line items
    const lineItems   = session.line_items?.data || [];
    const priceIds    = lineItems.map(i => i.price?.id).filter(Boolean);
    const guideUrls   = priceIds.map(id => GUIDE_URLS[id]).filter(Boolean);
    const productNames = lineItems.map(i => i.description || i.price?.nickname || '').filter(Boolean);

    const guideUrlsStr  = guideUrls.join(' | ');
    const citiesStr     = productNames.join(' + ');
    const primaryGuide  = guideUrls[0] || null;

    // Fire Brevo buyer automation
    if(email) {
      await addBuyerToBrevo({
        email, firstName, lastName,
        cities: citiesStr,
        orderValue: amount,
        guideUrls: guideUrlsStr,
      });
    }

    // Fire Meta CAPI Purchase (server-side)
    const eventId   = 'purchase_' + session_id;
    const userAgent = req.headers['user-agent'] || '';
    if(email) {
      await sendMetaCAPI({
        email, value: amount, currency,
        eventId, priceIds,
        userAgent,
        sourceUrl: `https://usfanpass.com/success.html`,
      });
    }

    res.json({
      status:        'complete',
      amount_total:  amount,
      currency,
      customer_name: fullName,
      email,
      line_items:    lineItems,
      guide_urls:    guideUrls,
      primary_guide: primaryGuide,
    });

  } catch(err) {
    console.error('verify-session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`USA Fan Pass server running on port ${PORT}`);
});
