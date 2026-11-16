// Everything that talks to Open-Meteo lives here. Free, no API key, and it runs right in the browser.
// Docs: https://open-meteo.com/en/docs

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const UNITS = 'temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph&timezone=auto';
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,snowfall_sum,weather_code,sunshine_duration,wind_speed_10m_max';
const DAY = 864e5;

// Days with at least this much rain (inches) count as wet. 1 mm is the usual cut-off for a "wet day".
export const WET = 0.04;
// We fetch this many days either side of the chosen date, so nearby days can be compared without another trip.
export const PAD = 9;

const iso = t => new Date(t).toISOString().slice(0, 10);
// Feb 29 only exists in leap years; use Feb 28 in the other years.
export const utcDate = (y, m, d) => (m === 1 && d === 29 && new Date(Date.UTC(y, 1, 29)).getUTCMonth() !== 1) ? Date.UTC(y, 1, 28) : Date.UTC(y, m, d);

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let reason = '';
    try { reason = (await res.json()).reason || ''; } catch { /* not JSON */ }
    const err = new Error(reason || `Weather service answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Run async jobs a few at a time, so we stay polite to a free service.
async function pool(jobs, size, onDone) {
  let next = 0, done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
      onDone?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
}

// ---- places ----
const label = p => [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : null, p.country].filter(Boolean).join(', ');

// "Portland, Maine" searches for "Portland", then prefers results whose state or country matches "Maine".
export async function searchPlaces(text, signal) {
  const [name, ...rest] = text.split(',').map(s => s.trim());
  if (!name || name.length < 2) return [];
  const j = await getJSON(`${GEO}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`, signal);
  const hint = rest.join(' ').toLowerCase();
  const places = (j.results || []).map(p => ({
    name: p.name, lat: p.latitude, lon: p.longitude, label: label(p),
    score: hint && [p.admin1, p.admin2, p.country, p.country_code].some(v => v && (v.toLowerCase().includes(hint) || hint.includes(v.toLowerCase()))) ? 1 : 0,
  }));
  return places.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ---- weather ----
const toDay = (d, i, source) => {
  if (d.temperature_2m_max[i] == null) return null;
  return {
    hi: Math.round(d.temperature_2m_max[i]),
    lo: Math.round(d.temperature_2m_min[i]),
    precip: d.precipitation_sum[i] ?? 0,
    rain: d.rain_sum?.[i] ?? d.precipitation_sum[i] ?? 0,
    snow: d.snowfall_sum?.[i] ?? 0,
    code: d.weather_code?.[i] ?? null,
    sun: d.sunshine_duration?.[i] != null ? d.sunshine_duration[i] / 3600 : null,
    wind: d.wind_speed_10m_max?.[i] != null ? Math.round(d.wind_speed_10m_max[i]) : null,
    chance: d.precipitation_probability_max?.[i] ?? null,
    source,
  };
};

// One store per place: every day we've fetched, keyed by YYYY-MM-DD.
export function createStore(place) {
  const days = new Map();     // date -> day record
  const asked = new Set();    // dates we've already requested (some come back empty)
  let forecastP = null;

  async function fetchRange(from, to, signal) {
    const j = await getJSON(`${ARCHIVE}?latitude=${place.lat}&longitude=${place.lon}&start_date=${iso(from)}&end_date=${iso(to)}&daily=${DAILY}&${UNITS}`, signal);
    j.daily.time.forEach((t, i) => { const r = toDay(j.daily, i, 'archive'); if (r) days.set(t, r); });
  }

  // The archive runs a few days behind, so recent days and the next 16 come from the forecast service.
  function forecast(signal) {
    forecastP ??= getJSON(`${FORECAST}?latitude=${place.lat}&longitude=${place.lon}&daily=${DAILY},precipitation_probability_max&past_days=14&forecast_days=16&${UNITS}`, signal)
      .then(j => {
        const out = new Map();
        j.daily.time.forEach((t, i) => { const r = toDay(j.daily, i, 'forecast'); if (r) out.set(t, r); });
        return out;
      })
      .catch(e => { forecastP = null; throw e; });
    return forecastP;
  }

  // Make sure we have PAD days either side of month/day, for every year from y0 to y1.
  async function load(y0, y1, month, day, signal, onProgress) {
    const today = Date.now(), lastArchive = today - 2 * DAY;
    const jobs = [];
    for (let y = y0; y <= y1; y++) {
      const c = utcDate(y, month, day);
      let from = null, to = null;
      for (let t = c - PAD * DAY; t <= Math.min(c + PAD * DAY, lastArchive); t += DAY) {
        if (asked.has(iso(t))) continue;
        from ??= t; to = t;
      }
      if (from === null) continue;
      for (let t = from; t <= to; t += DAY) asked.add(iso(t));
      jobs.push(() => fetchRange(from, to, signal).catch(e => {
        for (let t = from; t <= to; t += DAY) asked.delete(iso(t));
        throw e;
      }));
    }
    const fc = forecast(signal).catch(() => new Map()); // the forecast is a bonus; history still works without it
    await pool(jobs, 6, onProgress);
    const recent = await fc;
    const n = new Date(), todayStr = iso(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
    for (const [t, r] of recent) if (t < todayStr && !days.has(t)) days.set(t, r); // only days that have already happened
    return recent;
  }

  const get = (y, m, d) => days.get(iso(utcDate(y, m, d)));

  // Hour-by-hour temperature and rain for one date, from the archive or (for the next 16 days) the forecast.
  const hourCache = new Map();
  function hourly(dateStr, future) {
    if (!hourCache.has(dateStr)) {
      const base = future ? FORECAST : ARCHIVE;
      hourCache.set(dateStr, getJSON(`${base}?latitude=${place.lat}&longitude=${place.lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation&${UNITS}`)
        .then(j => ({ temp: j.hourly.temperature_2m, rain: j.hourly.precipitation }))
        .catch(e => { hourCache.delete(dateStr); throw e; }));
    }
    return hourCache.get(dateStr);
  }

  return { place, load, get, forecast, hourly };
}

// WMO weather codes, folded into the handful of doodles we draw.
export function condFrom(code, rain, snow) {
  if (snow >= 0.1) return 'snow';
  if (code >= 95) return 'storm';
  if ([65, 67, 82].includes(code)) return 'heavy';
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'snow';
  if (code >= 61 || (code >= 80 && code <= 82)) return rain >= 0.5 ? 'heavy' : 'rain';
  if (code >= 51) return 'drizzle';
  if (rain >= WET) return rain >= 0.5 ? 'heavy' : 'rain';
  if (code === 3 || code === 45 || code === 48) return 'cloudy';
  if (code === 1 || code === 2) return 'partly';
  if (code === 0) return 'clear';
  return 'cloudy';
}
