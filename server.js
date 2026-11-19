// Fantacalcio - server senza dipendenze esterne (solo moduli built-in di Node)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream');
const https = require('https');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const PUSH_FILE = path.join(DATA_DIR, 'push.json'); // dispositivi iscritti alle notifiche push
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json'); // chiavi del server per le notifiche push (create da sole)
const VIDEO_DIR = path.join(ROOT, 'videos');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const VIDEO_MAX_MB = Math.max(1, Number(process.env.VIDEO_MAX_MB) || 500); // limite per singolo video
const VIDEO_MAX = VIDEO_MAX_MB * 1024 * 1024;
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });
if (!fs.existsSync(VIDEOS_FILE)) fs.writeFileSync(VIDEOS_FILE, '[]');
// elimina eventuali caricamenti rimasti a metà (server fermato durante un upload)
for (const f of fs.readdirSync(VIDEO_DIR)) if (f.endsWith('.part')) fs.rmSync(path.join(VIDEO_DIR, f), { force: true });
if (!fs.existsSync(PLAYERS_FILE)) fs.writeFileSync(PLAYERS_FILE, '[]');
if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '{}');
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, '[]');
if (!fs.existsSync(PUSH_FILE)) fs.writeFileSync(PUSH_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { username: 'mario', password: 'cambiami1', isadmin: true },
    { username: 'luigi', password: 'cambiami2', isadmin: false },
  ], null, 2));
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, data) => {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f); // scrittura atomica
};

// ---------- Password (in chiaro in users.json, confronto a tempo costante) ----------
function verifyPassword(pw, user) {
  if (typeof pw !== 'string' || typeof user.password !== 'string' || !user.password) return false;
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(user.password).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Admin: solo con "isadmin": true in users.json (letto a ogni richiesta, niente riavvio) ----------
const isAdminFlag = (u) => !!u && (u.isadmin === true || u.isadmin === 'true');
function isAdminUser(username) {
  try {
    const users = readJson(USERS_FILE);
    const wanted = String(username || '').toLowerCase();
    return Array.isArray(users) && isAdminFlag(users.find((x) => String(x.username || '').toLowerCase() === wanted));
  } catch { return false; }
}

// ---------- Sessioni (in memoria) ----------
const sessions = new Map(); // token -> { username, exp }
const SESSION_MS = 1000 * 60 * 60 * 24 * 7;

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function currentUser(req) {
  const token = getCookie(req, 'sid');
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  return s.username;
}

// ---------- Limite tentativi ----------
const attempts = new Map(); // ip -> { count, reset }
function tooManyAttempts(req) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.reset < now) a = { count: 0, reset: now + 10 * 60 * 1000 };
  a.count++;
  attempts.set(ip, a);
  return a.count > 20;
}

// ---------- Helpers HTTP ----------
function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}
function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Richiesta troppo grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('JSON non valido')); }
    });
    req.on('error', reject);
  });
}

// ---------- Immagini ----------
function saveImage(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('Formato immagine non valido');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new Error('Immagine troppo grande (max 2 MB)');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}
function deleteImage(url) {
  if (!url) return;
  const name = path.basename(url);
  if (/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name)) {
    fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
  }
}

// Decide cosa fare con un'immagine ricevuta dal client:
//  - vuota        -> rimuove quella attuale
//  - "/uploads/x" -> la mantiene (solo se è quella attuale del giocatore)
//  - data URL     -> salva la nuova e rimuove la vecchia
function resolveImage(value, current, created, toDelete) {
  if (!value) {
    if (current) toDelete.push(current);
    return null;
  }
  if (typeof value !== 'string') throw new Error('Immagine non valida');
  if (value.startsWith('/uploads/')) {
    if (value === current) return current;
    throw new Error('Immagine non valida');
  }
  const url = saveImage(value);
  created.push(url);
  if (current) toDelete.push(current);
  return url;
}

// ---------- Validazione giocatore (usata da creazione e modifica) ----------
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const INJURY_TYPES = ['Muscolare', 'Distorsione', 'Frattura', 'Contusione', 'Legamento crociato', 'Tendinite', 'Malattia', 'Altro'];

const FEET = ['Destro', 'Sinistro', 'Ambidestro'];
const ROLES = ['P', 'D', 'C', 'A']; // Portiere, Difensore, Centrocampista, Attaccante

function buildPlayer(b, existing) {
  const name = text(b.name, 60);
  const age = parseInt(b.age, 10);
  if (!name) return { error: 'Il nome è obbligatorio' };
  if (!Number.isInteger(age) || age < 14 || age > 60) return { error: 'Età non valida (14-60)' };
  // Altezza in cm, facoltativa
  const rawHeight = b.height === '' || b.height == null ? null : parseInt(b.height, 10);
  if (rawHeight !== null && (!Number.isInteger(rawHeight) || rawHeight < 120 || rawHeight > 230)) {
    return { error: 'Altezza non valida (120-230 cm)' };
  }
  const height = rawHeight;
  // Ruolo: facoltativo, uno tra P/D/C/A
  const role = b.role == null || b.role === '' ? null : String(b.role);
  if (role !== null && !ROLES.includes(role)) return { error: 'Ruolo non valido' };
  // Piede preferito: facoltativo
  const foot = b.foot == null || b.foot === '' ? null : String(b.foot);
  if (foot !== null && !FEET.includes(foot)) return { error: 'Piede preferito non valido' };

  // Nazionalità: facoltativa, codice paese (IT, BR…; ENG/SCT/WLS per le nazionali britanniche)
  // Fino a 2 nazionalità (b.nationalities); `nationality` resta la prima, per compatibilità con i dati esistenti
  const rawNats = Array.isArray(b.nationalities) ? b.nationalities : (b.nationality ? [b.nationality] : []);
  const nationalities = [...new Set(rawNats.map((x) => String(x == null ? '' : x).trim().toUpperCase()).filter(Boolean))];
  if (nationalities.some((c) => !/^[A-Z]{2,3}$/.test(c))) return { error: 'Nazionalità non valida' };
  if (nationalities.length > 2) return { error: 'Puoi indicare al massimo 2 nazionalità' };
  const nationality = nationalities[0] || '';

  // Quotazione personalizzabile: facoltativa, numero 0-9999
  const rawQuote = b.quote === '' || b.quote == null ? null : Number(b.quote);
  if (rawQuote !== null && (!Number.isFinite(rawQuote) || rawQuote < 0 || rawQuote > 9999)) {
    return { error: 'Quotazione non valida (0-9999)' };
  }
  const quote = rawQuote === null ? null : Math.round(rawQuote * 100) / 100;

  // Infortunio: levetta on/off, tipi selezionabili, descrizione se "Altro", foto facoltativa
  const inj = b.injury && typeof b.injury === 'object' ? b.injury : {};
  const injury = { active: false, types: [], other: '', photo: null };
  if (inj.active === true) {
    injury.active = true;
    const types = Array.isArray(inj.types) ? inj.types : [];
    injury.types = INJURY_TYPES.filter((t) => types.includes(t));
    if (!injury.types.length) return { error: 'Seleziona almeno un tipo di infortunio' };
    if (injury.types.includes('Altro')) {
      injury.other = text(inj.other, 1000);
      if (!injury.other) return { error: "Descrivi l'infortunio nel campo Altro" };
    }
  }

  const created = [];
  const toDelete = [];
  try {
    const photo = resolveImage(b.photo, existing && existing.photo, created, toDelete);
    // con la levetta spenta la foto dell'infortunio viene rimossa
    injury.photo = resolveImage(injury.active ? inj.photo : null, existing && existing.injury && existing.injury.photo, created, toDelete);
    return {
      fields: {
        name, age, height, role, foot, quote, nationality, nationalities,
        description: text(b.description, 1000),
        injury,
        warnings: text(b.warnings, 1000),
        photo,
      },
      toDelete,
    };
  } catch (e) {
    created.forEach(deleteImage);
    return { error: e.message };
  }
}

// ---------- Punteggi bonus/malus (valori sempre >= 0: i malus vengono sottratti dal client) ----------
const SCORING_DEFAULTS = {
  goal: 3, penaltyGoal: 3, assist: 1, mvp: 1, penaltySaved: 3, cleanSheet: 1, goalLineSave: 1, // bonus
  ownGoal: 2, goalConceded: 1, penaltyMissed: 3, yellow: 0.5, red: 1,        // malus
};
const EVENT_KEYS = Object.keys(SCORING_DEFAULTS);

function loadScoring() {
  const values = { ...SCORING_DEFAULTS };
  try {
    const saved = readJson(SETTINGS_FILE);
    for (const k of EVENT_KEYS) if (Number.isFinite(saved[k])) values[k] = saved[k];
  } catch { /* file mancante o rovinato: valori predefiniti */ }
  return values;
}

// ---------- Validazione partita ----------
// Stati di presenza: "a voto" = titolare o subentrato
const MATCH_STATUSES = ['titolare', 'subentrato', 'panchina', 'infortunato', 'squalificato', 'assente'];

function buildMatch(b, players) {
  const date = text(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T00:00:00').getTime())) {
    return { error: 'Data non valida' };
  }
  const time = text(b.time, 5);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Ora non valida' };
  const opponent = text(b.opponent, 60);
  if (!opponent) return { error: "L'avversario è obbligatorio" };
  const venue = b.venue === 'Casa' || b.venue === 'Trasferta' ? b.venue : '';
  // Giocatori per squadra (formato della partita): da 5 a 11
  const teamSize = b.teamSize === '' || b.teamSize == null ? 11 : parseInt(b.teamSize, 10);
  if (!Number.isInteger(teamSize) || teamSize < 5 || teamSize > 11) return { error: 'Giocatori per squadra: da 5 a 11' };

  // Risultato facoltativo: o entrambi i punteggi o nessuno
  const score = (v) => (v === '' || v == null ? null : parseInt(v, 10));
  const scoreFor = score(b.scoreFor);
  const scoreAgainst = score(b.scoreAgainst);
  if ((scoreFor === null) !== (scoreAgainst === null)) return { error: 'Inserisci entrambi i punteggi oppure nessuno' };
  for (const s of [scoreFor, scoreAgainst]) {
    if (s !== null && (!Number.isInteger(s) || s < 0 || s > 99)) return { error: 'Punteggio non valido (0-99)' };
  }

  // Presenze: solo giocatori esistenti, uno stato valido, nessun doppione
  const known = new Set(players.map((p) => p.id));
  const seen = new Set();
  const lineup = [];
  for (const e of Array.isArray(b.lineup) ? b.lineup : []) {
    if (!e || typeof e.playerId !== 'string' || !known.has(e.playerId) || seen.has(e.playerId)) continue;
    if (!MATCH_STATUSES.includes(e.status)) return { error: 'Stato di presenza non valido' };
    // Voto facoltativo (0-10) e conteggio di bonus/malus (0-20 per voce)
    const vote = e.vote === '' || e.vote == null ? null : Number(e.vote);
    if (vote !== null && (!Number.isFinite(vote) || vote < 0 || vote > 10)) return { error: 'Voto non valido (0-10)' };
    // Fantavoto inserito a mano (facoltativo): se presente sostituisce il calcolo voto + bonus - malus
    const fv = e.fv === '' || e.fv == null ? null : Number(e.fv);
    if (fv !== null && (!Number.isFinite(fv) || fv < -50 || fv > 100)) return { error: 'Fantavoto non valido (-50 / 100)' };
    const events = {};
    const raw = e.events && typeof e.events === 'object' ? e.events : {};
    for (const k of EVENT_KEYS) {
      const n = parseInt(raw[k], 10);
      if (Number.isInteger(n) && n > 0) events[k] = Math.min(n, 20);
    }
    seen.add(e.playerId);
    const team = e.team === 'B' ? 'B' : 'A'; // A = Noi, B = squadra avversaria
    // Posizione sul campo (percentuali 0-100), facoltativa
    let pos = null;
    if (e.pos && typeof e.pos === 'object') {
      const px = Number(e.pos.x), py = Number(e.pos.y);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        const c = (n) => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
        pos = { x: c(px), y: c(py) };
      }
    }
    lineup.push({ playerId: e.playerId, status: e.status, team, vote: vote === null ? null : Math.round(vote * 100) / 100, fv: fv === null ? null : Math.round(fv * 100) / 100, events, pos });
  }

  return { fields: { date, time, opponent, teamA: text(b.teamA, 60), venue, teamSize, scoreFor, scoreAgainst, notes: text(b.notes, 500), lineup } };
}

// ---------- Validazione notizia ----------
function buildNews(b, existing) {
  const title = text(b.title, 120);
  const description = text(b.description, 5000);
  if (!title) return { error: "Il nome dell'articolo è obbligatorio" };
  if (!description) return { error: 'La descrizione è obbligatoria' };
  // Immagine: vuota = rimossa, "/uploads/x" = mantenuta (solo se è quella attuale), data URL = nuova
  const created = [];
  const toDelete = [];
  let image = null;
  try { image = resolveImage(b.image, existing && existing.image, created, toDelete); }
  catch (e) { created.forEach(deleteImage); return { error: e.message }; }
  // Giocatori di cui parla la notizia (facoltativo): solo giocatori esistenti, senza doppioni
  const known = new Set(readJson(PLAYERS_FILE).map((p) => p.id));
  const playerIds = [...new Set(Array.isArray(b.playerIds) ? b.playerIds : [])]
    .filter((id) => typeof id === 'string' && known.has(id))
    .slice(0, 50);
  return { fields: { title, description, image, playerIds }, toDelete };
}

// ---------- Video ----------
// Caricamento in streaming su disco (il body è il file grezzo, non JSON): niente limite di 6 MB e niente video in RAM
function rejectUpload(req, res, code, msg) {
  req.resume(); // scarta il corpo della richiesta
  return send(res, code, { error: msg }, { Connection: 'close' });
}

function handleVideoUpload(req, res, url, me) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = VIDEO_TYPES[type];
  if (!ext) return rejectUpload(req, res, 415, 'Formato non supportato (usa MP4, WebM o MOV)');
  const len = parseInt(req.headers['content-length'], 10);
  if (!Number.isFinite(len) || len <= 0) return rejectUpload(req, res, 411, 'File vuoto o dimensione sconosciuta');
  if (len > VIDEO_MAX) return rejectUpload(req, res, 413, `Video troppo grande (max ${VIDEO_MAX_MB} MB)`);

  const title = text(url.searchParams.get('title'), 80) || 'Video';
  const id = crypto.randomBytes(16).toString('hex');
  const finalPath = path.join(VIDEO_DIR, id + '.' + ext);
  const tmpPath = finalPath + '.part';
  const out = fs.createWriteStream(tmpPath);
  let size = 0;
  let done = false;

  const fail = (code, msg) => {
    if (done) return;
    done = true;
    req.unpipe(out);
    out.destroy();
    fs.rm(tmpPath, { force: true }, () => {});
    if (!res.headersSent && !res.destroyed) { req.resume(); send(res, code, { error: msg }, { Connection: 'close' }); }
  };

  req.on('data', (c) => {
    size += c.length;
    if (size > VIDEO_MAX) fail(413, `Video troppo grande (max ${VIDEO_MAX_MB} MB)`);
  });
  req.on('close', () => { if (!req.complete) fail(400, 'Caricamento interrotto'); });
  req.on('error', () => fail(400, 'Caricamento interrotto'));
  out.on('error', () => fail(500, 'Impossibile salvare il video'));
  out.on('finish', () => {
    if (done) return;
    done = true;
    try {
      if (size === 0) throw new Error('vuoto');
      fs.renameSync(tmpPath, finalPath);
      const item = { id, title, ext, size, createdBy: me, createdAt: new Date().toISOString() };
      const list = readJson(VIDEOS_FILE);
      list.push(item);
      writeJson(VIDEOS_FILE, list);
      send(res, 201, videoView(item));
    } catch {
      fs.rmSync(tmpPath, { force: true });
      fs.rmSync(finalPath, { force: true });
      send(res, 500, { error: 'Impossibile salvare il video' });
    }
  });
  req.pipe(out);
}

const videoView = (v) => ({ ...v, url: `/videos/${v.id}.${v.ext}` });

// Serve un video con supporto "Range" (necessario per scorrere e riprodurre su iPhone/Safari)
function serveVideo(req, res, file, type) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const size = st.size;
    const base = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    };
    let start = 0;
    let end = size - 1;
    let code = 200;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (m[1] === '' && m[2] === '')) {
        res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      if (m[1] === '') { // ultimi N byte
        start = Math.max(0, size - parseInt(m[2], 10));
      } else {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(end, parseInt(m[2], 10));
      }
      if (start >= size || start > end) {
        res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      code = 206;
      base['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    res.writeHead(code, { ...base, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    pipeline(fs.createReadStream(file, { start, end }), res, () => {});
  });
}

// ---------- Notifiche push (Web Push: solo moduli built-in di Node) ----------
const PUSH_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const PUSH_SELF = process.env.PUSH_NOTIFY_SELF === '1'; // 1 = avvisa anche chi ha fatto la modifica
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function loadVapid() {
  try {
    const saved = readJson(VAPID_FILE);
    return { priv: crypto.createPrivateKey(saved.privateKey), publicKey: saved.publicKey };
  } catch { /* prima volta: si creano le chiavi */ }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const pub = b64u(der.subarray(der.length - 65)); // punto non compresso (65 byte)
  writeJson(VAPID_FILE, { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: pub });
  return { priv: privateKey, publicKey: pub };
}
const VAPID = loadVapid();

const readPush = () => { try { const l = readJson(PUSH_FILE); return Array.isArray(l) ? l : []; } catch { return []; } };

// Solo i servizi push dei browser (evita che il server contatti indirizzi a caso)
const PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'mozaws.net', 'push.apple.com', 'notify.windows.com'];
function validPushEndpoint(ep) {
  try {
    const u = new URL(ep);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

function vapidHeader(endpoint) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: VAPID.priv, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID.publicKey}`;
}

// Cifratura del messaggio (RFC 8291, aes128gcm)
function encryptPayload(sub, payload) {
  const uaPub = Buffer.from(sub.keys.p256dh, 'base64url');
  const auth = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const secret = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPub.length;
  return Buffer.concat([header, asPub, data]);
}

// Invia una notifica a un dispositivo; restituisce il codice HTTP del servizio push (0 = errore di rete)
function sendPush(sub, message) {
  return new Promise((resolve) => {
    let body;
    try { body = encryptPayload(sub, Buffer.from(JSON.stringify(message))); } catch { return resolve(0); }
    const u = new URL(sub.endpoint);
    const req = https.request({
      method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 15000,
      headers: {
        Authorization: vapidHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        'Content-Length': body.length, TTL: '86400', Urgency: 'high',
      },
    }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
    req.end(body);
  });
}

// Avvisa chi segue almeno uno dei giocatori indicati (escluso chi ha fatto la modifica)
function notifyFollowers(playerIds, actor, build) {
  try {
    const everyone = playerIds === null; // null = tutti i dispositivi iscritti (notizie senza giocatori)
    const ids = new Set(playerIds || []);
    const targets = readPush().filter((s) => (PUSH_SELF || s.username !== actor) && (everyone || (s.followed || []).some((id) => ids.has(id))));
    if (!targets.length) return;
    const dead = new Set();
    Promise.all(targets.map(async (s) => {
      const msg = build((s.followed || []).filter((id) => ids.has(id)));
      if (!msg) return;
      const st = await sendPush(s, { url: '/', ...msg });
      if (st === 404 || st === 410) dead.add(s.endpoint); // dispositivo non più iscritto
    })).then(() => {
      if (dead.size) writeJson(PUSH_FILE, readPush().filter((s) => !dead.has(s.endpoint)));
    }).catch(() => {});
  } catch { /* le notifiche non devono mai bloccare il salvataggio */ }
}

const pushAlertState = (p) => {
  const inj = p.injury && p.injury.active ? p.injury : null;
  return { inj: inj ? inj.types.join(', ') + (inj.other ? ': ' + inj.other : '') : '', warn: p.warnings || '' };
};
function pushPlayerChange(before, after, actor) {
  const a = pushAlertState(before), b = pushAlertState(after);
  if (b.inj && b.inj !== a.inj) notifyFollowers([after.id], actor, () => ({ title: `🩹 ${after.name} infortunato`, body: b.inj, tag: 'inj-' + after.id }));
  if (b.warn && b.warn !== a.warn) notifyFollowers([after.id], actor, () => ({ title: `⚠️ Avvertimento per ${after.name}`, body: b.warn, tag: 'warn-' + after.id }));
}

const EVENT_INFO = {
  goal: ['⚽', 'Gol segnato', 'bonus'], penaltyGoal: ['🎯', 'Rigore segnato', 'bonus'], assist: ['🅰️', 'Assist', 'bonus'],
  mvp: ['⭐', 'MVP', 'bonus'], penaltySaved: ['🧤', 'Rigore parato', 'bonus'], cleanSheet: ['🛡️', 'Clean sheet', 'bonus'],
  goalLineSave: ['🚧', 'Salvataggio sulla linea', 'bonus'],
  ownGoal: ['😬', 'Autogol', 'malus'], goalConceded: ['🥅', 'Gol subito', 'malus'], penaltyMissed: ['❌', 'Rigore sbagliato', 'malus'],
  yellow: ['🟨', 'Ammonizione', 'malus'], red: ['🟥', 'Espulsione', 'malus'],
};
const fmtNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
function pushMatchChange(before, after, actor) {
  const players = readJson(PLAYERS_FILE);
  const scoring = loadScoring();
  const title = (after.teamA ? after.teamA + ' vs ' : 'vs ') + after.opponent;
  const was = new Map((before.lineup || []).map((e) => [e.playerId, e.events || {}]));
  for (const e of after.lineup || []) {
    const old = was.get(e.playerId);
    const p = players.find((x) => x.id === e.playerId);
    if (!old || !p) continue;
    const parts = [];
    let bonus = false, malus = false;
    for (const k of EVENT_KEYS) {
      const delta = ((e.events && e.events[k]) || 0) - (old[k] || 0);
      if (delta <= 0 || !EVENT_INFO[k]) continue;
      const [icon, label, group] = EVENT_INFO[k];
      if (group === 'bonus') bonus = true; else malus = true;
      parts.push(`${icon} ${label}${delta > 1 ? ' ×' + delta : ''} (${group === 'bonus' ? '+' : '−'}${fmtNum(scoring[k] * delta)})`);
    }
    if (!parts.length) continue;
    const kind = bonus && malus ? 'bonus e malus' : bonus ? 'bonus' : 'malus';
    notifyFollowers([p.id], actor, () => ({
      title: `${malus && !bonus ? '🔻' : '⭐'} ${p.name}: nuovo ${kind}`, body: `${parts.join(', ')} · ${title}`, tag: `ev-${after.id}-${p.id}`,
    }));
  }
}
function pushNews(item, actor, onlyIds) {
  const tagged = onlyIds || item.playerIds || [];
  if (!tagged.length) {
    if (onlyIds) return; // in modifica: avvisa solo per i giocatori aggiunti ora
    // notizia generale (nessun giocatore indicato): la ricevono tutti i dispositivi con le notifiche attive
    return notifyFollowers(null, actor, () => ({ title: "📰 C'è una nuova notizia", body: item.title, tag: 'news-' + item.id }));
  }
  const players = readJson(PLAYERS_FILE);
  // hit = solo i giocatori della notizia che questo utente segue
  notifyFollowers(tagged, actor, (hit) => ({
    title: `📰 C'è una nuova notizia per te per ${hit.map((id) => (players.find((p) => p.id === id) || {}).name).filter(Boolean).join(', ')}`,
    body: item.title, tag: 'news-' + item.id,
  }));
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const route = url.pathname.slice(4); // toglie "/api"
  const method = req.method;

  // Upload video: corpo binario (non JSON), gestito a parte
  if (route === '/videos' && method === 'POST') {
    const u = currentUser(req);
    if (!u) return rejectUpload(req, res, 401, 'Non autenticato');
    if (!isAdminUser(u)) return rejectUpload(req, res, 403, 'Solo gli admin possono aggiungere o modificare');
    return handleVideoUpload(req, res, url, u);
  }

  if (method !== 'GET' && method !== 'DELETE' && !(req.headers['content-type'] || '').includes('application/json')) {
    return send(res, 415, { error: 'Content-Type non supportato' });
  }

  // Login (gli utenti si aggiungono a mano in data/users.json)
  if (route === '/login' && method === 'POST') {
    if (tooManyAttempts(req)) return send(res, 429, { error: 'Troppi tentativi, riprova tra qualche minuto' });
    const { username, password } = await readBody(req);
    let users;
    try { users = readJson(USERS_FILE); }
    catch { return send(res, 500, { error: 'users.json non è un JSON valido: controlla virgole e virgolette' }); }
    const wanted = text(username, 40).toLowerCase();
    const user = Array.isArray(users) && users.find((x) => String(x.username || '').toLowerCase() === wanted);
    if (!user || !verifyPassword(password, user)) {
      return send(res, 401, { error: 'Username o password errati' });
    }
    return startSession(res, user.username, isAdminFlag(user));
  }

  // Registrazione: crea un account non admin (isadmin: false) e apre subito la sessione
  if (route === '/register' && method === 'POST') {
    if (tooManyAttempts(req)) return send(res, 429, { error: 'Troppi tentativi, riprova tra qualche minuto' });
    const { username, password } = await readBody(req);
    const name = text(username, 40);
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(name)) {
      return send(res, 400, { error: 'Username non valido: 3-40 caratteri tra lettere, numeri, . _ -' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
      return send(res, 400, { error: 'La password deve avere da 6 a 100 caratteri' });
    }
    let users;
    try { users = readJson(USERS_FILE); }
    catch { return send(res, 500, { error: 'users.json non è un JSON valido: controlla virgole e virgolette' }); }
    if (!Array.isArray(users)) users = [];
    const wanted = name.toLowerCase();
    if (users.some((x) => String(x.username || '').toLowerCase() === wanted)) {
      return send(res, 409, { error: 'Username già in uso' });
    }
    users.push({ username: name, password, isadmin: false });
    writeJson(USERS_FILE, users);
    return startSession(res, name, false);
  }

  // Logout
  if (route === '/logout' && method === 'POST') {
    const token = getCookie(req, 'sid');
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' });
  }

  // Utente corrente
  if (route === '/me' && method === 'GET') {
    const me = currentUser(req);
    return me ? send(res, 200, { username: me, isAdmin: isAdminUser(me) }) : send(res, 401, { error: 'Non autenticato' });
  }

  // Da qui in poi serve il login
  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'Non autenticato' });

  // ----- Notifiche push (valgono per tutti gli utenti, anche in sola lettura) -----
  if (route === '/push/key' && method === 'GET') return send(res, 200, { publicKey: VAPID.publicKey });
  if (route === '/push/subscribe' && method === 'POST') {
    const b = await readBody(req);
    const s = b.subscription && typeof b.subscription === 'object' ? b.subscription : {};
    const k = s.keys && typeof s.keys === 'object' ? s.keys : {};
    if (!validPushEndpoint(s.endpoint) || typeof k.p256dh !== 'string' || typeof k.auth !== 'string'
      || Buffer.from(k.p256dh, 'base64url').length !== 65 || Buffer.from(k.auth, 'base64url').length < 16) {
      return send(res, 400, { error: 'Iscrizione alle notifiche non valida' });
    }
    const known = new Set(readJson(PLAYERS_FILE).map((p) => p.id));
    const followed = [...new Set(Array.isArray(b.followed) ? b.followed : [])]
      .filter((id) => typeof id === 'string' && known.has(id)).slice(0, 500);
    const entry = { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth }, username: me, followed, createdAt: new Date().toISOString() };
    writeJson(PUSH_FILE, [...readPush().filter((x) => x.endpoint !== entry.endpoint), entry]);
    if (b.test === true) {
      const st = await sendPush(entry, {
        title: '🔔 Notifiche attive', url: '/', tag: 'test',
        body: 'Ti avviso se un giocatore che segui si infortuna, riceve un avvertimento, un bonus/malus o una notizia.',
      });
      if (st < 200 || st >= 300) {
        return send(res, 502, { error: st === 0
          ? 'Il server non riesce a contattare il servizio notifiche (serve internet in uscita)'
          : `Il servizio notifiche ha rifiutato l'invio (codice ${st})` });
      }
    }
    return send(res, 200, { ok: true });
  }
  if (route === '/push/unsubscribe' && method === 'POST') {
    const b = await readBody(req);
    writeJson(PUSH_FILE, readPush().filter((x) => !(x.endpoint === b.endpoint && x.username === me)));
    return send(res, 200, { ok: true });
  }

  // Chi non è admin può solo leggere: ogni aggiunta, modifica o eliminazione è rifiutata
  if (method !== 'GET' && !isAdminUser(me)) {
    return send(res, 403, { error: 'Solo gli admin possono aggiungere o modificare' });
  }

  // Lista giocatori
  if (route === '/players' && method === 'GET') {
    return send(res, 200, readJson(PLAYERS_FILE).reverse());
  }

  // Aggiungi giocatore
  if (route === '/players' && method === 'POST') {
    const r = buildPlayer(await readBody(req), null);
    if (r.error) return send(res, 400, { error: r.error });
    const player = {
      id: crypto.randomUUID(),
      ...r.fields,
      createdBy: me,
      createdAt: new Date().toISOString(),
    };
    const players = readJson(PLAYERS_FILE);
    players.push(player);
    writeJson(PLAYERS_FILE, players);
    return send(res, 201, player);
  }

  const one = /^\/players\/([0-9a-f-]{36})$/.exec(route);

  // Modifica giocatore (solo chi l'ha creato)
  if (one && method === 'PUT') {
    const body = await readBody(req);
    const players = readJson(PLAYERS_FILE);
    const idx = players.findIndex((x) => x.id === one[1]);
    if (idx < 0) return send(res, 404, { error: 'Giocatore non trovato' });
    const existing = players[idx];
    if (existing.createdBy !== me) return send(res, 403, { error: 'Puoi modificare solo i giocatori che hai aggiunto tu' });
    const r = buildPlayer(body, existing);
    if (r.error) return send(res, 400, { error: r.error });
    players[idx] = { ...existing, ...r.fields, updatedAt: new Date().toISOString() };
    writeJson(PLAYERS_FILE, players);
    r.toDelete.forEach(deleteImage); // elimina le vecchie immagini solo dopo aver salvato
    pushPlayerChange(existing, players[idx], me); // notifica chi segue il giocatore (infortunio / avvertimento)
    return send(res, 200, players[idx]);
  }

  // Elimina giocatore (solo chi l'ha creato)
  if (one && method === 'DELETE') {
    const players = readJson(PLAYERS_FILE);
    const p = players.find((x) => x.id === one[1]);
    if (!p) return send(res, 404, { error: 'Giocatore non trovato' });
    if (p.createdBy !== me) return send(res, 403, { error: 'Puoi eliminare solo i giocatori che hai aggiunto tu' });
    writeJson(PLAYERS_FILE, players.filter((x) => x.id !== p.id));
    deleteImage(p.photo);
    deleteImage(p.injury && p.injury.photo);
    // toglie il giocatore dalle presenze delle partite
    const allMatches = readJson(MATCHES_FILE);
    let touched = false;
    for (const m of allMatches) {
      const before = (m.lineup || []).length;
      m.lineup = (m.lineup || []).filter((e) => e.playerId !== p.id);
      if (m.lineup.length !== before) touched = true;
    }
    if (touched) writeJson(MATCHES_FILE, allMatches);
    return send(res, 200, { ok: true });
  }

  // ----- Impostazioni punteggi -----
  if (route === '/settings' && method === 'GET') {
    return send(res, 200, { values: loadScoring(), defaults: SCORING_DEFAULTS });
  }
  if (route === '/settings' && method === 'PUT') {
    const body = await readBody(req);
    const incoming = body.values && typeof body.values === 'object' ? body.values : {};
    const values = loadScoring();
    for (const k of EVENT_KEYS) {
      if (incoming[k] === undefined || incoming[k] === '') continue;
      const n = Number(incoming[k]);
      if (!Number.isFinite(n) || n < 0 || n > 50) return send(res, 400, { error: 'Valore non valido (0-50)' });
      values[k] = Math.round(n * 100) / 100;
    }
    writeJson(SETTINGS_FILE, values);
    return send(res, 200, { values, defaults: SCORING_DEFAULTS });
  }

  // ----- Partite -----
  if (route === '/matches' && method === 'GET') {
    return send(res, 200, readJson(MATCHES_FILE));
  }

  if (route === '/matches' && method === 'POST') {
    const r = buildMatch(await readBody(req), readJson(PLAYERS_FILE));
    if (r.error) return send(res, 400, { error: r.error });
    const match = { id: crypto.randomUUID(), ...r.fields, createdBy: me, createdAt: new Date().toISOString() };
    const matches = readJson(MATCHES_FILE);
    matches.push(match);
    writeJson(MATCHES_FILE, matches);
    return send(res, 201, match);
  }

  const oneMatch = /^\/matches\/([0-9a-f-]{36})$/.exec(route);

  // Modifica partita e presenze (solo chi l'ha creata)
  if (oneMatch && method === 'PUT') {
    const body = await readBody(req);
    const matches = readJson(MATCHES_FILE);
    const idx = matches.findIndex((x) => x.id === oneMatch[1]);
    if (idx < 0) return send(res, 404, { error: 'Partita non trovata' });
    if (matches[idx].createdBy !== me) return send(res, 403, { error: 'Puoi modificare solo le partite che hai aggiunto tu' });
    const r = buildMatch(body, readJson(PLAYERS_FILE));
    if (r.error) return send(res, 400, { error: r.error });
    const before = matches[idx];
    matches[idx] = { ...before, ...r.fields, updatedAt: new Date().toISOString() };
    writeJson(MATCHES_FILE, matches);
    try { pushMatchChange(before, matches[idx], me); } catch { /* le notifiche non bloccano il salvataggio */ }
    return send(res, 200, matches[idx]);
  }

  // Elimina partita (solo chi l'ha creata)
  if (oneMatch && method === 'DELETE') {
    const matches = readJson(MATCHES_FILE);
    const m = matches.find((x) => x.id === oneMatch[1]);
    if (!m) return send(res, 404, { error: 'Partita non trovata' });
    if (m.createdBy !== me) return send(res, 403, { error: 'Puoi eliminare solo le partite che hai aggiunto tu' });
    writeJson(MATCHES_FILE, matches.filter((x) => x.id !== m.id));
    return send(res, 200, { ok: true });
  }

  // ----- News -----
  if (route === '/news' && method === 'GET') {
    return send(res, 200, readJson(NEWS_FILE).reverse());
  }
  if (route === '/news' && method === 'POST') {
    const r = buildNews(await readBody(req));
    if (r.error) return send(res, 400, { error: r.error });
    const item = { id: crypto.randomUUID(), ...r.fields, createdBy: me, createdAt: new Date().toISOString() };
    const list = readJson(NEWS_FILE);
    list.push(item);
    writeJson(NEWS_FILE, list);
    try { pushNews(item, me); } catch { /* le notifiche non bloccano il salvataggio */ }
    return send(res, 201, item);
  }
  const oneNews = /^\/news\/([0-9a-f-]{36})$/.exec(route);
  // Modifica notizia (solo chi l'ha scritta)
  if (oneNews && method === 'PUT') {
    const body = await readBody(req);
    const list = readJson(NEWS_FILE);
    const idx = list.findIndex((x) => x.id === oneNews[1]);
    if (idx < 0) return send(res, 404, { error: 'Notizia non trovata' });
    if (list[idx].createdBy !== me) return send(res, 403, { error: 'Puoi modificare solo le notizie che hai scritto tu' });
    const r = buildNews(body, list[idx]);
    if (r.error) return send(res, 400, { error: r.error });
    const prevIds = new Set(list[idx].playerIds || []);
    list[idx] = { ...list[idx], ...r.fields, updatedAt: new Date().toISOString() };
    writeJson(NEWS_FILE, list);
    r.toDelete.forEach(deleteImage); // elimina la vecchia immagine solo dopo aver salvato
    const added = (list[idx].playerIds || []).filter((id) => !prevIds.has(id));
    if (added.length) { try { pushNews(list[idx], me, added); } catch { /* le notifiche non bloccano il salvataggio */ } }
    return send(res, 200, list[idx]);
  }
  // Elimina notizia (solo chi l'ha scritta)
  if (oneNews && method === 'DELETE') {
    const list = readJson(NEWS_FILE);
    const n = list.find((x) => x.id === oneNews[1]);
    if (!n) return send(res, 404, { error: 'Notizia non trovata' });
    if (n.createdBy !== me) return send(res, 403, { error: 'Puoi eliminare solo le notizie che hai scritto tu' });
    writeJson(NEWS_FILE, list.filter((x) => x.id !== n.id));
    deleteImage(n.image);
    return send(res, 200, { ok: true });
  }

  // ----- Video -----
  if (route === '/videos' && method === 'GET') {
    return send(res, 200, { items: readJson(VIDEOS_FILE).reverse().map(videoView), maxMB: VIDEO_MAX_MB });
  }

  const oneVideo = /^\/videos\/([a-f0-9]{32})$/.exec(route);

  // Elimina video (solo chi l'ha caricato)
  if (oneVideo && method === 'DELETE') {
    const list = readJson(VIDEOS_FILE);
    const v = list.find((x) => x.id === oneVideo[1]);
    if (!v) return send(res, 404, { error: 'Video non trovato' });
    if (v.createdBy !== me) return send(res, 403, { error: 'Puoi eliminare solo i video che hai caricato tu' });
    writeJson(VIDEOS_FILE, list.filter((x) => x.id !== v.id));
    fs.rmSync(path.join(VIDEO_DIR, `${v.id}.${v.ext}`), { force: true });
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Non trovato' });
}

function startSession(res, username, isAdmin) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, exp: Date.now() + SESSION_MS });
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return send(res, 200, { username, isAdmin }, {
    'Set-Cookie': `sid=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secure}`,
  });
}

// ---------- File statici ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'], // service worker delle notifiche push
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function serveFile(res, file, type, extra = {}) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (STATIC[url.pathname]) {
      const [f, type] = STATIC[url.pathname];
      return serveFile(res, path.join(ROOT, f), type, { 'Cache-Control': 'no-cache' });
    }

    const up = /^\/uploads\/([a-f0-9]{32})\.(png|jpg|webp)$/.exec(url.pathname);
    if (up) {
      return serveFile(res, path.join(UPLOAD_DIR, up[1] + '.' + up[2]), MIME[up[2]], {
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
    }

    const vid = /^\/videos\/([a-f0-9]{32})\.(mp4|webm|mov)$/.exec(url.pathname);
    if (vid && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!currentUser(req)) { res.writeHead(401); return res.end('Non autenticato'); }
      return serveVideo(req, res, path.join(VIDEO_DIR, vid[1] + '.' + vid[2]), VIDEO_MIME[vid[2]]);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: e.message || 'Errore' });
  }
});

server.requestTimeout = 0; // gli upload di video grandi su Wi-Fi lenta possono superare i 5 minuti predefiniti
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fantacalcio attivo su http://localhost:${PORT}`);
});
