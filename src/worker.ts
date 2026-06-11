// ---------- Interfaces ----------
interface EventRow {
  id: number;
  title: string;
  description: string | null;
  event_date: string;
  latitude: number | null;
  longitude: number | null;
  hide_location: number;
  link: string | null;
  image_url: string | null;
  password_hash: string;
  location_password_hash: string | null;   // NEW
  status: string;
  approvals: number;
  reports: number;
  created_at: string;
}

interface VoteRow {
  id: number;
  event_id: number;
  ip: string;
  vote_type: string;
  created_at: string;
}

export interface Env {
  events_db: D1Database;      // <-- matches your wrangler.jsonc binding name
  ASSETS?: Fetcher;           // <-- for static files
  RECAPTCHA_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ADMIN_KEY: string;
}

// ---------- Your city coords (edit!) ----------
const CENTER_LAT = 43.7166;
const CENTER_LON = 10.4000;
const RADIUS_KM = 60;

// ---------- Geo helper ----------
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Crypto helpers ----------
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', data, { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256
  );
  const hashArray = new Uint8Array(derivedBits);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);
  return Array.from(combined, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const hashBytes = Uint8Array.from(
    storedHash.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
  );
  const salt = hashBytes.slice(0, 16);
  const originalHash = hashBytes.slice(16);
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const key = await crypto.subtle.importKey(
    'raw', data, { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256
  );
  const newHash = new Uint8Array(derivedBits);
  return newHash.length === originalHash.length &&
    newHash.every((v, i) => v === originalHash[i]);
}

// ---------- reCAPTCHA + Telegram ----------
async function verifyRecaptcha(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
  });
  const data = (await response.json()) as { success: boolean };
  return data.success === true;
}

async function sendTelegram(env: Env, message: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
  });
}

// ---------- Request handlers ----------
async function listEvents(env: Env): Promise<Response> {
  const { results } = await env.events_db.prepare(
    `SELECT id, title, description, event_date, latitude, longitude,
            hide_location, link, image_url, status, approvals, reports
     FROM events
     WHERE status = 'active' AND event_date >= datetime('now')
     ORDER BY event_date ASC`
  ).all<EventRow>();

  const safe = results.map((e) => ({
    ...e,
    latitude: e.hide_location ? null : e.latitude,
    longitude: e.hide_location ? null : e.longitude,
  }));
  return jsonResponse(safe);
}

async function createEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    title: string;
    description?: string;
    event_date: string;
    latitude?: number;
    longitude?: number;
    hide_location?: boolean;
    link?: string;
    image_url?: string;
    password: string;
    location_password?: string;  // NEW
    recaptcha: string;
  };

  if (!(await verifyRecaptcha(body.recaptcha, env.RECAPTCHA_SECRET)))
    return jsonResponse({ error: 'Captcha failed' }, 400);
  if (!body.title || !body.event_date || !body.password)
    return jsonResponse({ error: 'Missing title, date or password' }, 400);

  const eventDate = new Date(body.event_date);
  const now = new Date();
  const oneMonthLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (eventDate < now || eventDate > oneMonthLater)
    return jsonResponse({ error: 'Event date must be within the next 30 days' }, 400);

  if (body.latitude !== undefined && body.longitude !== undefined) {
    if (getDistanceKm(CENTER_LAT, CENTER_LON, body.latitude, body.longitude) > RADIUS_KM)
      return jsonResponse({ error: 'Event location outside allowed area' }, 400);
  }

  // Require location password if hiding location
  if (body.hide_location && !body.location_password) {
    return jsonResponse({ error: 'A location password is required when hiding the location' }, 400);
  }

  const passwordHash = await hashPassword(body.password);
  const locationHash = body.hide_location && body.location_password
    ? await hashPassword(body.location_password)
    : null;

  const info = await env.events_db.prepare(
    `INSERT INTO events (title, description, event_date, latitude, longitude,
                         hide_location, link, image_url, password_hash, location_password_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.title,
      body.description || null,
      body.event_date,
      body.latitude ?? null,
      body.longitude ?? null,
      body.hide_location ? 1 : 0,
      body.link || null,
      body.image_url || null,
      passwordHash,
      locationHash      // NEW
    )
    .run();

  return jsonResponse({ id: info.meta.last_row_id }, 201);
}

async function listPending(env: Env): Promise<Response> {
  const { results } = await env.events_db.prepare(
    `SELECT id, title, description, event_date, hide_location, link, image_url, approvals
     FROM events WHERE status = 'pending' ORDER BY created_at DESC`
  ).all<EventRow>();
  return jsonResponse(results);
}

async function approveEvent(id: number, request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const existing = await env.events_db.prepare(
    'SELECT id FROM votes WHERE event_id = ? AND ip = ? AND vote_type = ?'
  )
    .bind(id, ip, 'approve')
    .first<VoteRow>();
  if (existing) return jsonResponse({ error: 'Already approved' }, 400);

  await env.events_db.prepare(
    'INSERT OR IGNORE INTO votes (event_id, ip, vote_type) VALUES (?, ?, ?)'
  )
    .bind(id, ip, 'approve')
    .run();

  await env.events_db.prepare('UPDATE events SET approvals = approvals + 1 WHERE id = ?')
    .bind(id)
    .run();

  const event = await env.events_db.prepare('SELECT approvals FROM events WHERE id = ?')
    .bind(id)
    .first<{ approvals: number }>();

  if (event && event.approvals >= 1) {
    await env.events_db.prepare("UPDATE events SET status = 'active' WHERE id = ?")
      .bind(id)
      .run();
  }
  return jsonResponse({ success: true });
}

async function reportEvent(id: number, request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const existing = await env.events_db.prepare(
    'SELECT id FROM votes WHERE event_id = ? AND ip = ? AND vote_type = ?'
  )
    .bind(id, ip, 'report')
    .first<VoteRow>();
  if (existing) return jsonResponse({ error: 'Already reported' }, 400);

  await env.events_db.prepare(
    'INSERT OR IGNORE INTO votes (event_id, ip, vote_type) VALUES (?, ?, ?)'
  )
    .bind(id, ip, 'report')
    .run();

  await env.events_db.prepare('UPDATE events SET reports = reports + 1 WHERE id = ?')
    .bind(id)
    .run();

  const event = await env.events_db.prepare('SELECT title, reports FROM events WHERE id = ?')
    .bind(id)
    .first<{ title: string; reports: number }>();

  if (event && event.reports >= 1) {
    await env.events_db.prepare("UPDATE events SET status = 'hidden' WHERE id = ?")
      .bind(id)
      .run();
    await sendTelegram(env, `Event "${event.title}" was hidden after 10 reports.`);
  }
  return jsonResponse({ success: true });
}

async function revealLocation(id: number, request: Request, env: Env): Promise<Response> {
  const { password } = (await request.json()) as { password: string };
  if (!password) return jsonResponse({ error: 'Password required' }, 400);

  const event = await env.events_db.prepare(
    'SELECT latitude, longitude, hide_location, location_password_hash FROM events WHERE id = ?'
  )
    .bind(id)
    .first<{
      latitude: number;
      longitude: number;
      hide_location: number;
      location_password_hash: string | null;
    }>();

  if (!event || !event.hide_location) {
    return jsonResponse({ error: 'Location not hidden or event not found' }, 404);
  }

  if (!event.location_password_hash) {
    return jsonResponse({ error: 'No location password set for this event' }, 400);
  }

  const match = await verifyPassword(password, event.location_password_hash);
  if (!match) return jsonResponse({ error: 'Incorrect location password' }, 403);

  return jsonResponse({
    latitude: event.latitude,
    longitude: event.longitude,
  });
}

async function editEvent(id: number, request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    password: string;               // event password
    title?: string;
    description?: string;
    event_date?: string;
    latitude?: number;
    longitude?: number;
    hide_location?: boolean;
    link?: string;
    image_url?: string;
    location_password?: string;     // NEW
  };

  if (!body.password) return jsonResponse({ error: 'Event password required' }, 400);

  // Verify the event password
  const event = await env.events_db.prepare(
    'SELECT password_hash, location_password_hash FROM events WHERE id = ?'
  ).bind(id).first<{ password_hash: string; location_password_hash: string | null }>();
  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  const match = await verifyPassword(body.password, event.password_hash);
  if (!match) return jsonResponse({ error: 'Incorrect event password' }, 403);

  // Build dynamic update query
  const fields: string[] = [];
  const params: any[] = [];

  if (body.title !== undefined) { fields.push('title = ?'); params.push(body.title); }
  if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
  if (body.event_date !== undefined) { fields.push('event_date = ?'); params.push(body.event_date); }
  if (body.latitude !== undefined) { fields.push('latitude = ?'); params.push(body.latitude); }
  if (body.longitude !== undefined) { fields.push('longitude = ?'); params.push(body.longitude); }
  if (body.hide_location !== undefined) { fields.push('hide_location = ?'); params.push(body.hide_location ? 1 : 0); }
  if (body.link !== undefined) { fields.push('link = ?'); params.push(body.link); }
  if (body.image_url !== undefined) { fields.push('image_url = ?'); params.push(body.image_url); }

  // Handle location password
  if (body.location_password !== undefined) {
    if (body.location_password === '') {
      // Remove location password
      fields.push('location_password_hash = ?');
      params.push(null);
    } else {
      const newLocHash = await hashPassword(body.location_password);
      fields.push('location_password_hash = ?');
      params.push(newLocHash);
    }
  }

  if (fields.length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  params.push(id);
  await env.events_db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  return jsonResponse({ success: true });
}

async function getEventData(id: number, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  if (!password) return jsonResponse({ error: 'Password required' }, 400);

  const event = await env.events_db.prepare(
    'SELECT * FROM events WHERE id = ?'
  ).bind(id).first<EventRow>();

  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  const match = await verifyPassword(password, event.password_hash);
  if (!match) return jsonResponse({ error: 'Incorrect password' }, 403);

  // Return everything except the password hash
  const { password_hash, location_password_hash, ...safe } = event;
  return jsonResponse(safe);
}

async function cancelEvent(id: number, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || request.headers.get('X-Admin-Key');
  if (key !== env.ADMIN_KEY) return jsonResponse({ error: 'Unauthorized' }, 401);

  await env.events_db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?")
    .bind(id)
    .run();
  return jsonResponse({ success: true });
}

async function adminList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || request.headers.get('X-Admin-Key');
  if (key !== env.ADMIN_KEY) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { results } = await env.events_db.prepare('SELECT * FROM events').all<EventRow>();
  return jsonResponse(results);
}

// ---------- Utilities ----------
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ---------- Main handler ----------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
        },
      });
    }

    // ---------- Serve static assets only for GET/HEAD ----------
    if (env.ASSETS && (method === 'GET' || method === 'HEAD')) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.ok) return assetResponse;
      // If not found, fall through to API routes (e.g., /api/events could also be GET)
    }

    // ---------- API routes ----------
    const path = url.pathname;
    try {
      if (path === '/api/events' && method === 'GET') return await listEvents(env);
      if (path === '/api/events' && method === 'POST') return await createEvent(request, env);
      if (path === '/api/events/pending' && method === 'GET') return await listPending(env);

      const approveMatch = path.match(/^\/api\/events\/(\d+)\/approve$/);
      if (approveMatch && method === 'POST') return await approveEvent(Number(approveMatch[1]), request, env);

      const reportMatch = path.match(/^\/api\/events\/(\d+)\/report$/);
      if (reportMatch && method === 'POST') return await reportEvent(Number(reportMatch[1]), request, env);

      const revealMatch = path.match(/^\/api\/events\/(\d+)\/reveal$/);
      if (revealMatch && method === 'POST') return await revealLocation(Number(revealMatch[1]), request, env);

      const editMatch = path.match(/^\/api\/events\/(\d+)\/edit$/);
      if (editMatch && method === 'POST') return await editEvent(Number(editMatch[1]), request, env);

      // New route: GET /api/events/:id?password=... → full event data (if password OK)
      const editDataMatch = path.match(/^\/api\/events\/(\d+)$/);
      if (editDataMatch && method === 'GET') {
        return await getEventData(Number(editDataMatch[1]), request, env);
      }

      const cancelMatch = path.match(/^\/api\/events\/(\d+)$/);
      if (cancelMatch && method === 'DELETE') return await cancelEvent(Number(cancelMatch[1]), request, env);

      if (path === '/api/admin' && method === 'GET') return await adminList(request, env);

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    if (event.cron === '0 * * * *') {
      await env.events_db.prepare(
        "DELETE FROM events WHERE event_date < datetime('now') AND status != 'pending'"
      ).run();
      console.log('Old events cleaned');
    }
  },
};