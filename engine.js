// Lesson engine: parse 楊陽英文 handout PDFs + align audio. Runs in the browser and in node.
(function (root) {
'use strict';
const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/g;
const isCJKLine = s => { const c = (s.match(CJK) || []).length, l = (s.match(/[A-Za-z]/g) || []).length; return c > 0 && c >= l * 0.25; };
const JUNK = /中階閱讀|初階閱讀|高階閱讀|楊陽英文|音訊\s*QR\s*Code|QRCode/i;

// pages: [{items:[{str,x,y,w,size}], height}] where y = distance from top to baseline
function groupLines(items, tol) {
  const s = items.slice().sort((a, b) => a.y - b.y || a.x - b.x), lines = [];
  for (const it of s) {
    const L = lines.length && Math.abs(lines[lines.length - 1].y - it.y) <= tol ? lines[lines.length - 1] : null;
    if (L) { L.items.push(it); } else lines.push({ y: it.y, items: [it] });
  }
  for (const L of lines) L.items.sort((a, b) => a.x - b.x);
  return lines;
}
const joinItems = its => { let out = ''; let prev = null;
  for (const it of its) { if (prev && it.x - (prev.x + prev.w) > 1.5 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' '; out += it.str; prev = it; }
  return out.replace(/\s+/g, ' ').trim(); };

function parsePages(pages) {
  const art = [], vocabLines = [];
  let titleEn = [], titleZh = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const pg = pages[pi], H = pg.height || 842;
    const items = pg.items.filter(i => i.str.trim() && i.y > 20 && i.y < H - 48);
    const body = [], sups = [], voc = [], big = [];
    for (const it of items) {
      if (/^\d{1,3}$/.test(it.str.trim()) && (it.size <= 9 || it.size < 11.9 && it.size > 10.5)) sups.push(it);
      else if (it.size >= 14) big.push(it);
      else if (it.size >= 11) body.push(it);
      else voc.push(it);
    }
    // vocabulary column
    for (const L of groupLines(voc, 3)) { const t = joinItems(L.items); if (!JUNK.test(t)) vocabLines.push(t); }
    // article lines: drop margin line numbers (bare integers at far left)
    const minX = Math.min(...body.map(b => b.x));
    const bodyF = body.filter(b => !(/^\d{1,2}$/.test(b.str.trim()) && b.x < minX + 25 && b.x < 60));
    const lines = groupLines(bodyF.concat(big), 3).map(L => ({ y: L.y, items: L.items, big: L.items.some(i => i.size >= 14) }));
    // superscripts: attach to nearest line (same baseline or just below a raised number)
    for (const sp of sups) {
      if (!/^\d{1,3}$/.test(sp.str.trim())) continue;
      let best = null, bd = 1e9;
      for (const L of lines) { const d = L.y - sp.y; if (d >= -4 && d <= 14 && Math.abs(d) < bd) { bd = Math.abs(d); best = L; } }
      if (!best) continue;
      best.items.push({ str: `⟦${sp.str.trim()}⟧`, x: sp.x - 0.5, w: 0, sup: true });
    }
    for (const L of lines) {
      L.items.sort((a, b) => a.x - b.x);
      let t = '';
      for (const it of L.items) { if (it.sup) t = t.replace(/\s+$/, '') + it.str + ' '; else t += (t && !/\s$/.test(t) ? ' ' : '') + it.str; }
      t = t.replace(/⟧ (['’]s\b)/g, '⟧$1').replace(/⟧ ([”’)\],.;:!?])/g, '⟧$1').replace(/⟧ "(?=\s|$)/g, '⟧"').replace(/\s+/g, ' ').replace(/ ([,.;:!?)”’])/g, '$1').replace(/([(“‘]) /g, '$1').replace(/(\w) - (?=[\w\[])/g, '$1-').replace(/(\w)- (?=\w)/g, '$1-').replace(/(\w) -$/, '$1-').trim();
      if (!t || JUNK.test(t)) continue;
      if (L.big) { (isCJKLine(t) ? titleZh : titleEn).push(t); continue; }
      art.push(t);
    }
  }
  // paragraphs: run of English lines, then run of Chinese lines
  const paras = []; let en = [], zh = [];
  const fixZh = z => z.replace(/\s*([，。、；：！？「」（）『』《》—])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  const flush = () => { if (en.length) paras.push([joinWrapped(en), fixZh(zh.join(''))]); en = []; zh = []; };
  for (const t of art) {
    if (isCJKLine(t)) { if (en.length) zh.push(t); else if (paras.length) paras[paras.length - 1][1] += t; else titleZh.push(t); }
    else { if (zh.length) flush(); en.push(t); }
  }
  flush();
  // vocab
  const vt = vocabLines.join(' ').replace(/\s+/g, ' ');
  const V = []; const re = /(\d{1,3})\.\s*([A-Za-z][A-Za-z'’\- .…]*?)\s*\[\s*([^\]]+?)\s*\]\s*(n|v|a|ad|ph|prep|conj|pron|adj|adv|int|aux)\s*\.\s*(.*?)(?=\s*\d{1,3}\.\s*[A-Za-z]|$)/g;
  let m; while ((m = re.exec(vt))) {
    V.push([+m[1], m[2].replace(/\s+/g, ' ').trim().replace(/(\w+) ([b-zB-Z])(?=\s|$)/g, '$1$2'), m[3].replace(/\s+/g, ' ').trim(), m[4] + '.', m[5].replace(/\s+/g, '').replace(/;/g, '；').trim()]);
  }
  V.sort((a, b) => a[0] - b[0]);
  // markers -> [form|n]
  const vmap = {}; V.forEach(v => vmap[v[0]] = v); let lastN = 0;
  const mark = en => {
    const toks = en.split(' ').map(tk => { const sm = tk.match(/^(\d{1,3})([,.;:]?)$/); if (sm && +sm[1] === lastN + 1 && vmap[+sm[1]]) { return '⟦' + sm[1] + '⟧' + sm[2]; } const mm2 = [...tk.matchAll(/⟦(\d+)⟧/g)]; if (mm2.length) lastN = +mm2[mm2.length - 1][1]; return tk; });
    for (let i = 1; i < toks.length; i++) if (/^⟦\d+⟧/.test(toks[i])) { toks[i - 1] += toks[i]; toks[i] = ''; }
    const out = [];
    for (const tk of toks.filter(Boolean)) {
      const mm = tk.match(/^(.*?)((?:⟦\d+⟧)+)(.*)$/);
      if (!mm) { out.push(tk); continue; }
      const nums = [...mm[2].matchAll(/⟦(\d+)⟧/g)].map(x => +x[1]);
      let word = mm[1], tail = mm[3];
      const n = nums[nums.length - 1], v = vmap[n];
      const hw = v ? v[1].toLowerCase().split(' ') : [''];
      let k = 1;
      for (let kk = Math.min(hw.length, 5); kk > 1; kk--) {
        if (out.length < kk - 1) continue;
        const first = out[out.length - (kk - 1)].toLowerCase().replace(/^[“"‘(]+/, '');
        const h0 = hw[0];
        if (first.slice(0, 3) === h0.slice(0, 3) || (h0 === 'be' && /^(be|is|are|was|were|been|being)$/.test(first)) || first.slice(0, 2) === h0.slice(0, 2) && h0.length <= 3) { k = kk; break; }
      }
      const lead = (word.match(/^[“"‘(]+/) || [''])[0]; word = word.slice(lead.length);
      if (k > 1 && out.length >= k - 1) {
        const prev = out.splice(out.length - (k - 1), k - 1);
        const plead = (prev[0].match(/^[“"‘(]+/) || [''])[0]; prev[0] = prev[0].slice(plead.length);
        out.push(plead + `[${prev.join(' ')} ${lead}${word}|${n}]` + tail);
      } else out.push(lead + `[${word}|${n}]` + tail);
    }
    return out.join(' ');
  };
  const title = mark(titleEn.join(' ').replace(/\s+/g, ' ').replace(/ ([?!:,.])/g, '$1').trim());
  const P = paras.map(p => [mark(p[0]).replace(/(million|billion|thousand)to(?=NT)/g, '$1 to ').replace(/NT(?=\d)/g, 'NT$$').replace(/(\d)(million|billion|thousand)/g, '$1 $2').replace(/\s+/g, ' ').trim(), p[1]]);
  return { title, titleZh: titleZh.join('').trim(), V, paras: P };
}
function joinWrapped(lines) {
  let s = '';
  for (const l of lines) { if (!s) s = l; else if (/[A-Za-z]-$/.test(s)) s += l; else s += ' ' + l; }
  return s;
}

// ---------- audio alignment ----------
const SR = 16000, HOP = 160;
function energyDb(x) {
  const n = Math.max(0, Math.floor((x.length - 400) / HOP)), db = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; const o = f * HOP; for (let i = 0; i < 400; i++) { const v = x[o + i]; s += v * v; } db[f] = 20 * Math.log10(Math.sqrt(s / 400) + 1e-9); }
  return db;
}
const pct = (a, p) => { const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
function regions(db, a, b, minpause, thr) {
  const regs = []; let i = a;
  while (i < b) {
    if (db[i] >= thr) {
      let j = i;
      while (j < b) { if (db[j] >= thr) { j++; continue; } let k = j; while (k < b && db[k] < thr) k++; if ((k - j) * HOP / SR >= minpause || k >= b) break; j = k; }
      regs.push([i * HOP / SR, j * HOP / SR]); i = j;
    } else i++;
  }
  return regs;
}
const SPECIAL = { usdt: 4, ldl: 3, cpr: 3, dna: 3, fbi: 3, usa: 3, us: 2, uk: 2, mri: 3, ai: 2 };
function syl(tok) {
  const t = tok.toLowerCase().replace(/[“”"’'(),.:;!?—]/g, '');
  if (SPECIAL[t]) return SPECIAL[t];
  if (/[一-鿿]/.test(t)) return 2;
  if (/\d/.test(t)) return Math.max(1, numTokSyl(t));
  let n = 0;
  for (const part of t.split(/[-’']/)) {
    if (!part) continue;
    let g = (part.match(/[aeiouy]+/g) || []).length;
    if (part.endsWith('e') && !part.endsWith('le') && g > 1) g--;
    if (/ed$/.test(part) && !/[td]ed$/.test(part) && g > 1) g--;
    n += Math.max(1, g);
  }
  return Math.max(1, n);
}
const ONES = [2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 3, 1, 2, 2, 2, 2, 3, 2, 2], TENS = [0, 0, 2, 2, 2, 2, 2, 3, 2, 2];
function u100(n) { return n < 20 ? (n ? ONES[n] : 0) : TENS[Math.floor(n / 10)] + (n % 10 ? ONES[n % 10] : 0); }
function u1000(n) { const h = Math.floor(n / 100); return (h ? ONES[h] + 2 : 0) + u100(n % 100); }
function intSyl(n) { if (n === 0) return 2; let s = 0; const parts = [[1e9, 2], [1e6, 2], [1e3, 2]];
  for (const [d, w] of parts) { const q = Math.floor(n / d); if (q) { s += u1000(q) + w; n %= d; } } return s + u1000(n); }
function numTokSyl(t) { // e.g. 100,000  2025  3.2  NT$3.2  A1  66-year-old  271
  let s = 0;
  for (const g of t.split(/(?<=\d)-|-(?=\d)/)) {
    const m = g.match(/^([a-z$]*?)\$?([\d,]+)(?:\.(\d+))?([a-z%]*)$/);
    if (!m) { s += g.replace(/\d/g, '').length ? syl(g.replace(/\d/g, '')) + 1 : 1; continue; }
    const pre = m[1].replace('$', ''), ip = m[2].replace(/,/g, ''), dec = m[3] || '', suf = m[4];
    if (pre) s += pre.length <= 3 ? pre.length : syl(pre);
    const n = +ip;
    if (!m[2].includes(',') && ip.length === 4 && n >= 1100 && n < 2100 && !dec) s += n % 100 === 0 ? u100(Math.floor(n / 100)) + 2 : n >= 2000 && n < 2010 ? 2 + 2 + (n % 10 ? ONES[n % 10] : 0) : u100(Math.floor(n / 100)) + (n % 100 < 10 ? 1 + ONES[n % 100] : u100(n % 100));
    else s += intSyl(n);
    if (dec) s += 1 + [...dec].reduce((a, c) => a + ONES[+c], 0);
    if (suf) s += suf === '%' ? 2 : /^(st|nd|rd|th)$/.test(suf) ? 0 : syl(suf);
  }
  return s;
}
function tokensOf(paras) {
  const out = [];
  paras.forEach((p, pi) => {
    const txt = p[0].replace(/^@/, '').replace(/—/g, ' ');
    const re = /([“"‘(]*)\[([^|\]]+)\|(\d+)\]([^\s\[]*)|(\S+)/g; let m;
    while ((m = re.exec(txt))) {
      if (m[5]) out.push({ t: m[5], n: null, p: pi });
      else { const parts = m[2].split(' '); parts.forEach((w, i) => out.push({ t: (i === 0 ? m[1] : '') + w + (i === parts.length - 1 ? m[4] : ''), n: +m[3], p: pi })); }
    }
    if (out.length) out[out.length - 1].end = true;
  });
  return out.filter(o => o.t.replace(/[^\w一-鿿$]/g, ''));
}
const brk = tk => /[.,:;”"?!)]$/.test(tk.t) || tk.end;
function dpAlign(tok, regs, PEN) {
  const W = tok.map(t => syl(t.t) + 0.35), cum = [0]; W.forEach(w => cum.push(cum[cum.length - 1] + w));
  const N = tok.length, K = regs.length; const tot = regs.reduce((s, r) => s + r[1] - r[0], 0), rate = tot / cum[N];
  if (K > N) return null;
  const dp = Array.from({ length: K + 1 }, () => new Float64Array(N + 1).fill(Infinity)), bk = Array.from({ length: K + 1 }, () => new Int32Array(N + 1));
  dp[0][0] = 0;
  for (let k = 1; k <= K; k++) { const d = regs[k - 1][1] - regs[k - 1][0];
    for (let j = k; j <= N - (K - k); j++) { const pen = (j === N || brk(tok[j - 1])) ? 0 : PEN;
      for (let i = k - 1; i < j; i++) { const b = dp[k - 1][i]; if (b === Infinity) continue; const est = (cum[j] - cum[i]) * rate; const z = (d - est) / (0.25 + 0.12 * est); const c = b + z * z + pen; if (c < dp[k][j]) { dp[k][j] = c; bk[k][j] = i; } } } }
  if (dp[K][N] === Infinity) return null;
  const spans = []; let j = N; for (let k = K; k > 0; k--) { const i = bk[k][j]; spans.unshift([i, j]); j = i; }
  return { spans, W };
}
function snap(t, db, win) { const a = Math.max(0, Math.floor((t - win) * SR / HOP)), b = Math.min(db.length - 1, Math.floor((t + win) * SR / HOP)); if (b <= a) return t; let mi = a; for (let i = a; i <= b; i++) if (db[i] < db[mi]) mi = i; return mi * HOP / SR; }

// x: Float32Array mono 16 kHz; paras of this audio clip. Returns {words:{n:[s,e,cs,ce]}, K:[...per para points]}
function alignClip(x, paras) {
  const db = energyDb(x), thr = pct(db, 95) - 35, fthr = pct(db, 95) - 28;
  let regs = regions(db, 0, db.length, 0.18, thr).filter(r => r[1] - r[0] > 0.15);
  const tok = tokensOf(paras);
  if (!tok.length || !regs.length) return { words: {}, K: paras.map(() => []) };
  while (regs.length > tok.length) { let mi = 0; for (let i = 1; i < regs.length - 1; i++) if (regs[i + 1][0] - regs[i][1] < regs[mi + 1][0] - regs[mi][1]) mi = i; regs.splice(mi, 2, [regs[mi][0], regs[mi + 1][1]]); }
  const A = dpAlign(tok, regs, 3.0) || { spans: [[0, tok.length]], W: tok.map(t => syl(t.t) + 0.35) };
  if (A.spans.length !== regs.length) regs = [[regs[0][0], regs[regs.length - 1][1]]];
  const fine = [];
  A.spans.forEach(([i, j], ri) => {
    const r = regs[ri];
    if (r[1] - r[0] > 2.6 && j - i >= 5) {
      const a = Math.floor(r[0] * SR / HOP), b = Math.floor(r[1] * SR / HOP);
      const sub = regions(db, a, b, 0.06, fthr).filter(s => s[1] - s[0] > 0.12);
      if (sub.length > 1 && sub.length <= j - i) {
        const B = dpAlign(tok.slice(i, j), sub, 0.6);
        if (B) { const Wl = B.W, rr = (r[1] - r[0]) / Wl.reduce((s, w) => s + w, 0);
          const ok = B.spans.every(([x0, y0], si) => { const est = Wl.slice(x0, y0).reduce((s, w) => s + w, 0) * rr, d = sub[si][1] - sub[si][0]; return y0 > x0 && d / est > 0.55 && d / est < 1.8; });
          if (ok) { B.spans.forEach(([x0, y0], si) => fine.push([i + x0, i + y0, sub[si], r])); return; } }
      }
    }
    fine.push([i, j, r, r]);
  });
  const W = A.W, TT = new Array(tok.length);
  for (const [i, j, r] of fine) {
    const tw = W.slice(i, j).reduce((s, w) => s + w, 0); let t = r[0]; const dur = r[1] - r[0]; const times = [];
    for (let q = i; q < j; q++) { const e = t + dur * W[q] / tw; times.push([t, e]); t = e; }
    for (let q = 1; q < times.length; q++) { const b = snap(times[q][0], db, 0.1); if (times[q - 1][0] + 0.08 < b && b < times[q][1] - 0.08) { times[q - 1][1] = times[q][0] = b; } }
    for (let q = i; q < j; q++) TT[q] = times[q - i];
  }
  const words = {}; const R = new Array(tok.length);
  for (const [i, j, , r] of fine) for (let q = i; q < j; q++) R[q] = r;
  tok.forEach((tk, q) => { if (tk.n == null) return; const [s, e] = TT[q]; const r = R[q];
    if (words[tk.n]) words[tk.n][1] = e; else words[tk.n] = [s, e, r[0], r[1]]; });
  for (const n in words) { const [s, e, rs, re] = words[n]; let cs = Math.max(s - 0.10, rs - 0.08, 0), ce = Math.min(e + 0.16, re + 0.10); if (ce - cs < 0.35) ce = cs + 0.35; words[n] = [+s.toFixed(2), +e.toFixed(2), +cs.toFixed(2), +ce.toFixed(2)]; }
  const K = paras.map(() => []);
  const byP = {}; tok.forEach((tk, q) => (byP[tk.p] = byP[tk.p] || []).push(q));
  for (const p in byP) { const qs = byP[p]; const tw = qs.reduce((s, q) => s + W[q], 0); let acc = 0; const pts = [];
    for (const q of qs) { pts.push([+TT[q][0].toFixed(2), +(acc / tw).toFixed(3)]); acc += W[q]; }
    pts.push([+TT[qs[qs.length - 1]][1].toFixed(2), 1]); K[p] = pts; }
  return { words, K };
}

// map audio files to paragraph ranges. names: file names in order; paras: [[en,zh]]; durs: seconds
const normW = s => s.toLowerCase().replace(/\[([^|\]]+)\|\d+\]/g, '$1').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function nameWords(name) { return normW(name.replace(/\.[a-z0-9]+$/i, '').replace(/^[0-9a-f]{8}-/i, '').replace(/^\d+[-_ ]+/, '').replace(/_/g, ' ')); }
function audioOrderKey(name) { const m = name.replace(/^[0-9a-f]{8}-/i, '').match(/^(\d+)/); return m ? m[1] : name; }
function mapAudio(names, paras, durs) {
  const idx = names.map((n, i) => i).sort((a, b) => audioOrderKey(names[a]).localeCompare(audioOrderKey(names[b]), undefined, { numeric: false }) || names[a].localeCompare(names[b]));
  const pw = paras.map(p => normW(p[0].replace(/^@/, '')));
  const starts = idx.map(i => { const nw = nameWords(names[i]); if (!nw) return -1; const key = nw.split(' ').slice(0, 6).join(' ');
    let best = -1, bl = 0; pw.forEach((t, pi) => { const tw = t.split(' '), kw = key.split(' '); let l = 0; while (l < kw.length && tw[l] === kw[l]) l++; if (l > bl) { bl = l; best = pi; } });
    return bl >= Math.min(3, key.split(' ').length) ? best : -1; });
  let ok = starts.every(s => s >= 0) && starts[0] === 0 && starts.every((s, i) => i === 0 || s > starts[i - 1]);
  let st = starts;
  if (!ok) { // proportional fallback by syllables
    const ws = paras.map(p => tokensOf([p]).reduce((s, t) => s + syl(t.t) + 0.35, 0)), tot = ws.reduce((a, b) => a + b, 0), dt = idx.reduce((s, i) => s + durs[i], 0);
    st = []; let acc = 0, pi = 0, tacc = 0;
    idx.forEach((i, k) => { while (pi < paras.length && (acc + ws[pi] / 2) / tot < tacc / dt) { acc += ws[pi]; pi++; } st.push(k === 0 ? 0 : Math.max(st[k - 1] + 1, Math.min(pi, paras.length - (idx.length - k)))); tacc += durs[i]; });
  }
  return idx.map((i, k) => ({ file: i, from: st[k], to: k + 1 < st.length ? st[k + 1] : paras.length, matched: ok }));
}

// Build a lesson object. pcm(i) -> Promise<Float32Array 16k> for audio file i
async function buildLesson(parsed, names, durs, pcm, onStep) {
  const paras = parsed.paras.slice(); if (parsed.title) paras.unshift(['@' + parsed.title, parsed.titleZh]);
  const map = mapAudio(names, paras, durs);
  const S = [], K = [], TW = {};
  for (let k = 0; k < map.length; k++) {
    const m = map[k]; onStep && onStep(k, map.length);
    const ps = paras.slice(m.from, m.to);
    const x = await pcm(m.file);
    const r = alignClip(x, ps);
    S.push({ a: m.file, h: `第 ${k + 1} 段`, p: ps }); K.push(r.K);
    for (const n in r.words) if (!TW[n]) TW[n] = [k, ...r.words[n]];
  }
  return { title: parsed.title, titleZh: parsed.titleZh, V: parsed.V, S, K, TW, matched: map.every(m => m.matched) };
}

const api = { parsePages, alignClip, mapAudio, buildLesson, tokensOf, syl, SR };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LessonEngine = api;
})(typeof self !== 'undefined' ? self : this);
