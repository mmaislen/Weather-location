// Was it raining when you were born?
// One watercolor stripe per year for a chosen date and place, then the next ten years sketched in pencil as odds.
import { createStore, searchPlaces, condFrom, utcDate, WET } from './weather.js';

const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COL = { cold:'#4a86b8', mild:'#efe2c8', warm:'#d4623c', ink:'#3b2f25', pencil:'#6e6253', faint:'#b9ab95', rain:'#244e78', snow:'#5f7896', good:'#3f7d4e' };
const HAND = '"Caveat","Segoe Print",cursive';
const CONDS = { snow:'Snow', clear:'Clear and sunny', partly:'Partly cloudy', cloudy:'Overcast', drizzle:'Light rain', rain:'Rain', heavy:'Heavy rain', storm:'Thunderstorms' };
const NFUT = 10, DAY = 864e5, ODDS_YEARS = 41, FIRST_YEAR = 1940;
const FALLBACK = { name:'Seattle', label:'Seattle, Washington, United States', lat:47.6062, lon:-122.3321 };

const now = new Date();
const TODAY = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const iso = t => new Date(t).toISOString().slice(0, 10);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

// Open on today's date, 50 years back, in a city guessed from the visitor's time zone (no permission prompt).
let place = null, store = null, recent = new Map();
let month = now.getMonth(), dayN = now.getDate(), start = now.getFullYear() - 50;
let items = [], past = [], fut = [], normal = 0, stats = null, sel = null, hover = null;

const isToday = y => Date.UTC(y, month, dayN) === TODAY;
const ord = n => n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th','st','nd','rd'][n % 10] || 'th';
const dateLabel = () => MON[month] + ' ' + dayN;
const rng = seed => { let s = (Math.round(seed) % 2147483647 + 2147483647) % 2147483647 || 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
const firstFuture = (m, d) => Date.UTC(now.getFullYear(), m, d) >= TODAY ? now.getFullYear() : now.getFullYear() + 1;
const shift = (y, m, d, k) => { const t = new Date(utcDate(y, m, d) + k * DAY); return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]; };

// ---- turning raw days into what we draw ----
function dayRec(y, m, d) {
  const r = store.get(y, m, d); if (!r) return null;
  const rain = r.rain >= 0.01 ? +r.rain.toFixed(2) : 0, snow = r.snow >= 0.1 ? +r.snow.toFixed(1) : 0;
  return { y, hi: r.hi, lo: r.lo, rain, snow, precip: r.precip, sun: r.sun, wind: r.wind, cond: condFrom(r.code, r.precip, r.snow) };
}

// Every year of this date we have, plus the 1991–2020 normal high (using two days either side, to smooth out noise).
function series(m, d) {
  const last = firstFuture(m, d) - 1, all = [];
  for (let y = Math.min(start, last - ODDS_YEARS + 1); y <= last; y++) { const r = dayRec(y, m, d); if (r) all.push(r); }
  let s = 0, n = 0;
  for (let y = 1991; y <= 2020; y++) for (let k = -2; k <= 2; k++) { const r = store.get(...shift(y, m, d, k)); if (r) { s += r.hi; n++; } }
  const nrm = n ? s / n : all.reduce((a, x) => a + x.hi, 0) / Math.max(1, all.length);
  all.forEach(x => x.anom = x.hi - nrm);
  return { all, normal: nrm };
}

// Odds for a date, from the last 41 years of it (two days either side, so about 200 days to learn from).
function odds(m, d, nrm) {
  const last = firstFuture(m, d) - 1, p = [];
  for (let y = last - ODDS_YEARS + 1; y <= last; y++) for (let k = -2; k <= 2; k++) { const r = store.get(...shift(y, m, d, k)); if (r) p.push({ y, ...r }); }
  const n = p.length; if (!n) return null;
  const wet = p.filter(x => x.precip >= WET).length;
  // Warming trend: a straight line through the highs, kept to a sensible range so one odd decade can't run away with it.
  const yc = p.reduce((a, x) => a + x.y, 0) / n, hc = p.reduce((a, x) => a + x.hi, 0) / n;
  const sxy = p.reduce((a, x) => a + (x.y - yc) * (x.hi - hc), 0), sxx = p.reduce((a, x) => a + (x.y - yc) ** 2, 0);
  const slope = Math.max(-0.1, Math.min(0.15, sxx ? sxy / sxx : 0));
  const base = p.map(x => x.hi - (x.y - yc) * slope).sort((a, b) => a - b), q = f => base[Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))))];
  const conds = {}; p.forEach(x => { const c = condFrom(x.code, x.precip, x.snow); conds[c] = (conds[c] || 0) + 1; });
  return { n, wet, dry: 1 - wet / n, q10: q(.1), q90: q(.9), median: q(.5), yc, slope, normal: nrm,
    common: Object.entries(conds).sort((a, b) => b[1] - a[1])[0][0], snowy: p.filter(x => x.snow >= 0.1).length };
}
const proj = (o, y) => ({ lo: Math.round(o.q10 + (y - o.yc) * o.slope), hi: Math.round(o.q90 + (y - o.yc) * o.slope), mid: o.median + (y - o.yc) * o.slope });

function gen() {
  const s = series(month, dayN); normal = s.normal; stats = odds(month, dayN, normal);
  const ff = firstFuture(month, dayN);
  past = s.all.filter(x => x.y >= start).map(x => ({ ...x, future: false }));
  fut = [];
  for (let k = 0; k < NFUT; k++) {
    const y = ff + k, p = proj(stats, y), fc = recent.get(iso(utcDate(y, month, dayN)));
    fut.push(fc ? { y, future: true, fc, lo: fc.lo, hi: fc.hi, mid: fc.hi, anom: fc.hi - normal, cond: condFrom(fc.code, fc.precip, fc.snow) }
                : { y, future: true, lo: p.lo, hi: p.hi, mid: p.mid, anom: p.mid - normal });
  }
  items = past.concat(fut);
  if (sel === null || sel >= items.length) sel = past.length; // the next one coming up
}

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function tone(an) { const t = Math.max(-1, Math.min(1, an / 10)); const [a, b, k] = t < 0 ? [hex(COL.mild), hex(COL.cold), -t] : [hex(COL.mild), hex(COL.warm), t]; return a.map((v, i) => Math.round(v + (b[i] - v) * k)); }
const rgba = (c, a) => `rgba(${c.join(',')},${a})`;

// ---- hand-drawn helpers ----
function wash(c, x, y, w, h, col, r) { for (let p = 0; p < 3; p++) { c.fillStyle = rgba(col, .4); c.beginPath(); const j = () => (r() - .5) * Math.min(3.4, w * .25); c.moveTo(x + j(), y + j() * 2); for (let yy = y; yy <= y + h; yy += 22) c.lineTo(x + w + j(), yy + j()); c.lineTo(x + w + j(), y + h + j()); for (let yy = y + h; yy >= y; yy -= 22) c.lineTo(x + j(), yy + j()); c.closePath(); c.fill(); } }
function drop(c, x, y, s) { c.beginPath(); c.moveTo(x, y - 4 * s); c.quadraticCurveTo(x + 3 * s, y + 1 * s, x, y + 3 * s); c.quadraticCurveTo(x - 3 * s, y + 1 * s, x, y - 4 * s); c.stroke(); }
function flake(c, x, y, s) { for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; c.beginPath(); c.moveTo(x - Math.cos(a) * 4 * s, y - Math.sin(a) * 4 * s); c.lineTo(x + Math.cos(a) * 4 * s, y + Math.sin(a) * 4 * s); c.stroke(); } }
function pencilRect(c, x, y, w, h, r, lw, col) { c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round'; for (let p = 0; p < 2; p++) { const j = () => (r() - .5) * 3; c.beginPath(); c.moveTo(x + j() - 2, y + j()); c.lineTo(x + w + j() + 2, y + j()); c.lineTo(x + w + j(), y + h + j() + 2); c.lineTo(x + j(), y + h + j()); c.lineTo(x + j(), y + j() - 3); c.stroke(); } }
function arrow(c, x0, y0, x1, y1) { const mx = (x0 + x1) / 2 + (y1 - y0) * .25, my = (y0 + y1) / 2 - 12; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1); c.stroke(); const a = Math.atan2(y1 - my, x1 - mx); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - Math.cos(a - .5) * 9, y1 - Math.sin(a - .5) * 9); c.moveTo(x1, y1); c.lineTo(x1 - Math.cos(a + .5) * 9, y1 - Math.sin(a + .5) * 9); c.stroke(); }
function legends() {
  document.querySelectorAll('.lg1').forEach(cv => { const c = cv.getContext('2d'); c.clearRect(0, 0, 300, 40); const r = rng(3); for (let i = 0; i < 10; i++) wash(c, i * 30, 4, 30, 32, tone(-10 + i * 20 / 9), r); });
  document.querySelectorAll('.lg2').forEach(cv => { const c = cv.getContext('2d'); c.clearRect(0, 0, 48, 40); c.strokeStyle = COL.rain; c.lineWidth = 2.4; c.lineCap = 'round'; drop(c, 16, 18, 2); drop(c, 34, 26, 1.6); });
}
function doodle(c, cond) {
  c.clearRect(0, 0, 120, 96); c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; const r = rng(9);
  const sun = (x, y, s) => { c.strokeStyle = '#d99a2b'; c.fillStyle = 'rgba(242,190,80,.55)'; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill(); c.stroke(); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; c.beginPath(); c.moveTo(x + Math.cos(a) * (s + 5), y + Math.sin(a) * (s + 5)); c.lineTo(x + Math.cos(a) * (s + 12 + r() * 3), y + Math.sin(a) * (s + 12 + r() * 3)); c.stroke(); } };
  const cloud = (x, y, s, fill) => { c.strokeStyle = COL.ink; c.fillStyle = fill; c.beginPath(); c.arc(x - s * .55, y + s * .1, s * .45, Math.PI * .5, Math.PI * 1.5); c.arc(x - s * .1, y - s * .25, s * .55, Math.PI * 1.05, Math.PI * 1.9); c.arc(x + s * .5, y + s * .05, s * .45, Math.PI * 1.4, Math.PI * .5); c.closePath(); c.fill(); c.stroke(); };
  if (cond === 'clear') { sun(60, 48, 20); return; }
  if (cond === 'partly') { sun(44, 36, 15); cloud(70, 58, 30, '#fbf7ee'); return; }
  cloud(60, 40, 34, cond === 'storm' || cond === 'heavy' ? '#c9cfd6' : '#eef0f2'); c.lineWidth = 2.4;
  if (cond === 'snow') { c.strokeStyle = COL.snow; [[40, 74], [60, 82], [80, 74]].forEach(([x, y]) => flake(c, x, y, 1.8)); }
  else if (cond !== 'cloudy') { c.strokeStyle = COL.rain; const n = cond === 'drizzle' ? 2 : cond === 'rain' ? 3 : 4; for (let k = 0; k < n; k++) drop(c, 36 + k * 48 / (n - 1 || 1), 76 + (k % 2) * 8, 1.5); }
  if (cond === 'storm') { c.strokeStyle = '#d99a2b'; c.lineWidth = 3.2; c.beginPath(); c.moveTo(66, 58); c.lineTo(56, 74); c.lineTo(66, 74); c.lineTo(58, 92); c.stroke(); }
}

// ---- the timeline ----
const cv = document.getElementById('chart'), cx = cv.getContext('2d');
const W = 1100, H = 400, T = 86, B = 330, L = 10, R = W - 10, GAP = 30;
function geom() { const n = items.length, w = (R - L - GAP) / n, nP = past.length; return { w, nP, xOf: i => i < nP ? L + i * w : L + GAP + i * w }; }
function drawChart() {
  cx.setTransform(2, 0, 0, 2, 0, 0); cx.clearRect(0, 0, W, H); if (!items.length) return;
  const { w, nP, xOf } = geom(), s = Math.max(.6, Math.min(1, w / 18));
  past.forEach((d, i) => {
    const r = rng(d.y * 101 + i * 7 + month * 13 + dayN), x = xOf(i); wash(cx, x, T, w, B - T, tone(d.anom), r); cx.lineCap = 'round';
    if (d.rain > 0) { cx.strokeStyle = COL.rain; cx.lineWidth = 1.3; const n = Math.min(60, Math.round(4 + d.rain * 20)); for (let k = 0; k < n; k++) drop(cx, x + 3 + r() * (w - 6), T + 10 + r() * (B - T - 20), s); }
    if (d.snow > 0) { cx.strokeStyle = COL.snow; cx.lineWidth = 1.4; const n = Math.min(40, Math.round(3 + d.snow * 2)); for (let k = 0; k < n; k++) flake(cx, x + 4 + r() * (w - 8), T + 10 + r() * (B - T - 20), s); }
  });
  const rr = rng(month * 31 + dayN), rainChance = 1 - stats.dry;
  fut.forEach((d, k) => {
    const i = nP + k, x = xOf(i), col = tone(d.anom);
    cx.save(); cx.beginPath(); cx.rect(x + 2, T, w - 4, B - T); cx.clip(); cx.strokeStyle = rgba(col, .9); cx.lineWidth = 1.3; for (let yy = T - w; yy < B + w; yy += 6) { cx.beginPath(); cx.moveTo(x, yy + w + (rr() - .5) * 1.5); cx.lineTo(x + w, yy + (rr() - .5) * 1.5); cx.stroke(); } cx.restore();
    pencilRect(cx, x + 1, T, w - 2, B - T, rng(d.y), 1.1, 'rgba(59,47,37,.7)');
    const chance = d.fc && d.fc.chance != null ? d.fc.chance / 100 : rainChance;
    cx.strokeStyle = stats.snowy > stats.wet / 2 ? COL.snow : COL.rain; cx.lineWidth = 1.1; cx.setLineDash([1.6, 2.2]); const nd = Math.round(chance * 24); for (let j = 0; j < nd; j++) drop(cx, x + 4 + rr() * (w - 8), T + 10 + rr() * (B - T - 20), s); cx.setLineDash([]);
  });
  if (hover !== null && hover !== sel) pencilRect(cx, xOf(hover), T - 3, w, B - T + 6, rng(hover + 5), 1.2, 'rgba(59,47,37,.45)');
  if (sel !== null) pencilRect(cx, xOf(sel) - 1, T - 5, w + 2, B - T + 10, rng(sel + 11), 2.4, COL.ink);
  // today line
  const tx = xOf(nP) - GAP / 2; cx.strokeStyle = COL.warm; cx.lineWidth = 1.6; cx.setLineDash([5, 5]); cx.beginPath(); cx.moveTo(tx, T - 8); cx.lineTo(tx, B + 8); cx.stroke(); cx.setLineDash([]);
  cx.fillStyle = COL.warm; cx.font = `700 22px ${HAND}`; cx.textAlign = 'center'; cx.textBaseline = 'top'; cx.fillText('today', tx, B + 36);
  // year labels
  cx.fillStyle = COL.pencil; cx.font = `600 22px ${HAND}`; cx.textBaseline = 'top';
  const lab = (i, y, al) => { cx.textAlign = al; cx.fillText(String(y), al === 'left' ? xOf(i) : al === 'right' ? xOf(i) + w : xOf(i) + w / 2, B + 12); };
  lab(0, past[0].y, 'left'); if (nP > 1) lab(nP - 1, past[nP - 1].y, 'right'); lab(items.length - 1, fut[NFUT - 1].y, 'right');
  past.forEach((d, i) => { if (d.y % 10 === 0 && i > 2 && i < nP - 3) lab(i, d.y, 'center'); });
  cx.font = `600 20px ${HAND}`; cx.textAlign = 'center'; cx.fillText('the next ten', (xOf(nP) + xOf(items.length - 1) + w) / 2, B + 36);
  drawNotes(w, nP, xOf);
}

// Handwritten notes pointing at the warmest, coolest and wettest years, and the next one coming up.
function drawNotes(w, nP, xOf) {
  const notes = [];
  if (nP > 2) {
    const hot = past.reduce((bi, d, i, a) => d.hi > a[bi].hi ? i : bi, 0), cold = past.reduce((bi, d, i, a) => d.hi < a[bi].hi ? i : bi, 0);
    notes.push([xOf(hot) + w / 2, `warmest, ${past[hot].hi}°`]); notes.push([xOf(cold) + w / 2, `coolest, ${past[cold].hi}°`]);
    const wetI = past.reduce((bi, d, i, a) => Math.max(d.rain, d.snow / 10) > Math.max(a[bi].rain, a[bi].snow / 10) ? i : bi, 0), wd = past[wetI];
    if (wd.rain > 0 || wd.snow > 0) notes.push([xOf(wetI) + w / 2, wd.snow > 0 ? `snowiest, ${wd.snow} in` : `wettest, ${wd.rain} in`]);
  }
  notes.sort((a, b) => a[0] - b[0]);
  const order = [[xOf(nP) + w / 2, isToday(fut[0].y) ? `today, ${fut[0].y}` : `next one, ${fut[0].y}`], ...notes];
  cx.strokeStyle = COL.ink; cx.lineWidth = 1.6; cx.fillStyle = COL.ink; cx.font = `700 23px ${HAND}`; cx.textBaseline = 'middle';
  // Try every row, side and distance; score the overlaps (text on text is worst, an arrow through text is next) and keep the cleanest spot.
  const placed = [], ROWS = [14, 38, 62], ty = T - 6;
  const ax = (n, y) => n.x0 + (n.px - n.x0) * (y - n.y0) / (ty - n.y0);
  const hit = (a, b, c, d, pad) => a < d + pad && c < b + pad;
  const cross = (a, b, c, d, e, f, g, h) => { const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px)); return o(a, b, c, d, e, f) !== o(a, b, c, d, g, h) && o(e, f, g, h, a, b) !== o(e, f, g, h, c, d); };
  order.forEach(([px, txt], k) => {
    const tw = cx.measureText(txt).width; let best = null;
    const sides = k === 0 && px + 18 + tw < W - 2 ? [1] : [1, -1]; // keep "next one" over the future stripes when it fits
    ROWS.forEach((y, ri) => sides.forEach(side => [34, 18, 56, 90, 130].forEach((gap, gi) => {
      const tx = side > 0 ? px + gap : px - gap, left = side > 0 ? tx : tx - tw; if (left < 2 || left + tw > W - 2) return;
      const n = { y, l: left, r: left + tw, x0: tx + (side > 0 ? -4 : 4), y0: y + 4, px }; let sc = ri * 0.3 + gi * 0.2 + (side < 0 ? 0.1 : 0);
      placed.forEach(o => {
        if (o.y === y && hit(n.l, n.r, o.l, o.r, 12)) sc += 100;
        if (o.y < y) { const x = ax(o, y); if (x > n.l - 18 && x < n.r + 18) sc += 60; }
        if (y < o.y) { const x = ax(n, o.y); if (x > o.l - 18 && x < o.r + 18) sc += 60; }
        if (y === o.y && hit(Math.min(n.x0, px), Math.max(n.x0, px), o.l, o.r, 4)) sc += 60;
        if (cross(n.x0, n.y0, px, ty, o.x0, o.y0, o.px, ty)) sc += 40;
      });
      if (k > 0 && n.r > xOf(nP) - 6) sc += 50; // past notes stay left of the today line
      if (!best || sc < best.sc) best = { ...n, sc, side, tx };
    })));
    if (!best) return;
    cx.textAlign = best.side > 0 ? 'left' : 'right'; cx.fillText(txt, best.tx, best.y); arrow(cx, best.x0, best.y0, px, ty); placed.push(best);
  });
}

// Temperature through the day, with raindrops on the hours it rained.
function drawHourly(canvas, temps, rain, anom) {
  const c = canvas.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); const w = 600, h = 160, pl = 40, pr = 10, pt = 14, pb = 28; c.clearRect(0, 0, w, h);
  const pts = temps.map(v => v ?? NaN); const ok = pts.filter(v => !isNaN(v)); if (ok.length < 2) return;
  const mn = Math.min(...ok) - 2, mx = Math.max(...ok) + 2, X = i => pl + i / (pts.length - 1) * (w - pl - pr), Y = v => pt + (1 - (v - mn) / (mx - mn)) * (h - pt - pb), r = rng(ok.length + mx);
  const line = () => { c.beginPath(); let on = false; pts.forEach((v, i) => { if (isNaN(v)) { on = false; return; } on ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); on = true; }); };
  c.save(); line(); c.lineTo(X(pts.length - 1), h - pb); c.lineTo(X(0), h - pb); c.closePath(); c.clip();
  c.strokeStyle = rgba(tone(anom), .85); c.lineWidth = 1.4; for (let x = pl - h; x < w; x += 7) { c.beginPath(); c.moveTo(x, h - pb); c.lineTo(x + h * .6, pt - 10); c.stroke(); } c.restore();
  c.strokeStyle = COL.ink; c.lineCap = 'round'; c.lineJoin = 'round'; for (let p = 0; p < 2; p++) { c.lineWidth = p ? 1 : 2.2; c.beginPath(); let on = false; pts.forEach((v, i) => { if (isNaN(v)) { on = false; return; } const yy = Y(v) + (r() - .5) * 1.6; on ? c.lineTo(X(i), yy) : c.moveTo(X(i), yy); on = true; }); c.stroke(); }
  c.strokeStyle = COL.rain; c.lineWidth = 1.6; (rain || []).forEach((v, i) => { if (v >= 0.01) { drop(c, X(i), h - pb - 10, Math.min(1.8, .9 + v * 4)); } });
  c.strokeStyle = COL.faint; c.lineWidth = 1.2; c.beginPath(); c.moveTo(pl, h - pb); c.lineTo(w - pr, h - pb + 1); c.stroke();
  c.fillStyle = COL.pencil; c.font = `600 19px ${HAND}`; c.textBaseline = 'middle'; c.textAlign = 'right'; c.fillText(Math.round(mx - 2) + '°', pl - 6, Y(mx - 2)); c.fillText(Math.round(mn + 2) + '°', pl - 6, Y(mn + 2));
  c.textBaseline = 'bottom'; const lastI = pts.length - 1; [[0, 'midnight'], [6, '6am'], [12, 'noon'], [18, '6pm'], [lastI, '11pm']].forEach(([i, t]) => { c.textAlign = i === 0 ? 'left' : i === lastI ? 'right' : 'center'; c.fillText(t, i === 0 ? pl : i === lastI ? w - pr : X(i), h - 2); });
  const top = Math.max(...ok), pi = pts.indexOf(top); c.fillStyle = COL.ink; c.beginPath(); c.arc(X(pi), Y(top), 4.5, 0, 7); c.fill();
  c.font = `700 21px ${HAND}`; c.textAlign = X(pi) > w - 130 ? 'right' : 'left'; c.fillText(`peak ${Math.round(top)}°`, X(pi) + (X(pi) > w - 130 ? -8 : 8), Y(top) - 4);
}

// Fetch hours for the selected day, then draw them, unless the visitor has moved on by then.
let hourTok = 0;
function loadHours(dateStr, future, anom) {
  const tok = ++hourTok, wrap = document.getElementById('hourwrap'); if (!wrap) return;
  wrap.innerHTML = `<div class="hourwait">sketching the hours…</div>`;
  store.hourly(dateStr, future).then(hrs => {
    if (tok !== hourTok) return;
    wrap.innerHTML = `<canvas id="hourly" width="1200" height="320" role="img" aria-label="Temperature through the day"></canvas>`;
    drawHourly(document.getElementById('hourly'), hrs.temp, hrs.rain, anom);
  }).catch(() => { if (tok === hourTok) wrap.innerHTML = `<div class="hourwait">couldn't fetch the hours just now</div>`; });
}

const precipText = d => d.snow > 0 ? `${d.snow} in of snow` : d.rain > 0 ? `${d.rain} in of rain` : 'no rain';
function pastCard(d) {
  const el = document.getElementById('card'); el.classList.remove('future');
  const badge = d.anom >= 4 ? `<span class="badge" style="color:${COL.warm}">warmer than usual</span>` : d.anom <= -4 ? `<span class="badge" style="color:${COL.cold}">cooler than usual</span>` : `<span class="badge" style="color:${COL.pencil}">about usual</span>`;
  const extra = [d.sun != null ? `${d.sun.toFixed(1)} hours of sun` : null, d.wind != null ? `wind up to ${d.wind} mph` : null].filter(Boolean).join(', ');
  el.innerHTML = `<div class="head"><div><div class="scrawl">what happened</div><h2>${dateLabel()}, ${d.y}</h2></div>${badge}</div>
    <div class="condrow"><canvas id="doodle" width="120" height="96" style="width:60px;height:48px" aria-hidden="true"></canvas><div class="big"><div><b>${d.hi}°</b> <span>high</span></div><div><b>${d.lo}°</b> <span>low</span></div></div></div>
    <div id="hourwrap"></div>
    <div class="lede">${CONDS[d.cond]}, ${precipText(d)}${extra ? '. ' + extra[0].toUpperCase() + extra.slice(1) : ''}.</div>`;
  doodle(document.getElementById('doodle').getContext('2d'), d.cond);
  loadHours(iso(utcDate(d.y, month, dayN)), false, d.anom);
}

function futureCard(d) {
  const el = document.getElementById('card'); el.classList.add('future');
  const nearRow = () => {
    const near = [];
    for (let k = -7; k <= 7; k++) { const [, m, dd] = shift(d.y, month, dayN, k); const o = odds(m, dd, normal); if (o) near.push({ k, m, d: dd, dry: o.dry }); }
    if (!near.length) return '';
    const best = near.reduce((a, x) => x.dry > a.dry || (x.dry === a.dry && Math.abs(x.k) < Math.abs(a.k)) ? x : a);
    return `<div class="nearwrap"><div class="scrawl">nearby days, chance it stays dry</div>
      <div class="nearby" role="group" aria-label="Nearby dates">${near.map(x => `<button type="button" data-m="${x.m}" data-d="${x.d}" class="${x === best ? 'best' : ''}" ${x.k === 0 ? 'aria-current="date"' : ''} aria-label="${MS[x.m]} ${x.d}: ${Math.round(x.dry * 100)}% chance of a dry day"><span class="bar" style="height:${Math.max(6, Math.round(x.dry * 100))}%"></span><span class="d">${x.d}</span></button>`).join('')}</div>
      ${best.k === 0 ? '' : `<span class="hint">${MS[best.m]} ${best.d} usually stays driest.</span>`}</div>`;
  };
  if (d.fc) {
    // Within 16 days we can show the real forecast instead of odds.
    const ch = d.fc.chance, dry = ch != null ? 100 - ch : null;
    const badge = `<span class="badge" style="color:${COL.good}">the real forecast</span>`;
    el.innerHTML = `<div class="head"><div><div class="scrawl">${isToday(d.y) ? 'today' : 'coming up soon'}</div><h2>${dateLabel()}, ${d.y}</h2></div>${badge}</div>
      <div class="condrow"><canvas id="doodle" width="120" height="96" style="width:60px;height:48px" aria-hidden="true"></canvas><div class="big"><div><b>${d.fc.hi}°</b> <span>high</span></div><div><b>${d.fc.lo}°</b> <span>low</span></div>${dry != null ? `<div><b>${dry}%</b> <span>chance it stays dry</span></div>` : ''}</div></div>
      <div id="hourwrap"></div>
      <div class="lede">${CONDS[d.cond]}${d.fc.precip >= 0.01 ? `, about ${d.fc.precip.toFixed(2)} in of rain expected` : ''}.</div>
      ${nearRow()}`;
    doodle(document.getElementById('doodle').getContext('2d'), d.cond);
    loadHours(iso(utcDate(d.y, month, dayN)), true, d.anom);
  } else {
    hourTok++;
    const dryPct = Math.round(stats.dry * 100);
    const badge = dryPct >= 85 ? `<span class="badge" style="color:${COL.good}">good odds</span>` : dryPct >= 65 ? `<span class="badge" style="color:${COL.pencil}">decent odds</span>` : `<span class="badge" style="color:${COL.warm}">have a rain plan</span>`;
    el.innerHTML = `<div class="head"><div><div class="scrawl">what's likely</div><h2>${dateLabel()}, ${d.y}</h2></div>${badge}</div>
      <div class="condrow"><canvas id="doodle" width="120" height="96" style="width:60px;height:48px" aria-hidden="true"></canvas><div class="big"><div><b>${dryPct}%</b> <span>chance it stays dry</span></div><div><b>${d.lo}–${d.hi}°</b> <span>likely high</span></div></div></div>
      ${nearRow()}
      <div class="hint">Based on the last ${ODDS_YEARS} years here, nudged for the warming trend.</div>`;
    doodle(document.getElementById('doodle').getContext('2d'), stats.common);
  }
  el.querySelectorAll('.nearby button').forEach(b => b.addEventListener('click', () => {
    const keep = sel - past.length;
    month = +b.dataset.m; dayN = +b.dataset.d; syncDateInput();
    load({ keepFuture: keep });
  }));
}
function renderCard() { const d = items[sel]; d.future ? futureCard(d) : pastCard(d); }

function note() {
  const f = past[0], when = `${dateLabel()}, ${f.y}`;
  document.getElementById('answer').textContent =
    f.snow > 0 ? `It snowed! ${f.snow} inches fell on ${when}.` :
    f.precip >= WET ? `Yes! ${f.rain || +f.precip.toFixed(2)} inches of rain fell on ${when}.` :
    f.precip >= 0.01 ? `Barely. Just a few drops fell on ${when}.` :
    `Nope. ${when} was dry, with a high of ${f.hi}°F.`;
  const hot = past.reduce((a, d) => d.hi > a.hi ? d : a), cold = past.reduce((a, d) => d.hi < a.hi ? d : a);
  const wetN = past.filter(d => d.precip >= WET).length, snowN = past.filter(d => d.snow > 0).length;
  document.getElementById('noteTitle').textContent = `${dateLabel()} in ${place.name}`;
  document.getElementById('storyText').textContent = `Warmest in ${hot.y} (${hot.hi}°), coolest in ${cold.y} (${cold.hi}°). It ${snowN ? 'snowed or ' : ''}rained on ${wetN} of the last ${past.length} years. ${isToday(fut[0].y) ? 'Today' : 'The next one'} looks ${stats.dry >= .85 ? 'promising' : stats.dry >= .65 ? 'decent' : 'iffy'}: ${Math.round(stats.dry * 100)}% of these days stayed dry.`;
}

function renderAll() {
  document.getElementById('h1').innerHTML = `Every <span>${dateLabel()}${ord(dayN)}</span> in ${esc(place.name)}`;
  legends(); drawChart(); renderCard(); note();
}

// ---- loading ----
const statusEl = document.getElementById('status');
function showStatus(html) { statusEl.innerHTML = html; statusEl.hidden = false; document.getElementById('results').setAttribute('aria-busy', 'true'); }
function hideStatus() { statusEl.hidden = true; document.getElementById('results').removeAttribute('aria-busy'); }

let loadTok = 0, ctrl = null;
async function load({ keepFuture } = {}) {
  const tok = ++loadTok; ctrl?.abort(); ctrl = new AbortController();
  const ff = firstFuture(month, dayN); if (start >= ff) start = ff - 1;
  showStatus(`Flipping through ${ff - start} years of weather…`);
  try {
    recent = await store.load(Math.min(start, ff - ODDS_YEARS), ff - 1, month, dayN, ctrl.signal, (done, total) => {
      if (tok === loadTok && total > 4) showStatus(`Flipping through the weather records… <small>${Math.round(done / total * 100)}%</small>`);
    });
    if (tok !== loadTok) return;
    sel = null; gen();
    if (!past.length || !stats) throw new Error('No weather records came back for this place.');
    if (keepFuture != null && keepFuture >= 0) sel = past.length + Math.min(NFUT - 1, keepFuture);
    hideStatus(); renderAll();
  } catch (e) {
    if (e.name === 'AbortError' || tok !== loadTok) return;
    const busy = e.status === 429;
    showStatus(`${busy ? 'The weather service is busy.' : 'The weather records wouldn\'t open.'} <small>${esc(busy ? 'Give it a minute, then try again.' : e.message)}</small><button type="button" id="retry">Try again</button>`);
    document.getElementById('retry').addEventListener('click', () => load({ keepFuture }));
  }
}

// ---- controls ----
const cityIn = document.getElementById('city'), dateIn = document.getElementById('date'), cityHint = document.getElementById('cityHint');
const HINT = cityHint.textContent;
const suggestions = new Map();
const syncDateInput = () => { dateIn.value = `${start}-${String(month + 1).padStart(2, '0')}-${String(dayN).padStart(2, '0')}`; };
dateIn.min = `${FIRST_YEAR}-01-01`; dateIn.max = iso(TODAY);

function setPlace(p) { place = p; store = createStore(p); cityIn.value = p.label; cityHint.textContent = HINT; cityHint.classList.remove('err'); }

let searchTok = 0, searchTimer = null;
cityIn.addEventListener('focus', () => cityIn.select());
cityIn.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = cityIn.value; if (suggestions.has(q)) return;
  searchTimer = setTimeout(async () => {
    const tok = ++searchTok;
    try {
      const list = await searchPlaces(q); if (tok !== searchTok) return;
      list.forEach(p => suggestions.set(p.label, p));
      document.getElementById('places').innerHTML = list.map(p => `<option value="${esc(p.label)}"></option>`).join('');
    } catch { /* suggestions are optional */ }
  }, 250);
});

// Returns true if the place changed.
async function applyCity() {
  const q = cityIn.value.trim(); if (!q || (place && q === place.label)) return false;
  let p = suggestions.get(q);
  if (!p) {
    try { p = (await searchPlaces(q))[0]; } catch { p = null; }
  }
  if (!p) { cityHint.textContent = `Couldn't find "${q}". Try a nearby town, or add the country.`; cityHint.classList.add('err'); return false; }
  setPlace(p); return true;
}
// Returns true if the date changed.
function applyDate() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIn.value); if (!m) return false;
  const y = +m[1]; if (y < FIRST_YEAR) return false;
  if (y === start && +m[2] - 1 === month && +m[3] === dayN) return false;
  start = y; month = +m[2] - 1; dayN = +m[3]; return true;
}
cityIn.addEventListener('change', async () => { if (await applyCity()) load(); });
dateIn.addEventListener('change', () => { if (applyDate()) load(); });
document.getElementById('sentence').addEventListener('submit', async e => {
  e.preventDefault();
  const changed = (await applyCity()) | applyDate();
  if (changed) load();
  document.getElementById('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

// ---- chart interaction ----
const tip = document.getElementById('tip');
function idxAt(e) { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), { w, xOf } = geom(); for (let i = 0; i < items.length; i++) { if (x >= xOf(i) && x < xOf(i) + w) return i; } return null; }
cv.addEventListener('mousemove', e => {
  const i = idxAt(e); if (i !== hover) { hover = i; drawChart(); }
  if (i === null) { tip.hidden = true; return; }
  const d = items[i], r = cv.getBoundingClientRect(); tip.hidden = false;
  tip.textContent = d.fc ? `${d.y}: forecast high ${d.fc.hi}°F${d.fc.chance != null ? `, ${d.fc.chance}% chance of rain` : ''}`
    : d.future ? `${d.y}: likely ${d.lo}–${d.hi}°F, ${Math.round((1 - stats.dry) * 100)}% chance of rain`
    : `${d.y}: ${d.hi}°F, ${d.snow > 0 ? d.snow + ' in of snow' : d.rain > 0 ? d.rain + ' in of rain' : 'dry'}`;
  let lx = e.clientX - r.left + 14; if (lx > r.width - 270) lx -= 290; tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = (e.clientY - r.top - 40) + 'px';
});
cv.addEventListener('mouseleave', () => { hover = null; tip.hidden = true; drawChart(); });
cv.addEventListener('click', e => { const i = idxAt(e); if (i !== null) { sel = i; drawChart(); renderCard(); } });
cv.addEventListener('keydown', e => { if (!items.length) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowRight' ? 1 : -1))); drawChart(); renderCard(); } });
if (document.fonts?.ready) document.fonts.ready.then(() => { if (items.length) renderAll(); });

// ---- start: guess the city from the time zone, e.g. America/Los_Angeles -> Los Angeles ----
(async function init() {
  syncDateInput();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const guess = tz.includes('/') && !tz.startsWith('Etc/') ? tz.split('/').pop().replace(/_/g, ' ') : '';
  showStatus('Finding your part of the world…');
  let p = null;
  if (guess) { try { p = (await searchPlaces(guess))[0]; } catch { /* fall back below */ } }
  setPlace(p || FALLBACK);
  load();
})();
