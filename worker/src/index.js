// A tiny backend for the weather app's AI-written note.
// It keeps the Anthropic API key off the public site, only answers the app's own pages,
// limits how often one visitor can call it, and checks every note before returning it.
import Anthropic from '@anthropic-ai/sdk';
import { PROMPT, PROMPT_VERSION, cleanFacts, checkNote } from './note.js';

const MODEL = 'claude-opus-5-5';

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    },
  });
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const origin = cors(request.headers.get('origin') || '', env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin ? 204 : 403, headers: origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } : {} });
    }
    if (!origin) return reply({ error: 'not allowed' }, 403, null);
    if (request.method !== 'POST') return reply({ error: 'use POST' }, 405, origin);

    const raw = await request.text();
    if (raw.length > 4000) return reply({ error: 'too large' }, 413, origin);
    let facts;
    try { facts = cleanFacts(JSON.parse(raw)); } catch { facts = null; }
    if (!facts) return reply({ error: 'bad facts' }, 400, origin);

    // Same facts, same note: answer from cache for a day so repeat visits cost nothing.
    const key = new Request('https://note.cache/' + PROMPT_VERSION + '/' + (await sha(JSON.stringify(facts))));
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) return reply({ ...(await hit.json()), cached: true }, 200, origin);

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'anon' });
      if (!success) return reply({ error: 'slow down' }, 429, origin);
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20000 });
    let note = '';
    try {
      const msg = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: PROMPT,
        messages: [{ role: 'user', content: 'Facts (JSON):\n' + JSON.stringify(facts, null, 1) }],
      });
      if (msg.stop_reason === 'refusal') return reply({ note: null, reason: 'declined' }, 200, origin);
      note = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().replace(/^"|"$/g, '');
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? e.status : 0;
      console.log('anthropic error', status, e?.message);
      return reply({ note: null, reason: 'model unavailable' }, 502, origin);
    }

    // Runtime guardrail: the code-checkable rules from the quality bar.
    const problems = checkNote(facts, note);
    if (problems.length) {
      console.log('note failed checks', problems.join('; '));
      return reply({ note: null, reason: 'failed checks' }, 200, origin);
    }
    const body = { note, version: PROMPT_VERSION };
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'cache-control': 'max-age=86400' } })));
    return reply(body, 200, origin);
  },
};
