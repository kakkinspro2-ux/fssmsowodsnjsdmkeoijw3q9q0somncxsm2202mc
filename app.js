(() => {
  const $ = (s) => document.querySelector(s);
  const INJURY_TYPES = ['Muscolare', 'Distorsione', 'Frattura', 'Contusione', 'Legamento crociato', 'Tendinite', 'Malattia', 'Altro'];

  let me = null;
  let isAdmin = false; // da users.json: se false l'app è in sola lettura
  let players = [];
  const images = { photo: null, injury: null };
  const selected = new Set(); // tipi di infortunio scelti
  let editingId = null; // id del giocatore in modifica (null = nuovo)
  const ROLES = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
  let role = null; // ruolo scelto nel form (null = nessuno)
  const FEET = ['Destro', 'Sinistro', 'Ambidestro'];
  let foot = null; // piede preferito scelto nel form (null = non indicato)

  // Calendario / partite
  let matches = [];
  let tab = 'players'; // 'profile' | 'players' | 'cal' | 'rank' | 'settings'
  let editingMatchId = null;
  let openMatchId = null;
  let matchVenue = '';
  const lineupDraft = new Map(); // playerId -> stato, nel form partita
  const lineupData = new Map(); // playerId -> presenza originale (conserva voto e bonus/malus in modifica)
  const lineupTeam = new Map(); // playerId -> 'A' (Noi) | 'B' (avversario), nel form partita
  let settings = {}; // punti di bonus/malus (dal server)
  let settingsDefaults = {};
  let voteCtx = null; // giocatore/partita nel dialog del voto
  const ROLE_ORDER = { P: 0, D: 1, C: 2, A: 3 };
  const STATUSES = {
    titolare: 'Titolare',
    subentrato: 'Subentrato',
    panchina: 'In panchina',
    infortunato: 'Fuori (infortunio)',
    squalificato: 'Squalificato',
    assente: 'Assente',
  };

  // Nazionalità: tutti i paesi (codici ISO 3166-1) + nazionali britanniche. Nomi in italiano dal browser
  // (Intl.DisplayNames); bandiera ricavata dal codice (emoji), senza immagini da scaricare
  const ISO_CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
    'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
    'UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK').split(' ');
  // nomi di riserva (se il browser non ha Intl.DisplayNames) e nazionali britanniche
  const COUNTRY_FALLBACK = {
    IT: 'Italia', AL: 'Albania', DZ: 'Algeria', AO: 'Angola', AR: 'Argentina', AU: 'Australia', AT: 'Austria',
    BE: 'Belgio', BA: 'Bosnia ed Erzegovina', BR: 'Brasile', BG: 'Bulgaria', CM: 'Camerun', CA: 'Canada',
    CV: 'Capo Verde', CL: 'Cile', CO: 'Colombia', KR: 'Corea del Sud', CI: "Costa d'Avorio", HR: 'Croazia',
    DK: 'Danimarca', EC: 'Ecuador', EG: 'Egitto', FR: 'Francia', GE: 'Georgia', DE: 'Germania',
    GH: 'Ghana', JP: 'Giappone', GR: 'Grecia', GN: 'Guinea', IE: 'Irlanda', IS: 'Islanda',
    IL: 'Israele', XK: 'Kosovo', MK: 'Macedonia del Nord', ML: 'Mali', MA: 'Marocco', MX: 'Messico',
    ME: 'Montenegro', NG: 'Nigeria', NO: 'Norvegia', NL: 'Paesi Bassi', PY: 'Paraguay', PE: 'Perù', PL: 'Polonia',
    PT: 'Portogallo', CD: 'RD Congo', CZ: 'Repubblica Ceca', RO: 'Romania', RU: 'Russia',
    SN: 'Senegal', RS: 'Serbia', SK: 'Slovacchia', SI: 'Slovenia', ES: 'Spagna', US: 'Stati Uniti', SE: 'Svezia',
    CH: 'Svizzera', TN: 'Tunisia', TR: 'Turchia', UA: 'Ucraina', HU: 'Ungheria', UY: 'Uruguay', VE: 'Venezuela',
  };
  const BRITISH = { ENG: 'Inghilterra', SCT: 'Scozia', WLS: 'Galles', NIR: 'Irlanda del Nord' };
  const COUNTRIES = {};
  {
    let dn = null;
    try { dn = new Intl.DisplayNames(['it'], { type: 'region' }); } catch { /* browser vecchio */ }
    for (const code of ISO_CODES) {
      let name = '';
      try { name = dn ? dn.of(code) : ''; } catch { /* codice sconosciuto */ }
      COUNTRIES[code] = name && name !== code ? name : COUNTRY_FALLBACK[code] || code;
    }
    Object.assign(COUNTRIES, BRITISH);
  }
  const TAG_FLAGS = { ENG: 'gbeng', SCT: 'gbsct', WLS: 'gbwls' }; // bandiere con sequenza di tag
  const FLAG_ALIAS = { NIR: 'GB' }; // l'Irlanda del Nord non ha una bandiera emoji
  function flagOf(code) {
    if (!code) return '';
    code = FLAG_ALIAS[code] || code;
    if (TAG_FLAGS[code]) {
      return '\u{1F3F4}' + [...TAG_FLAGS[code]].map((c) => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('') + '\u{E007F}';
    }
    return code.length === 2 ? [...code].map((c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('') : '';
  }
  const countryName = (code) => COUNTRIES[code] || code;
  // nazionalità di un giocatore (compatibile con i giocatori salvati con il solo campo `nationality`)
  const natsOf = (p) => (Array.isArray(p.nationalities) && p.nationalities.length ? p.nationalities : p.nationality ? [p.nationality] : []).slice(0, 2);
  {
    const entries = Object.entries(COUNTRIES).sort((a, b) =>
      (a[0] === 'IT' ? -1 : b[0] === 'IT' ? 1 : 0) || a[1].localeCompare(b[1], 'it'));
    for (const id of ['#f-nat', '#f-nat2']) {
      const sel = document.querySelector(id);
      for (const [code, name] of entries) {
        const o = document.createElement('option');
        o.value = code; o.textContent = `${flagOf(code)} ${name}`.trim();
        sel.append(o);
      }
    }
  }
  // seconda nazionalità: il pulsante ＋ mostra la seconda casella, ✕ la toglie
  function setNat2(show) {
    $('#f-nat2').classList.toggle('hidden', !show);
    if (!show) $('#f-nat2').value = '';
    const btn = $('#nat-add');
    btn.textContent = show ? '✕' : '＋';
    btn.setAttribute('aria-label', show ? 'Rimuovi la seconda nazionalità' : 'Aggiungi una seconda nazionalità');
  }
  const formNats = () => [...new Set([$('#f-nat').value, $('#f-nat2').value].filter(Boolean))];

  // ---------- Utility ----------
  $('#nat-add').addEventListener('click', () => setNat2($('#f-nat2').classList.contains('hidden')));

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && me && path !== '/login') showAuth();
      throw new Error(data.error || 'Errore di rete');
    }
    return data;
  }

  // Crea elementi DOM in modo sicuro (nessun innerHTML con dati utente)
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c) el.append(c);
    return el;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    // il toast è un popover: sta nel "top layer" e quindi compare sopra anche alle finestre modali
    if (t.showPopover) {
      if (!t.hasAttribute('popover')) t.setAttribute('popover', 'manual');
      try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch { /* ignora */ }
    }
    t.classList.remove('hidden', 'anim');
    void t.offsetWidth; // riavvia l'animazione
    t.classList.add('anim');
    toast.t = setTimeout(() => {
      t.classList.add('hidden');
      try { if (t.matches(':popover-open')) t.hidePopover(); } catch { /* ignora */ }
    }, 2500);
  }

  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const activeInjury = (p) => (p.injury && p.injury.active ? p.injury : null);

  // Ridimensiona l'immagine nel browser prima dell'invio
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // PNG e WebP possono avere lo sfondo trasparente: restano PNG (senza riempimento bianco).
        // Le altre foto (JPEG, HEIC…) diventano JPEG come prima.
        const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || /\.(png|webp)$/i.test(file.name || '');
        const MAX_CHARS = 2.5 * 1024 * 1024; // il server accetta al massimo 2 MB (circa 2,7 milioni di caratteri in base64)
        let scale = Math.min(1, max / Math.max(img.width, img.height));
        let out = '';
        for (let attempt = 0; attempt < 6; attempt++) {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          const ctx = c.getContext('2d');
          if (!keepAlpha) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
          }
          ctx.drawImage(img, 0, 0, c.width, c.height);
          out = keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
          if (out.length <= MAX_CHARS) break;
          scale *= 0.75; // PNG troppo pesante: riduce le dimensioni e riprova
        }
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
      img.src = url;
    });
  }

  // ---------- Auth ----------
  function showAuth() {
    me = null;
    isAdmin = false;
    alertSnap = null;
    eventSnap = null;
    newsSeen = null;
    followed = new Set();
    closeMenu(false);
    pauseVideos();
    $('#app').classList.add('hidden');
    $('#auth').classList.remove('hidden');
  }
  function showApp() {
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#who').textContent = 'Ciao, ' + me + (isAdmin ? '' : ' · sola lettura');
    setArea('fanta');
    updateNotifBtn();
    loadFollowed();
    initPush();
    loadPlayers();
    loadMatches();
    loadSettings();
    loadVideos();
    loadNews();
  }

  // Accesso / registrazione: lo stesso form cambia modalità
  let registering = false;
  function setAuthMode(reg) {
    registering = reg;
    $('#password2-wrap').classList.toggle('hidden', !reg);
    $('#password2').required = reg;
    $('#password2').value = '';
    $('#password').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    $('#auth-submit').textContent = reg ? 'Crea account' : 'Accedi';
    $('#auth-switch').textContent = reg ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati';
    document.querySelector('#auth .sub').textContent = reg ? 'Crea il tuo account (sola lettura)' : 'Accedi per gestire i tuoi giocatori';
    $('#auth-error').textContent = '';
  }
  $('#auth-switch').addEventListener('click', () => setAuthMode(!registering));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#auth-submit');
    $('#auth-error').textContent = '';
    if (registering && $('#password').value !== $('#password2').value) {
      $('#auth-error').textContent = 'Le due password non coincidono';
      return;
    }
    btn.disabled = true;
    try {
      const r = await api(registering ? '/register' : '/login', {
        method: 'POST',
        body: { username: $('#username').value, password: $('#password').value },
      });
      me = r.username;
      isAdmin = !!r.isAdmin;
      $('#password').value = '';
      setAuthMode(false);
      showApp();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  $('#logout').addEventListener('click', async () => {
    await pushDetach(); // questo telefono smette di ricevere le notifiche di questo account
    await api('/logout', { method: 'POST', body: {} }).catch(() => {});
    showAuth();
  });

  // ---------- Lista ----------
  async function loadPlayers() {
    try {
      players = await api('/players');
      checkAlerts(players);
      renderList();
      renderCalendar();
    } catch (err) { toast(err.message); }
  }

  function avatar(p, cls = 'avatar') {
    return p.photo
      ? h('img', { class: cls, src: p.photo, alt: p.name, loading: 'lazy' })
      : h('div', { class: cls, text: initials(p.name) });
  }

  // Pallino colorato con la lettera del ruolo (P/D/C/A)
  function roleBadge(p) {
    return p.role && ROLES[p.role] ? h('span', { class: 'role-dot', text: p.role, title: ROLES[p.role] }) : null;
  }
  const roleClass = (p) => (p.role && ROLES[p.role] ? ' role-' + p.role : '');
  function roleAvatar(p) {
    return h('div', { class: 'av-wrap' + roleClass(p) }, avatar(p), roleBadge(p));
  }

  // ---------- Giocatori seguiti (per utente, salvati nel browser) ----------
  const followKey = () => 'fanta-follow:' + (me || '');
  let followed = new Set();
  function loadFollowed() {
    try { followed = new Set(JSON.parse(localStorage.getItem(followKey()) || '[]')); } catch { followed = new Set(); }
  }
  const isFollowed = (p) => followed.has(p.id);
  function toggleFollow(p) {
    if (followed.has(p.id)) followed.delete(p.id); else followed.add(p.id);
    try { localStorage.setItem(followKey(), JSON.stringify([...followed])); } catch { /* ignora */ }
    const on = followed.has(p.id);
    toast(on ? `🔔 Segui ${p.name}: ti avviso su infortuni, bonus e malus` : `🔕 Non segui più ${p.name}`);
    if (on && !notifActive()) setTimeout(() => toast('Per ricevere le notifiche sul telefono tocca la 🔕 in alto'), 2200);
    if (notifActive()) pushSync(false).catch(() => {}); // il server deve sapere chi segui
    renderList();
  }
  function followBtn(p, cls) {
    const on = isFollowed(p);
    const btn = h('button', {
      type: 'button',
      class: cls,
      'aria-pressed': on ? 'true' : 'false',
      'aria-label': (on ? 'Smetti di seguire ' : 'Segui ') + p.name,
      title: on ? 'Stai seguendo: tocca per smettere' : 'Segui per ricevere notifiche',
      text: on ? '🔔' : '🔕',
      onclick: (ev) => {
        ev.stopPropagation();
        toggleFollow(p);
        const now = isFollowed(p);
        btn.textContent = now ? '🔔' : '🔕';
        btn.setAttribute('aria-pressed', now ? 'true' : 'false');
        btn.classList.toggle('on', now);
      },
    });
    if (on) btn.classList.add('on');
    return btn;
  }

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const shown = players.filter((p) => p.name.toLowerCase().includes(q));
    const list = $('#list');
    list.replaceChildren();
    $('#empty').classList.toggle('hidden', players.length > 0);

    for (const p of shown) {
      const inj = activeInjury(p);
      const badges = h('div', { class: 'badges' });
      if (inj) badges.append(h('span', { class: 'badge inj blink', text: '🩹 ' + (inj.types[0] === 'Altro' ? 'Infortunato' : inj.types.join(', ')) }));
      if (p.warnings) badges.append(h('span', { class: 'badge warn', text: '⚠️ Avvertimenti' }));
      if (!inj && !p.warnings) badges.append(h('span', { class: 'badge ok', text: '✔ Disponibile' }));

      list.append(
        h('div', { class: 'card-wrap' },
          h('button', { class: 'card', type: 'button', onclick: () => openDetail(p) },
            roleAvatar(p),
            h('div', { class: 'card-body' },
              h('h3', { text: p.name }),
              badges)),
          followBtn(p, 'follow-btn')));
    }
  }
  $('#search').addEventListener('input', renderList);

  // ---------- Dettaglio (schermata a tutto schermo) ----------
  function stat(value, label, cls) {
    return h('div', { class: 'd-stat' },
      h('b', { class: cls || '', text: String(value) }),
      h('span', { text: label }));
  }
  function row(label, value, cls) {
    return h('div', { class: 'd-row' },
      h('span', { text: label }),
      h('strong', { class: cls || '', text: value }));
  }

  // Foto dell'infortunio: prima c'è solo il pulsante, la foto appare al tocco e si nasconde con la ✕
  function injuryPhotoViewer(url) {
    const wrap = h('div', { class: 'inj-viewer' });
    function showButton() {
      wrap.replaceChildren(
        h('button', { type: 'button', class: 'btn secondary', text: '📷 Visualizza immagine infortunio', onclick: showImage })
      );
    }
    function showImage() {
      wrap.replaceChildren(
        h('div', { class: 'inj-photo-box' },
          h('img', { class: 'inj-photo', src: url, alt: 'Foto infortunio' }),
          h('button', { type: 'button', class: 'inj-close', 'aria-label': 'Nascondi immagine', text: '✕', onclick: showButton }))
      );
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    showButton();
    return wrap;
  }

  // Scheda completa di un giocatore: usata nel dialog del dettaglio e in "Il mio profilo"
  function playerCard(p, inDialog) {
    const inj = activeInjury(p);
    const mine = isAdmin && p.createdBy === me;
    const ps = playerStats(p.id);

    // Al posto della figurina c'è la foto del giocatore, dentro uno scudo
    const shield = h('div', { class: 'shield-wrap' + roleClass(p) },
      h('div', { class: 'shield' },
        h('div', { class: 'shield-in' },
          p.photo ? h('img', { src: p.photo, alt: p.name }) : h('span', { text: initials(p.name) }))),
      roleBadge(p));

    return [
      h('div', { class: 'd-top' },
        mine
          ? h('button', { class: 'round-btn wide', text: '✎ Modifica', onclick: () => { if (inDialog) $('#detail-dialog').close(); openEdit(p); } })
          : h('span'),
        h('div', { class: 'd-top-right' },
          followBtn(p, 'round-btn follow-round'),
          inDialog
            ? h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Chiudi', text: '✕', onclick: () => $('#detail-dialog').close() })
            : null)),

      h('div', { class: 'd-hero' },
        shield,
        h('div', { class: 'name-row' },
          natsOf(p).length
            ? h('div', { class: 'nat-box' + (natsOf(p).length > 1 ? ' two' : ''), title: natsOf(p).map(countryName).join(' · ') },
                h('b', { text: natsOf(p).map((c) => flagOf(c) || c).join('') }),
                h('span', { text: natsOf(p).join(' · ') }))
            : null,
          h('h2', { text: p.name }),
          h('div', { class: 'quote-box', title: 'Quotazione' },
            h('b', { class: p.quote == null ? '' : 'c-ok', text: p.quote == null ? '—' : fmt(p.quote) }),
            h('span', { text: 'Quota' })))),

      h('div', { class: 'd-stats' },
        stat(p.age, 'Età'),
        stat(p.height ? p.height + ' cm' : '—', 'Altezza'),
        stat(p.foot || '—', 'Piede', 'sm')),

      h('div', { class: 'd-stats second' },
        stat(ps.voto, 'Partite a voto'),
        p.role === 'P' ? stat(ps.subiti, 'Gol subiti') : stat(ps.gol, 'Gol'),
        stat(ps.assist, 'Assist')),

      h('div', { class: 'd-panel' },
        presenceGrid(p),
        votesChart(p),
        p.role && ROLES[p.role] ? row('Ruolo', ROLES[p.role], 'role-text role-' + p.role) : null,
        row('Infortunio', inj ? 'Sì' : 'Nessuno', inj ? 'c-bad' : ''),
        row('Avvertimenti', p.warnings ? 'Sì' : 'Nessuno', p.warnings ? 'c-warn' : ''),
        row('Partite giocate dalla squadra', String(ps.giocate)),
        p.role === 'P'
          ? row('Rigori parati', String(ps.parati), ps.parati ? 'c-ok' : '')
          : row('Rigori segnati / totali', `${ps.rigGol}/${ps.rigGol + ps.rigErr}`, ps.rigGol ? 'c-ok' : ''),
        row('Media voto', ps.mediaVoto == null ? '—' : fmt(ps.mediaVoto)),
        row('Fantamedia', ps.fantamedia == null ? '—' : fmt(ps.fantamedia), ps.fantamedia == null ? '' : 'c-ok'),
        row('Partite vinte', String(ps.vinte), ps.vinte ? 'c-ok' : ''),
        row('Partite perse', String(ps.perse), ps.perse ? 'c-bad' : ''),
        row('Partite pareggiate', String(ps.pareggiate)),

        p.description ? h('div', { class: 'box' }, h('h4', { text: 'Descrizione' }), h('p', { text: p.description })) : null,
        inj
          ? h('div', { class: 'box inj' },
              h('h4', { text: 'Infortunio' }),
              h('div', { class: 'badges' }, inj.types.map((t) => h('span', { class: 'badge inj', text: t }))),
              inj.other ? h('p', { class: 'inj-other', text: inj.other }) : null,
              inj.photo ? injuryPhotoViewer(inj.photo) : null)
          : null,
        p.warnings ? h('div', { class: 'box warn' }, h('h4', { text: 'Avvertimenti' }), h('p', { text: p.warnings })) : null,

        mine
          ? h('button', {
              class: 'btn danger',
              text: 'Elimina giocatore',
              onclick: async () => {
                if (!confirm(`Eliminare ${p.name}?`)) return;
                try {
                  await api('/players/' + p.id, { method: 'DELETE' });
                  if (inDialog) $('#detail-dialog').close();
                  toast('Giocatore eliminato');
                  loadPlayers();
                  loadMatches();
                } catch (err) { toast(err.message); }
              },
            })
          : null)
    ];
  }

  function openDetail(p) {
    $('#detail').replaceChildren(...playerCard(p, true));
    const dlg = $('#detail-dialog');
    dlg.className = roleClass(p).trim(); // bordo della scheda nel colore del ruolo
    dlg.scrollTop = 0;
    dlg.showModal();
  }

  // ---------- Form: ruolo (tocca di nuovo per deselezionare) ----------
  function renderRoles() {
    $('#role-chips').replaceChildren(
      ...Object.entries(ROLES).map(([key, name]) =>
        h('button', {
          type: 'button',
          class: `role-chip role-${key}` + (role === key ? ' on' : ''),
          'aria-pressed': role === key ? 'true' : 'false',
          onclick: () => { role = role === key ? null : key; renderRoles(); },
        },
          h('span', { class: 'role-dot', text: key }),
          h('span', { text: name }))
      )
    );
  }

  // ---------- Form: piede preferito (tocca di nuovo per deselezionare) ----------
  function renderFoot() {
    $('#foot-chips').replaceChildren(
      ...FEET.map((f) =>
        h('button', {
          type: 'button',
          class: 'seg-btn' + (foot === f ? ' on' : ''),
          'aria-pressed': foot === f ? 'true' : 'false',
          text: f,
          onclick: () => { foot = foot === f ? null : f; renderFoot(); },
        }))
    );
  }

  // ---------- Form: infortunio ----------
  function renderChips() {
    const wrap = $('#inj-chips');
    wrap.replaceChildren(
      ...INJURY_TYPES.map((t) =>
        h('button', {
          type: 'button',
          class: 'chip' + (selected.has(t) ? ' on' : ''),
          'aria-pressed': selected.has(t) ? 'true' : 'false',
          text: t,
          onclick: () => {
            selected.has(t) ? selected.delete(t) : selected.add(t);
            renderChips();
          },
        })
      )
    );
    $('#inj-other-wrap').classList.toggle('hidden', !selected.has('Altro'));
  }

  $('#inj-toggle').addEventListener('change', (e) => {
    $('#inj-panel').classList.toggle('hidden', !e.target.checked);
  });

  $('#warn-toggle').addEventListener('change', (e) => {
    $('#warn-panel').classList.toggle('hidden', !e.target.checked);
  });

  // ---------- Form: immagini ----------
  function setPreview(key, prevSel, phSel, removeSel) {
    const has = !!images[key];
    if (has) $(prevSel).src = images[key];
    $(prevSel).classList.toggle('hidden', !has);
    $(phSel).classList.toggle('hidden', has);
    if (removeSel) $(removeSel).classList.toggle('hidden', !has);
  }

  $('#photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      images.photo = await resizeImage(file, 600);
      setPreview('photo', '#photo-prev', '#photo-ph', '#photo-remove');
    } catch (err) { $('#add-error').textContent = err.message; }
  });

  $('#inj-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      images.injury = await resizeImage(file, 900);
      setPreview('injury', '#inj-prev', '#inj-ph', '#inj-photo-remove');
    } catch (err) { $('#add-error').textContent = err.message; }
  });

  $('#photo-remove').addEventListener('click', () => {
    images.photo = null;
    $('#photo').value = '';
    setPreview('photo', '#photo-prev', '#photo-ph', '#photo-remove');
  });

  $('#inj-photo-remove').addEventListener('click', () => {
    images.injury = null;
    $('#inj-photo').value = '';
    setPreview('injury', '#inj-prev', '#inj-ph', '#inj-photo-remove');
  });

  // ---------- Form: apertura / invio ----------
  function resetAddForm() {
    $('#add-form').reset();
    setNat2(false);
    images.photo = images.injury = null;
    selected.clear();
    role = null;
    renderRoles();
    foot = null;
    renderFoot();
    $('#warn-panel').classList.add('hidden');
    $('#inj-panel').classList.add('hidden');
    renderChips();
    setPreview('photo', '#photo-prev', '#photo-ph', '#photo-remove');
    setPreview('injury', '#inj-prev', '#inj-ph', '#inj-photo-remove');
    $('#add-error').textContent = '';
  }
  function setFormMode(id) {
    editingId = id;
    $('#form-title').textContent = id ? 'Modifica giocatore' : 'Nuovo giocatore';
    $('#add-submit').textContent = id ? 'Salva modifiche' : 'Salva giocatore';
  }

  // Apre il form già compilato con i dati del giocatore
  function openEdit(p) {
    resetAddForm();
    setFormMode(p.id);
    $('#f-name').value = p.name;
    $('#f-age').value = p.age;
    $('#f-height').value = p.height || '';
    $('#f-quote').value = p.quote ?? '';
    const nats = natsOf(p).filter((c) => COUNTRIES[c]);
    $('#f-nat').value = nats[0] || '';
    $('#f-nat2').value = nats[1] || '';
    setNat2(nats.length > 1);
    role = p.role && ROLES[p.role] ? p.role : null;
    renderRoles();
    foot = FEET.includes(p.foot) ? p.foot : null;
    renderFoot();
    $('#f-desc').value = p.description || '';
    $('#f-warn').value = p.warnings || '';
    if (p.warnings) {
      $('#warn-toggle').checked = true;
      $('#warn-panel').classList.remove('hidden');
    }
    images.photo = p.photo || null;
    setPreview('photo', '#photo-prev', '#photo-ph', '#photo-remove');

    const inj = activeInjury(p);
    if (inj) {
      $('#inj-toggle').checked = true;
      $('#inj-panel').classList.remove('hidden');
      inj.types.forEach((t) => selected.add(t));
      $('#inj-other').value = inj.other || '';
      images.injury = inj.photo || null;
      renderChips();
      setPreview('injury', '#inj-prev', '#inj-ph', '#inj-photo-remove');
    }
    $('#add-dialog').showModal();
  }

  $('#fab').addEventListener('click', () => {
    if (tab === 'cal') return openMatchForm(null);
    resetAddForm(); setFormMode(null); $('#add-dialog').showModal();
  });
  $('#add-close').addEventListener('click', () => $('#add-dialog').close());

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#add-submit');
    const injuryOn = $('#inj-toggle').checked;
    const warnOn = $('#warn-toggle').checked;
    $('#add-error').textContent = '';

    if (injuryOn && selected.size === 0) {
      $('#add-error').textContent = 'Seleziona almeno un tipo di infortunio';
      return;
    }
    if (injuryOn && selected.has('Altro') && !$('#inj-other').value.trim()) {
      $('#add-error').textContent = "Descrivi l'infortunio nel campo Altro";
      return;
    }

    if (warnOn && !$('#f-warn').value.trim()) {
      $('#add-error').textContent = "Descrivi l'avvertimento oppure spegni la levetta";
      return;
    }

    btn.disabled = true;
    try {
      await api(editingId ? '/players/' + editingId : '/players', {
        method: editingId ? 'PUT' : 'POST',
        body: {
          name: $('#f-name').value,
          age: $('#f-age').value,
          height: $('#f-height').value,
          quote: $('#f-quote').value,
          nationalities: formNats(),
          role,
          foot,
          description: $('#f-desc').value,
          warnings: warnOn ? $('#f-warn').value : '',
          photo: images.photo,
          injury: {
            active: injuryOn,
            types: [...selected],
            other: $('#inj-other').value,
            photo: images.injury,
          },
        },
      });
      $('#add-dialog').close();
      toast(editingId ? 'Modifiche salvate ✔' : 'Giocatore aggiunto ✔');
      alertSnap = null; // le modifiche fatte da me non generano avvisi
      loadPlayers();
    } catch (err) {
      $('#add-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Calendario partite ----------
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const dayOf = (m) => { const [y, mo, d] = m.date.split('-').map(Number); return new Date(y, mo - 1, d); };
  // Senza orario la partita conta come giocata dalla fine di quel giorno
  const matchDate = (m) => {
    const [y, mo, d] = m.date.split('-').map(Number);
    const [hh, mm] = (m.time || '23:59').split(':').map(Number);
    return new Date(y, mo - 1, d, hh, mm);
  };
  const isPlayed = (m) => matchDate(m) <= new Date();
  const lineupOf = (m) => m.lineup || [];
  const matchTitle = (m) => (m.teamA ? m.teamA + ' vs ' : 'vs ') + m.opponent;
  const teamNames = (m) => ({ A: (m && m.teamA) || 'Noi', B: (m && m.opponent) || 'Avversario' });
  const counts = (s) => s === 'titolare' || s === 'subentrato'; // "a voto"
  const votoCount = (m) => lineupOf(m).filter((e) => counts(e.status)).length;
  const playerById = (id) => players.find((p) => p.id === id);
  const sortedPlayers = (arr) => [...arr].sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name, 'it'));

  function scoreOf(m) {
    if (m.scoreFor == null || m.scoreAgainst == null) return null;
    const cls = m.scoreFor > m.scoreAgainst ? 'c-ok' : m.scoreFor < m.scoreAgainst ? 'c-bad' : 'c-warn';
    return { text: `${m.scoreFor} – ${m.scoreAgainst}`, cls };
  }

  // Statistiche di un giocatore: contano solo le partite già giocate
  function playerStats(id) {
    const s = { giocate: 0, voto: 0, titolare: 0, subentrato: 0, infortunio: 0, squalifica: 0, gol: 0, assist: 0, subiti: 0, gialli: 0, rossi: 0, salvataggi: 0, parati: 0, rigGol: 0, rigErr: 0, vinte: 0, perse: 0, pareggiate: 0 };
    const votes = [];
    const fvs = [];
    for (const m of matches) {
      if (!isPlayed(m)) continue;
      s.giocate++;
      const e = lineupOf(m).find((x) => x.playerId === id);
      if (!e) continue;
      // Vinte/perse/pareggiate: solo le partite a voto con il risultato inserito (conta la squadra del giocatore)
      if (counts(e.status) && m.scoreFor != null && m.scoreAgainst != null) {
        const mine = e.team === 'B' ? m.scoreAgainst : m.scoreFor;
        const theirs = e.team === 'B' ? m.scoreFor : m.scoreAgainst;
        if (mine > theirs) s.vinte++;
        else if (mine < theirs) s.perse++;
        else s.pareggiate++;
      }
      if (e.status === 'titolare') { s.voto++; s.titolare++; }
      else if (e.status === 'subentrato') { s.voto++; s.subentrato++; }
      else if (e.status === 'infortunato') s.infortunio++;
      else if (e.status === 'squalificato') s.squalifica++;
      if (counts(e.status)) {
        const ev = e.events || {};
        s.gol += (ev.goal || 0) + (ev.penaltyGoal || 0);
        s.assist += ev.assist || 0;
        s.subiti += ev.goalConceded || 0;
        s.gialli += ev.yellow || 0;
        s.salvataggi += ev.goalLineSave || 0;
        s.parati += ev.penaltySaved || 0;
        s.rigGol += ev.penaltyGoal || 0;
        s.rigErr += ev.penaltyMissed || 0;
        s.rossi += ev.red || 0;
        if (e.vote != null) votes.push(e.vote);
        const f = fantavoto(e);
        if (f != null) fvs.push(f);
      }
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    s.mediaVoto = avg(votes);
    s.fantamedia = avg(fvs);
    return s;
  }

  // Numero di giornata = posizione della partita in ordine di data (1, 2, 3…)
  const orderedMatches = () => [...matches].sort((a, b) => matchDate(a) - matchDate(b));
  const matchNo = (m) => orderedMatches().findIndex((x) => x.id === m.id) + 1;

  // Calendario personale del giocatore: un quadrato per giornata (almeno 38)
  function presenceGrid(p) {
    const ordered = orderedMatches();
    const total = Math.max(38, ordered.length);
    const squares = [];
    for (let i = 0; i < total; i++) {
      const m = ordered[i];
      let cls = 's-vuota';
      let label = m ? 'Da giocare' : 'Nessuna partita';
      if (m && isPlayed(m)) {
        const e = lineupOf(m).find((x) => x.playerId === p.id);
        const st = e && e.status;
        if (['titolare', 'subentrato', 'squalificato', 'infortunato'].includes(st)) { cls = 's-' + st; label = STATUSES[st]; }
        else { cls = 's-nogioco'; label = 'Non ha giocato'; }
      }
      const props = { class: 'sq ' + cls, text: String(i + 1), title: `Giornata ${i + 1}: ${label}` };
      if (m) { props.type = 'button'; props.onclick = () => openMatchDetail(m.id); }
      squares.push(h(m ? 'button' : 'span', props));
    }
    const legend = [
      ['s-titolare', 'Titolare'], ['s-subentrato', 'Subentrato'], ['s-squalificato', 'Squalificato'],
      ['s-infortunato', 'Infortunato'], ['s-nogioco', 'Non ha giocato'],
    ].map(([c, t]) => h('span', { class: 'lg' }, h('i', { class: 'dot ' + c }), t));
    return h('div', { class: 'box pres' },
      h('h4', { text: 'Presenze' }),
      h('div', { class: 'pres-grid' }, squares),
      h('div', { class: 'pres-legend' }, legend));
  }

  // Grafico a colonne: voto base e fantavoto per ogni partita in cui il giocatore è a voto
  function votesChart(p) {
    const pts = orderedMatches()
      .map((m, i) => ({ m, no: i + 1, e: lineupOf(m).find((x) => x.playerId === p.id) }))
      .filter((x) => isPlayed(x.m) && x.e && counts(x.e.status) && fantavoto(x.e) != null);
    const box = h('div', { class: 'box chart' }, h('h4', { text: 'Voti per partita' }));
    if (!pts.length) {
      box.append(h('p', { class: 'hint', text: 'Nessun voto inserito.' }));
      return box;
    }
    // scala fissa 0-10, si allarga solo se un fantavoto la supera
    const maxVal = Math.max(10, Math.ceil(Math.max(...pts.map((x) => Math.max(x.e.vote ?? 0, fantavoto(x.e))))));
    const bar = (value, cls) => h('div', {
      class: 'bar ' + cls,
      style: `height:${Math.max(0, Math.min(100, (value / maxVal) * 100))}%`,
    }, h('span', { class: 'bar-v', text: fmt(value) }));

    const cols = pts.map(({ m, no, e }) =>
      h('button', {
        type: 'button', class: 'chart-col',
        title: `Giornata ${no} vs ${m.opponent}: voto ${e.vote == null ? '—' : fmt(e.vote)}, fantavoto ${fmt(fantavoto(e))}`,
        onclick: () => openMatchDetail(m.id),
      },
        h('div', { class: 'chart-bars' }, e.vote != null ? bar(e.vote, 'b-vote') : null, bar(fantavoto(e), 'b-fv')),
        h('span', { class: 'chart-x', text: String(no) })));

    box.append(
      h('div', { class: 'chart-wrap' },
        h('div', { class: 'chart-y' },
          h('span', { text: fmt(maxVal) }), h('span', { text: fmt(maxVal / 2) }), h('span', { text: '0' })),
        h('div', { class: 'chart-scroll' }, h('div', { class: 'chart-cols' }, cols))),
      h('div', { class: 'pres-legend' },
        h('span', { class: 'lg' }, h('i', { class: 'dot b-vote' }), 'Voto base'),
        h('span', { class: 'lg' }, h('i', { class: 'dot b-fv' }), 'Fantavoto')));
    return box;
  }

  async function loadMatches() {
    try {
      matches = await api('/matches');
      snapEvents(matches);
      renderCalendar();
    } catch (err) { toast(err.message); }
  }

  function setTab(t) {
    tab = t;
    for (const [key, view, btn] of [
      ['profile', '#view-profile', '#tab-profile'],
      ['players', '#view-players', '#tab-players'],
      ['cal', '#view-cal', '#tab-cal'],
      ['rank', '#view-rank', '#tab-rank'],
    ]) {
      $(view).classList.toggle('hidden', t !== key);
      $(btn).classList.toggle('on', t === key);
      $(btn).setAttribute('aria-selected', t === key ? 'true' : 'false');
    }
    $('#fab').classList.toggle('hidden', t === 'settings' || t === 'rank' || t === 'profile' || !isAdmin);
    $('#fab').setAttribute('aria-label', t === 'players' ? 'Aggiungi giocatore' : 'Aggiungi partita');
  }
  $('#tab-profile').addEventListener('click', () => { setTab('profile'); renderProfile(); });
  $('#tab-players').addEventListener('click', () => setTab('players'));
  $('#tab-cal').addEventListener('click', () => setTab('cal'));
  $('#tab-rank').addEventListener('click', () => { setTab('rank'); renderRank(); });

  function matchCard(m) {
    const played = isPlayed(m);
    const d = dayOf(m);
    const res = scoreOf(m);
    const sub = ['Giornata ' + matchNo(m), d.toLocaleDateString('it-IT', { weekday: 'long' }), m.time, m.venue].filter(Boolean).join(' · ');
    // partita giocata: si apre il campo con le formazioni; da lì si arriva ai dettagli
    return h('button', { class: 'card', onclick: () => (played ? openFormation(m.id) : openMatchDetail(m.id)) },
      h('div', { class: 'mdate' },
        h('b', { text: String(d.getDate()) }),
        h('span', { text: d.toLocaleDateString('it-IT', { month: 'short' }) })),
      h('div', { class: 'card-body' },
        h('h3', { text: matchTitle(m) }),
        h('p', { text: sub }),
        h('div', { class: 'badges' },
          h('span', { class: 'badge ' + (played ? 'ok' : 'warn'), text: played ? '✔ Giocata' : '⏳ Da giocare' }),
          h('span', { class: 'badge neutral', text: played ? `👥 ${votoCount(m)} a voto` : `👥 ${lineupOf(m).length} in lista` }))),
      res ? h('div', { class: 'mscore ' + res.cls, text: res.text }) : null);
  }

  function renderCalendar() {
    const played = matches.filter(isPlayed).sort((a, b) => matchDate(b) - matchDate(a));
    const upcoming = matches.filter((m) => !isPlayed(m)).sort((a, b) => matchDate(a) - matchDate(b));
    $('#cal-empty').classList.toggle('hidden', matches.length > 0);
    $('#cal-summary').classList.toggle('hidden', matches.length === 0);
    $('#cal-summary').replaceChildren(
      stat(played.length, 'Giocate'),
      stat(upcoming.length, 'Da giocare'),
      stat(matches.length, 'Totali'));
    const list = $('#cal-list');
    list.replaceChildren();
    const section = (title, arr) => {
      if (!arr.length) return;
      list.append(h('h3', { class: 'cal-h', text: title }));
      arr.forEach((m) => list.append(matchCard(m)));
    };
    section('Prossime partite', upcoming);
    section('Partite giocate', played);
    renderRank();
    renderProfile();
  }

  // Riga giocatore con menu della presenza (usata nel form e nel dettaglio partita).
  // Nel dettaglio, per chi è a voto, compare anche il pulsante del voto/fantavoto.
  function presenceRow(p, status, onChange, disabled, entry, onVote, team, onTeam, names) {
    const sel = h('select', {
      class: 'st-select' + (status ? ' st-' + status : ''),
      'aria-label': 'Presenza di ' + p.name,
      onchange: (e) => {
        sel.className = 'st-select' + (e.target.value ? ' st-' + e.target.value : '');
        onChange(e.target.value);
      },
    },
      h('option', { value: '', text: 'Non convocato' }),
      ...Object.entries(STATUSES).map(([k, v]) => h('option', { value: k, text: v })));
    sel.value = status || '';
    sel.disabled = !!disabled;
    const inj = activeInjury(p);
    const aVoto = !!entry && counts(status);
    const fv = aVoto ? fantavoto(entry) : null;
    const info = [p.role && ROLES[p.role], inj ? '🩹 infortunato' : '', aVoto ? eventsSummary(entry.events) : '']
      .filter(Boolean).join(' · ');
    let pill = null;
    if (aVoto && onVote) {
      pill = h('button', {
        type: 'button', class: 'vote-pill' + (fv !== null ? ' has' : ''),
        'aria-label': 'Voto di ' + p.name,
        text: fv !== null ? 'FV ' + fmt(fv) : '＋ Voto',
        onclick: onVote,
      });
    } else if (fv !== null) {
      pill = h('span', { class: 'vote-pill has', text: 'FV ' + fmt(fv) });
    }
    // Selettore squadra: compare per chi è convocato in questa partita
    const teamBox = onTeam && status
      ? h('div', { class: 'team-seg', role: 'group', 'aria-label': 'Squadra di ' + p.name },
          ...['A', 'B'].map((t) => h('button', {
            type: 'button',
            class: 'team-btn team-' + t + (team === t ? ' on' : ''),
            'aria-pressed': team === t ? 'true' : 'false',
            title: names[t],
            text: names[t],
            ...(disabled ? { disabled: '' } : {}),
            onclick: () => { if (team !== t) onTeam(t); },
          })))
      : null;
    return h('div', { class: 'lp-row' },
      h('div', { class: 'lp-av' + roleClass(p) }, avatar(p, 'avatar sm')),
      h('div', { class: 'lp-info' },
        h('b', { text: p.name }),
        info ? h('small', { text: info }) : null,
        pill,
        teamBox),
      sel);
  }

  // ---------- Form partita ----------
  function renderVenue() {
    $('#m-venue').replaceChildren(
      ...['Casa', 'Trasferta'].map((v) =>
        h('button', {
          type: 'button',
          class: 'seg-btn' + (matchVenue === v ? ' on' : ''),
          'aria-pressed': matchVenue === v ? 'true' : 'false',
          text: (v === 'Casa' ? '🏠 ' : '✈️ ') + v,
          onclick: () => { matchVenue = matchVenue === v ? '' : v; renderVenue(); },
        })));
  }

  function updateLineupCount() {
    const n = lineupDraft.size;
    const voto = [...lineupDraft.values()].filter(counts).length;
    $('#m-count').textContent = n ? `${n} giocatori inseriti · ${voto} a voto` : 'Nessun giocatore inserito';
  }

  function renderLineupForm() {
    const q = $('#m-search').value.trim().toLowerCase();
    const wrap = $('#m-lineup');
    wrap.replaceChildren();
    if (!players.length) {
      wrap.append(h('p', { class: 'hint', text: 'Nessun giocatore in lista: aggiungili prima dalla scheda Giocatori.' }));
      return;
    }
    const names = { A: $('#m-teamA').value.trim() || 'Squadra 1', B: $('#m-opp').value.trim() || 'Squadra 2' };
    $('#m-for-lbl').textContent = names.A;
    $('#m-against-lbl').textContent = names.B;
    const teamOf = (id) => (lineupTeam.get(id) === 'B' ? 'B' : 'A');
    const match = (p) => p.name.toLowerCase().includes(q);
    const all = sortedPlayers(players);
    const rerender = () => { updateLineupCount(); renderLineupForm(); };
    for (const t of ['A', 'B']) {
      const inTeam = all.filter((p) => lineupDraft.has(p.id) && teamOf(p.id) === t);
      const shown = inTeam.filter(match);
      const available = all.filter((p) => !lineupDraft.has(p.id) && match(p));
      wrap.append(h('div', { class: 'team-sec' },
        h('h4', { class: 'sec-h team-h team-h-' + t, text: `${t === 'A' ? '🔵' : '🔴'} ${names[t]} · ${inTeam.length}` }),
        shown.length
          ? h('div', { class: 'lineup' }, shown.map((p) => presenceRow(p, lineupDraft.get(p.id), (v) => {
              if (v) lineupDraft.set(p.id, v);
              else { lineupDraft.delete(p.id); lineupTeam.delete(p.id); }
              rerender();
            }, false, null, null, t, (nt) => { lineupTeam.set(p.id, nt); rerender(); }, names)))
          : h('p', { class: 'hint', text: 'Nessun giocatore.' }),
        available.length
          ? h('select', {
              class: 'st-select lp-add',
              'aria-label': 'Aggiungi giocatore a ' + names[t],
              onchange: (ev) => {
                const p = playerById(ev.target.value);
                if (p) { lineupDraft.set(p.id, 'titolare'); lineupTeam.set(p.id, t); rerender(); }
              },
            },
              h('option', { value: '', text: `＋ Aggiungi a ${names[t]}…` }),
              ...available.map((p) => h('option', { value: p.id, text: p.name + (p.role ? ` (${p.role})` : '') + (activeInjury(p) ? ' 🩹' : '') })))
          : null));
    }
  }
  $('#m-search').addEventListener('input', renderLineupForm);
  $('#m-teamA').addEventListener('input', renderLineupForm);
  $('#m-opp').addEventListener('input', renderLineupForm); // il nome dell'avversario compare sul selettore squadra

  function openMatchForm(m) {
    $('#match-form').reset();
    editingMatchId = m ? m.id : null;
    lineupDraft.clear();
    lineupData.clear();
    lineupTeam.clear();
    $('#match-title').textContent = m ? 'Modifica partita' : 'Nuova partita';
    $('#match-submit').textContent = m ? 'Salva modifiche' : 'Salva partita';
    $('#match-error').textContent = '';
    matchVenue = m ? (m.venue || '') : '';
    $('#m-size').value = String((m && m.teamSize) || 11);
    if (m) {
      $('#m-date').value = m.date;
      $('#m-time').value = m.time || '';
      $('#m-opp').value = m.opponent;
      $('#m-teamA').value = m.teamA || '';
      $('#m-for').value = m.scoreFor ?? '';
      $('#m-against').value = m.scoreAgainst ?? '';
      $('#m-notes').value = m.notes || '';
      lineupOf(m).forEach((e) => { lineupDraft.set(e.playerId, e.status); lineupData.set(e.playerId, e); lineupTeam.set(e.playerId, e.team === 'B' ? 'B' : 'A'); });
    } else {
      $('#m-date').value = todayStr();
    }
    renderVenue();
    renderLineupForm();
    updateLineupCount();
    $('#match-dialog').showModal();
  }

  $('#match-close').addEventListener('click', () => $('#match-dialog').close());

  $('#match-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#match-submit');
    btn.disabled = true;
    $('#match-error').textContent = '';
    const wasEditing = editingMatchId;
    try {
      const saved = await api(wasEditing ? '/matches/' + wasEditing : '/matches', {
        method: wasEditing ? 'PUT' : 'POST',
        body: {
          date: $('#m-date').value,
          time: $('#m-time').value,
          opponent: $('#m-opp').value,
          teamA: $('#m-teamA').value,
          venue: matchVenue,
          scoreFor: $('#m-for').value,
          scoreAgainst: $('#m-against').value,
          notes: $('#m-notes').value,
          teamSize: $('#m-size').value,
          lineup: [...lineupDraft].map(([playerId, status]) => {
            const old = lineupData.get(playerId) || {};
            const team = lineupTeam.get(playerId) || 'A';
            // se il giocatore cambia squadra, la posizione sul campo non vale più
            return { ...old, playerId, status, team, pos: old.team && (old.team === 'B' ? 'B' : 'A') !== team ? null : old.pos || null };
          }),
        },
      });
      $('#match-dialog').close();
      toast(wasEditing ? 'Partita aggiornata ✔' : 'Partita aggiunta ✔');
      await loadMatches();
      if (wasEditing) openMatchDetail(saved.id);
    } catch (err) {
      $('#match-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Dettaglio partita + modifica presenze ----------
  function matchBody(m, lineup) {
    return {
      date: m.date, time: m.time || '', opponent: m.opponent, teamA: m.teamA || '', venue: m.venue || '', teamSize: m.teamSize || 11,
      scoreFor: m.scoreFor ?? '', scoreAgainst: m.scoreAgainst ?? '',
      notes: m.notes || '', lineup,
    };
  }

  async function saveLineup(m, lineup, okMsg = 'Presenze aggiornate ✔') {
    try {
      const updated = await api('/matches/' + m.id, { method: 'PUT', body: matchBody(m, lineup) });
      const i = matches.findIndex((x) => x.id === updated.id);
      if (i >= 0) matches[i] = updated;
      snapEvents(matches);
      // se il server non restituisce le posizioni inviate, sta girando una versione vecchia di server.js
      const lost = lineup.some((e) => e.pos) && !(updated.lineup || []).some((e) => e.pos);
      toast(lost ? 'Il server non ha salvato le posizioni: sostituisci server.js e riavvia il server' : okMsg);
    } catch (err) { toast(err.message); }
    renderCalendar();
    renderMatchDetail();
    renderFormation();
  }

  function openMatchDetail(id) {
    openMatchId = id;
    renderMatchDetail();
    const dlg = $('#match-detail-dialog');
    if (!dlg.open) { dlg.scrollTop = 0; dlg.showModal(); }
  }

  function renderMatchDetail() {
    const dlg = $('#match-detail-dialog');
    const m = matches.find((x) => x.id === openMatchId);
    if (!m) { if (dlg.open) dlg.close(); return; }
    const mine = isAdmin && m.createdBy === me;
    const played = isPlayed(m);
    const res = scoreOf(m);
    const lineup = lineupOf(m).filter((e) => playerById(e.playerId));
    const n = (s) => lineup.filter((e) => e.status === s).length;
    const order = Object.keys(STATUSES);
    const rows = [...lineup].sort((a, b) => {
      const pa = playerById(a.playerId), pb = playerById(b.playerId);
      return order.indexOf(a.status) - order.indexOf(b.status)
        || (ROLE_ORDER[pa.role] ?? 9) - (ROLE_ORDER[pb.role] ?? 9)
        || pa.name.localeCompare(pb.name, 'it');
    });
    const inLineup = new Set(lineup.map((e) => e.playerId));
    const available = sortedPlayers(players.filter((p) => !inLineup.has(p.id)));
    const change = (p, v, team) => {
      const old = lineupOf(m).find((e) => e.playerId === p.id);
      const next = lineupOf(m).filter((e) => e.playerId !== p.id);
      if (v) next.push({ ...(old || {}), playerId: p.id, status: v, team: (old && old.team) || team || 'A' }); // conserva voto, bonus/malus e squadra
      saveLineup(m, next);
    };
    const changeTeam = (p, t) => saveLineup(m, lineupOf(m).map((e) => (e.playerId === p.id ? { ...e, team: t, pos: null } : e)));
    const names = teamNames(m);
    const teamOf = (e) => (e.team === 'B' ? 'B' : 'A');
    const teamSection = (t) => {
      const list = rows.filter((e) => teamOf(e) === t);
      return h('div', { class: 'team-sec' },
        h('h4', { class: 'sec-h team-h team-h-' + t, text: `${t === 'A' ? '🔵' : '🔴'} ${names[t]} · ${list.length}` }),
        list.length
          ? h('div', { class: 'lineup' }, list.map((e) => {
              const p = playerById(e.playerId);
              return presenceRow(p, e.status, (v) => change(p, v), !mine, e, mine ? () => openVote(m, p, e) : null, t, (nt) => changeTeam(p, nt), names);
            }))
          : h('p', { class: 'hint', text: 'Nessun giocatore.' }),
        mine && available.length
          ? h('select', {
              class: 'st-select lp-add',
              'aria-label': 'Aggiungi giocatore a ' + names[t],
              onchange: (ev) => { const p = playerById(ev.target.value); if (p) change(p, 'panchina', t); },
            },
              h('option', { value: '', text: `＋ Aggiungi a ${names[t]}…` }),
              ...available.map((p) => h('option', { value: p.id, text: p.name + (p.role ? ` (${p.role})` : '') + (activeInjury(p) ? ' 🩹' : '') })))
          : null);
    };

    $('#match-detail').replaceChildren(...[
      h('div', { class: 'sheet-head' },
        h('h2', { text: matchTitle(m) }),
        h('div', { class: 'head-actions' },
          played ? h('button', { type: 'button', class: 'icon-btn', text: '⚽ Campo', onclick: () => { dlg.close(); openFormation(m.id); } }) : null,
          mine ? h('button', { type: 'button', class: 'icon-btn', text: '✎ Modifica', onclick: () => { dlg.close(); openMatchForm(m); } }) : null,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', text: '✕', onclick: () => dlg.close() }))),

      row('Giornata', String(matchNo(m))),
      row('Data', dayOf(m).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
      m.time ? row('Ora', m.time) : null,
      m.venue ? row('Dove', m.venue) : null,
      row('Stato', played ? 'Giocata' : 'Da giocare', played ? 'c-ok' : 'c-warn'),
      res ? row('Risultato', res.text, res.cls) : null,
      row('Aggiunta da', m.createdBy),

      h('div', { class: 'm-stats' },
        stat(n('titolare'), 'Titolari'),
        stat(n('subentrato'), 'Subentrati'),
        stat(n('panchina'), 'Panchina'),
        stat(n('infortunato'), 'Infortunati'),
        stat(n('squalificato'), 'Squalificati'),
        stat(n('assente'), 'Assenti')),

      m.notes ? h('div', { class: 'box' }, h('h4', { text: 'Note' }), h('p', { text: m.notes })) : null,

      h('h4', { class: 'sec-h', text: 'Presenze' }),
      h('p', { class: 'hint', text: mine
        ? 'Assegna ogni giocatore a una delle due squadre con i pulsanti sotto il nome. Cambia lo stato (es. da panchina a subentrato, o fuori per infortunio): si salva subito. Per chi è a voto (titolari e subentrati) tocca “Voto” per inserire voto, bonus e malus.'
        : 'A voto: titolari e subentrati. FV = fantavoto (voto + bonus − malus).' }),
      teamSection('A'),
      teamSection('B'),

      mine
        ? h('button', {
            type: 'button', class: 'btn danger', text: 'Elimina partita',
            onclick: async () => {
              if (!confirm(`Eliminare la partita contro ${m.opponent}?`)) return;
              try {
                await api('/matches/' + m.id, { method: 'DELETE' });
                dlg.close();
                toast('Partita eliminata');
                loadMatches();
              } catch (err) { toast(err.message); }
            },
          })
        : null].filter(Boolean)); // senza filtro i campi assenti comparivano come "null"
  }

  // ---------- Bonus / malus e fantavoto ----------
  // I bonus si sommano, i malus si sottraggono: i valori (sempre >= 0) si cambiano da Impostazioni
  const EVENT_DEFS = [
    { key: 'goal', label: 'Gol segnato', icon: '⚽', group: 'bonus', max: 20 },
    { key: 'penaltyGoal', label: 'Rigore segnato', icon: '🎯', group: 'bonus', max: 20 },
    { key: 'assist', label: 'Assist', icon: '🅰️', group: 'bonus', max: 20 },
    { key: 'mvp', label: 'MVP', icon: '⭐', group: 'bonus', max: 1 },
    { key: 'penaltySaved', label: 'Rigore parato', icon: '🧤', group: 'bonus', max: 20 },
    { key: 'cleanSheet', label: 'Clean sheet', icon: '🛡️', group: 'bonus', max: 1 },
    { key: 'goalLineSave', label: 'Salvataggio sulla linea', icon: '🚧', group: 'bonus', max: 20 },
    { key: 'ownGoal', label: 'Autogol', icon: '😬', group: 'malus', max: 20 },
    { key: 'goalConceded', label: 'Gol subito', icon: '🥅', group: 'malus', max: 20 },
    { key: 'penaltyMissed', label: 'Rigore sbagliato', icon: '❌', group: 'malus', max: 20 },
    { key: 'yellow', label: 'Ammonizione', icon: '🟨', group: 'malus', max: 1 },
    { key: 'red', label: 'Espulsione', icon: '🟥', group: 'malus', max: 1 },
  ];
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  const bonusTotal = (events) => round2(EVENT_DEFS.reduce((t, d) =>
    t + (d.group === 'bonus' ? 1 : -1) * ((events && events[d.key]) || 0) * (settings[d.key] ?? 0), 0));
  // fantavoto = voto + bonus - malus (solo per chi è a voto e ha un voto inserito)
  const fantavoto = (e) => {
    if (!e || !counts(e.status)) return null;
    if (e.fv != null) return e.fv;
    return e.vote != null ? round2(e.vote + bonusTotal(e.events)) : null;
  };
  const eventsSummary = (events) => EVENT_DEFS
    .filter((d) => events && events[d.key])
    .map((d) => d.icon + (events[d.key] > 1 ? '×' + events[d.key] : ''))
    .join(' ');

  async function loadSettings() {
    try {
      const r = await api('/settings');
      settings = r.values;
      settingsDefaults = r.defaults;
      renderSettings();
      renderCalendar();
    } catch (err) { toast(err.message); }
  }

  // ---------- Impostazioni ----------
  function renderSettings() {
    const wrap = $('#settings-form');
    wrap.replaceChildren();
    $('#settings-save').classList.toggle('hidden', !isAdmin);
    $('#settings-reset').classList.toggle('hidden', !isAdmin);
    for (const [group, title] of [['bonus', 'Bonus (si sommano al voto)'], ['malus', 'Malus (si sottraggono dal voto)']]) {
      wrap.append(h('h3', { class: 'cal-h', text: title }));
      for (const d of EVENT_DEFS.filter((x) => x.group === group)) {
        wrap.append(h('label', { class: 'set-row' },
          h('span', { class: 'sign ' + (group === 'bonus' ? 'plus' : 'minus'), text: group === 'bonus' ? '+' : '−' }),
          h('span', { class: 'set-name', text: `${d.icon} ${d.label}` }),
          h('input', { type: 'number', step: '0.5', min: '0', max: '50', inputmode: 'decimal', 'data-key': d.key, value: String(settings[d.key] ?? 0), ...(isAdmin ? {} : { disabled: '' }) })));
      }
    }
  }

  $('#settings-save').addEventListener('click', async () => {
    const btn = $('#settings-save');
    const values = {};
    $('#settings-form').querySelectorAll('input[data-key]').forEach((i) => { values[i.dataset.key] = i.value; });
    btn.disabled = true;
    $('#settings-error').textContent = '';
    try {
      const r = await api('/settings', { method: 'PUT', body: { values } });
      settings = r.values;
      renderSettings();
      renderCalendar();
      toast('Impostazioni salvate ✔');
    } catch (err) {
      $('#settings-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Rimette i valori predefiniti nei campi: diventano effettivi solo dopo "Salva"
  $('#settings-reset').addEventListener('click', () => {
    $('#settings-form').querySelectorAll('input[data-key]').forEach((i) => { i.value = String(settingsDefaults[i.dataset.key] ?? 0); });
    toast('Valori predefiniti caricati: premi Salva');
  });

  // ---------- Voto + bonus/malus di un giocatore in una partita ----------
  function stepperRow(d, onChange) {
    const val = h('b', { class: 'step-val', text: String(voteCtx.events[d.key] || 0) });
    const set = (n) => {
      n = Math.max(0, Math.min(d.max, n));
      if (n) voteCtx.events[d.key] = n; else delete voteCtx.events[d.key];
      val.textContent = String(n);
      onChange();
    };
    return h('div', { class: 'step-row' },
      h('span', { class: 'step-label', text: `${d.icon} ${d.label}` }),
      h('small', { class: 'step-pts ' + d.group, text: (d.group === 'bonus' ? '+' : '−') + fmt(settings[d.key] ?? 0) }),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'Meno: ' + d.label, text: '−', onclick: () => set((voteCtx.events[d.key] || 0) - 1) }),
        val,
        h('button', { type: 'button', 'aria-label': 'Più: ' + d.label, text: '+', onclick: () => set((voteCtx.events[d.key] || 0) + 1) })));
  }

  function openVote(m, p, entry) {
    voteCtx = {
      matchId: m.id,
      player: p,
      vote: entry && entry.vote != null ? String(entry.vote) : '',
      fv: entry && entry.fv != null ? String(entry.fv) : '',
      fvManual: !!(entry && entry.fv != null),
      events: { ...((entry && entry.events) || {}) },
    };
    renderVote(m);
    $('#vote-dialog').showModal();
  }

  function renderVote(m) {
    const p = voteCtx.player;
    const error = h('p', { class: 'error', role: 'alert' });
    const parsedVote = () => (voteCtx.vote === '' ? null : Number(voteCtx.vote));
    const autoFv = () => {
      const v = parsedVote();
      return v === null || !Number.isFinite(v) ? '' : String(round2(v + bonusTotal(voteCtx.events)));
    };
    // Il fantavoto si ricalcola da solo finché non lo scrivi tu; svuotando il campo torna automatico
    const fvInput = h('input', {
      type: 'number', step: '0.5', min: '-50', max: '100', inputmode: 'decimal', placeholder: '—',
      'aria-label': 'Fantavoto', value: voteCtx.fvManual ? voteCtx.fv : '',
      oninput: (e) => { if (e.target.value !== '') { voteCtx.fvManual = true; voteCtx.fv = e.target.value; } },
      onchange: (e) => { if (e.target.value === '') { voteCtx.fvManual = false; voteCtx.fv = ''; updatePreview(); } },
    });
    const updatePreview = () => { if (!voteCtx.fvManual) fvInput.value = autoFv(); };
    const input = h('input', {
      type: 'number', step: '0.5', min: '0', max: '10', inputmode: 'decimal', placeholder: 'Es. 6.5', value: voteCtx.vote,
      oninput: (e) => { voteCtx.vote = e.target.value; updatePreview(); },
    });

    const save = async (clear) => {
      let vote = parsedVote();
      if (!clear && vote !== null && (!Number.isFinite(vote) || vote < 0 || vote > 10)) {
        error.textContent = 'Il voto deve essere tra 0 e 10';
        return;
      }
      let fv = voteCtx.fvManual ? Number(voteCtx.fv) : null;
      if (!clear && fv !== null && (!Number.isFinite(fv) || fv < -50 || fv > 100)) {
        error.textContent = 'Il fantavoto deve essere tra -50 e 100';
        return;
      }
      const fresh = matches.find((x) => x.id === voteCtx.matchId);
      if (!fresh) return $('#vote-dialog').close();
      const events = clear ? {} : voteCtx.events;
      if (clear) { vote = null; fv = null; }
      const next = lineupOf(fresh).map((e) => (e.playerId === p.id ? { ...e, vote, fv, events } : e));
      $('#vote-dialog').close();
      await saveLineup(fresh, next);
    };

    $('#vote-body').replaceChildren(
      h('div', { class: 'sheet-head' },
        h('div', { class: 'vote-head' },
          h('div', { class: 'lp-av' + roleClass(p) }, avatar(p, 'avatar sm')),
          h('div', {},
            h('h2', { text: p.name }),
            h('small', { text: `vs ${m.opponent} · ${dayOf(m).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}` }))),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', text: '✕', onclick: () => $('#vote-dialog').close() })),

      h('label', {}, 'Voto (0–10)', input),
      h('div', { class: 'fv-preview' }, h('span', { text: 'Fantavoto' }), fvInput),
      h('p', { class: 'hint', text: 'Si calcola da solo (voto + bonus − malus). Scrivi un valore per sostituirlo; svuota il campo per tornare al calcolo automatico.' }),

      h('h4', { class: 'sec-h', text: 'Bonus' }),
      ...EVENT_DEFS.filter((d) => d.group === 'bonus').map((d) => stepperRow(d, updatePreview)),
      h('h4', { class: 'sec-h', text: 'Malus' }),
      ...EVENT_DEFS.filter((d) => d.group === 'malus').map((d) => stepperRow(d, updatePreview)),

      error,
      h('button', { type: 'button', class: 'btn primary', text: 'Salva voto', onclick: () => save(false) }),
      h('button', { type: 'button', class: 'btn danger', text: 'Rimuovi voto e bonus/malus', onclick: () => save(true) }));
    updatePreview();
  }

  // ---------- Formazioni in campo ----------
  // Selettore "giocatori per squadra" (5-11) del form partita
  for (let n = 5; n <= 11; n++) $('#m-size').append(h('option', { value: String(n), text: `${n} vs ${n}` }));

  let formationId = null;
  let fPos = new Map(); // playerId -> {x,y}: posizioni spostate ma non ancora salvate
  let fShown = new Map(); // playerId -> {x,y}: posizioni attualmente mostrate sul campo
  let fDirty = false;
  let fDrag = false;
  const Y_RANGE = { A: [6, 46], B: [54, 94] }; // la squadra 1 gioca nella metà alta, la 2 nella metà bassa
  const clampPos = (team, x, y) => ({
    x: Math.round(Math.min(93, Math.max(7, x)) * 100) / 100,
    y: Math.round(Math.min(Y_RANGE[team][1], Math.max(Y_RANGE[team][0], y)) * 100) / 100,
  });
  const teamOfEntry = (e) => (e.team === 'B' ? 'B' : 'A');

  // Modalità griglia: celle quadrate (12 colonne), le posizioni si agganciano agli incroci
  const GRID_SX = 100 / 12;
  const GRID_SY = 100 / (12 * 2.8); // il campo ha proporzioni 100:280
  let fGrid = false;
  try { fGrid = localStorage.getItem('fanta-grid') === '1'; } catch { /* ignora */ }
  function snapPos(team, x, y) {
    const [lo, hi] = Y_RANGE[team];
    const kx = Math.min(Math.floor(93 / GRID_SX), Math.max(Math.ceil(7 / GRID_SX), Math.round(x / GRID_SX)));
    const ky = Math.min(Math.floor(hi / GRID_SY), Math.max(Math.ceil(lo / GRID_SY), Math.round(y / GRID_SY)));
    return { x: Math.round(kx * GRID_SX * 100) / 100, y: Math.round(ky * GRID_SY * 100) / 100 };
  }
  function toggleGrid() {
    fGrid = !fGrid;
    try { localStorage.setItem('fanta-grid', fGrid ? '1' : '0'); } catch { /* ignora */ }
    const m = matches.find((x) => x.id === formationId);
    // accendendo la griglia, chi può modificare allinea subito tutti i giocatori in campo
    if (fGrid && m && isAdmin && m.createdBy === me) {
      for (const e of lineupOf(m)) {
        const cur = fShown.get(e.playerId);
        if (!cur) continue;
        const np = snapPos(teamOfEntry(e), cur.x, cur.y);
        if (np.x !== cur.x || np.y !== cur.y) { fPos.set(e.playerId, np); fDirty = true; }
      }
    }
    renderFormationInto();
  }

  // Titolari di una squadra che stanno in campo (al massimo "giocatori per squadra")
  function pitchEntries(m, t) {
    return lineupOf(m)
      .filter((e) => e.status === 'titolare' && teamOfEntry(e) === t && playerById(e.playerId))
      .sort((a, b) => {
        const pa = playerById(a.playerId), pb = playerById(b.playerId);
        return (ROLE_ORDER[pa.role] ?? 9) - (ROLE_ORDER[pb.role] ?? 9) || pa.name.localeCompare(pb.name, 'it');
      });
  }

  // Schieramento automatico: una riga per ruolo (portiere → attaccanti), verso il centrocampo
  function autoPositions(t, entries) {
    const rows = { P: [], D: [], C: [], A: [] };
    for (const e of entries) rows[playerById(e.playerId).role || 'C'].push(e);
    const used = Object.keys(rows).filter((k) => rows[k].length);
    const [y0, y1] = Y_RANGE[t];
    const out = new Map();
    used.forEach((k, ri) => {
      const frac = used.length === 1 ? 0.5 : ri / (used.length - 1);
      const y = t === 'A' ? y0 + frac * (y1 - y0) : y1 - frac * (y1 - y0);
      rows[k].forEach((e, i) => out.set(e.playerId, { x: ((i + 1) / (rows[k].length + 1)) * 100, y }));
    });
    return out;
  }

  // Ritaglio del personaggio: toglie lo sfondo uniforme della foto (colore preso dagli angoli)
  // e taglia i margini vuoti. Se lo sfondo non è uniforme, la foto resta com'è.
  const cutCache = new Map();
  function cutout(url) {
    if (cutCache.has(url)) return cutCache.get(url);
    const prom = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, 360 / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * sc));
          const ht = Math.max(1, Math.round(img.height * sc));
          const c = document.createElement('canvas');
          c.width = w; c.height = ht;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, ht);
          const data = ctx.getImageData(0, 0, w, ht);
          const px = data.data;
          const corners = [0, (w - 1) * 4, (ht - 1) * w * 4, ((ht - 1) * w + w - 1) * 4];
          // PNG già con sfondo trasparente: si salta la rimozione dello sfondo, ma il ritaglio sul
          // personaggio (che toglie il nome scritto sulla foto) vale comunque
          const alreadyTransparent = corners.some((i) => px[i + 3] < 200);
          if (!alreadyTransparent) {
          const bg = [0, 1, 2].map((k) => corners.reduce((s, i) => s + px[i + k], 0) / 4);
          const dist = (i) => Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
          if (Math.max(...corners.map(dist)) > 40) return resolve(url); // sfondo non uniforme
          const HARD = 28, SOFT = 60;
          const seen = new Uint8Array(w * ht);
          const stack = [];
          const push = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= ht) return;
            const k = y * w + x;
            if (seen[k] || dist(k * 4) >= SOFT) return;
            seen[k] = 1;
            stack.push(k);
          };
          for (let x = 0; x < w; x++) { push(x, 0); push(x, ht - 1); }
          for (let y = 0; y < ht; y++) { push(0, y); push(w - 1, y); }
          while (stack.length) {
            const k = stack.pop();
            const x = k % w, y = (k - x) / w;
            push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
          }
          for (let k = 0; k < w * ht; k++) {
            if (seen[k]) {
              const d = dist(k * 4);
              px[k * 4 + 3] = d <= HARD ? 0 : Math.round((255 * (d - HARD)) / (SOFT - HARD));
            }
          }
          }
          // Il nome scritto sulla foto è fatto di pezzi staccati dal personaggio: si cerca il
          // pezzo connesso più grande (il personaggio) e si ritaglia sul suo ingombro, così il testo sparisce.
          const lab = new Uint8Array(w * ht);
          let main = null;
          for (let s = 0; s < w * ht; s++) {
            if (lab[s] || px[s * 4 + 3] <= 40) continue;
            const comp = { n: 0, x0: w, y0: ht, x1: -1, y1: -1 };
            const st = [s];
            lab[s] = 1;
            while (st.length) {
              const k = st.pop();
              const x = k % w, y = (k - x) / w;
              comp.n++;
              if (x < comp.x0) comp.x0 = x;
              if (x > comp.x1) comp.x1 = x;
              if (y < comp.y0) comp.y0 = y;
              if (y > comp.y1) comp.y1 = y;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const nx = x + dx, ny = y + dy;
                  if (nx < 0 || ny < 0 || nx >= w || ny >= ht) continue;
                  const nk = ny * w + nx;
                  if (!lab[nk] && px[nk * 4 + 3] > 40) { lab[nk] = 1; st.push(nk); }
                }
              }
            }
            if (!main || comp.n > main.n) main = comp;
          }
          if (!main) return resolve(url);
          const { x0, y0, x1, y1 } = main;
          ctx.putImageData(data, 0, 0);
          const out = document.createElement('canvas');
          out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
          out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
          resolve(out.toDataURL('image/png'));
        } catch { resolve(url); }
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
    cutCache.set(url, prom);
    return prom;
  }
  // Solo il personaggio, senza cerchio né sfondo (senza foto: iniziali nel cerchio)
  function cutAvatar(p) {
    if (!p.photo) return avatar(p, 'avatar pt');
    const img = h('img', { class: 'pt-cut', alt: p.name, draggable: 'false' });
    img.style.opacity = '0';
    cutout(p.photo).then((u) => { img.src = u; img.style.opacity = ''; });
    return img;
  }

  function pitchToken(e, t, pos, pitch, canEdit) {
    const p = playerById(e.playerId);
    const ev = e.events || {};
    const goals = (ev.goal || 0) + (ev.penaltyGoal || 0);
    const fv = fantavoto(e);
    const badges = [];
    // un'emoji per ogni bonus/malus: se si ripete, le emoji si impilano una sopra l'altra
    const stack = (icon, n, cls) => { for (let i = 0; i < n; i++) badges.push(h('span', { class: 'pt-b' + (cls ? ' ' + cls : ''), text: icon })); };
    stack('⚽', goals);
    stack('👟', ev.assist || 0, 'shoe'); // scarpa grigia = assist
    stack('⭐', ev.mvp || 0);
    stack('🧤', ev.penaltySaved || 0);
    stack('🛡️', ev.cleanSheet || 0);
    stack('🚧', ev.goalLineSave || 0);
    stack('🟨', ev.yellow || 0);
    stack('🟥', ev.red || 0);
    stack('😬', ev.ownGoal || 0);
    stack('🥅', ev.goalConceded || 0);
    stack('❌', ev.penaltyMissed || 0);
    const el = h('div', {
      class: 'p-token team-' + t + (canEdit ? ' drag' : ''),
      style: `left:${pos.x}%;top:${pos.y}%`,
      title: p.name,
    },
      h('div', { class: 'pt-av' + roleClass(p) }, cutAvatar(p), badges.length ? h('div', { class: 'pt-badges' }, badges) : null),
      h('div', { class: 'pt-pill' },
        h('span', { text: e.vote == null ? '–' : fmt(e.vote) }),
        h('b', { text: fv == null ? '–' : fmt(fv) })),
      h('span', { class: 'pt-name', text: p.name }));

    if (canEdit) {
      el.addEventListener('pointerdown', (ev2) => {
        if (ev2.button > 0) return;
        ev2.preventDefault();
        fDrag = true;
        el.setPointerCapture(ev2.pointerId);
        el.classList.add('dragging');
      });
      el.addEventListener('pointermove', (ev2) => {
        if (!el.hasPointerCapture(ev2.pointerId)) return;
        const r = pitch.getBoundingClientRect();
        const rx = ((ev2.clientX - r.left) / r.width) * 100, ry = ((ev2.clientY - r.top) / r.height) * 100;
        const np = fGrid ? snapPos(t, rx, ry) : clampPos(t, rx, ry);
        el.style.left = np.x + '%';
        el.style.top = np.y + '%';
        fPos.set(e.playerId, np);
        fShown.set(e.playerId, np);
        fDirty = true;
      });
      const end = () => {
        fDrag = false;
        el.classList.remove('dragging');
        const b = $('#f-save');
        if (b) b.classList.toggle('hidden', !fDirty);
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    return el;
  }

  function openFormation(id) {
    formationId = id;
    fPos = new Map();
    fDirty = false;
    fDrag = false;
    const dlg = $('#formation-dialog');
    renderFormationInto(true);
    if (!dlg.open) { dlg.scrollTop = 0; dlg.showModal(); }
  }
  function renderFormation() { if ($('#formation-dialog').open) renderFormationInto(false); }

  function renderFormationInto() {
    const dlg = $('#formation-dialog');
    const m = matches.find((x) => x.id === formationId);
    if (!m) { if (dlg.open) dlg.close(); return; }
    const mine = isAdmin && m.createdBy === me;
    const names = teamNames(m);
    const size = m.teamSize || 11;
    const res = scoreOf(m);
    const total = (t) => round2(lineupOf(m)
      .filter((e) => counts(e.status) && teamOfEntry(e) === t && playerById(e.playerId))
      .reduce((s, e) => s + (fantavoto(e) ?? 0), 0));
    const hasFv = lineupOf(m).some((e) => counts(e.status) && fantavoto(e) != null);

    const pitch = h('div', { class: 'pitch' },
      fGrid ? h('div', { class: 'pitch-grid' }) : null,
      h('div', { class: 'pl pl-mid' }), h('div', { class: 'pl pl-circle' }),
      h('div', { class: 'pl pl-box pl-box-top' }), h('div', { class: 'pl pl-box pl-box-bot' }),
      h('div', { class: 'pl pl-six pl-six-top' }), h('div', { class: 'pl pl-six pl-six-bot' }));

    fShown = new Map();
    const bench = { A: [], B: [] };
    const onPitchCount = { A: 0, B: 0 };
    for (const t of ['A', 'B']) {
      const all = pitchEntries(m, t);
      const on = all.slice(0, size);
      onPitchCount[t] = all.length;
      const auto = autoPositions(t, on);
      for (const e of on) {
        const raw = fPos.get(e.playerId) || e.pos || auto.get(e.playerId);
        const pos = clampPos(t, raw.x, raw.y);
        fShown.set(e.playerId, pos);
        pitch.append(pitchToken(e, t, pos, pitch, mine));
      }
      const onIds = new Set(on.map((e) => e.playerId));
      bench[t] = lineupOf(m).filter((e) => teamOfEntry(e) === t && playerById(e.playerId) && !onIds.has(e.playerId)
        && ['titolare', 'subentrato', 'panchina'].includes(e.status));
    }

    const benchBox = (t) => {
      if (!bench[t].length) return null;
      return h('div', { class: 'f-bench' },
        h('h4', { class: 'sec-h team-h team-h-' + t, text: `${t === 'A' ? '🔵' : '🔴'} ${names[t]} · panchina` }),
        h('div', { class: 'news-tags' }, bench[t].map((e) => {
          const p = playerById(e.playerId);
          const fv = fantavoto(e);
          return h('span', { class: 'news-tag', text: (e.status === 'subentrato' ? '↪ ' : e.status === 'titolare' ? '＋ ' : '') + p.name + (fv != null ? ' · ' + fmt(fv) : '') });
        })));
    };
    const over = ['A', 'B'].filter((t) => onPitchCount[t] > size);
    const few = ['A', 'B'].filter((t) => onPitchCount[t] < size);

    dlg.replaceChildren(h('div', { class: 'formation' },
      h('div', { class: 'sheet-head' },
        h('span', { class: 'news-meta', text: `Giornata ${matchNo(m)} · ${dayOf(m).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} · ${size} vs ${size}` }),
        h('div', { class: 'head-actions' },
          h('button', { type: 'button', class: 'icon-btn', text: '📋 Dettagli', onclick: () => { dlg.close(); openMatchDetail(m.id); } }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', text: '✕', onclick: () => dlg.close() }))),

      h('div', { class: 'f-head' },
        h('div', { class: 'f-team a' }, h('b', { text: names.A }), h('small', { text: `${onPitchCount.A} titolari` })),
        h('div', { class: 'f-score' },
          h('b', { class: res ? res.cls : '', text: res ? res.text : '–' }),
          hasFv ? h('small', { text: `${fmt(total('A'))} - ${fmt(total('B'))}` }) : null),
        h('div', { class: 'f-team b' }, h('b', { text: names.B }), h('small', { text: `${onPitchCount.B} titolari` }))),

      pitch,

      h('div', { class: 'f-actions' },
        h('button', { type: 'button', id: 'f-save', class: 'btn primary' + (fDirty ? '' : ' hidden'), text: 'Salva posizioni', onclick: saveFormation }),
        h('div', { class: 'switch-row grid-switch' },
          h('span', { text: '▦ Griglia' }),
          h('label', { class: 'switch', 'aria-label': 'Griglia sì/no' },
            h('input', { type: 'checkbox', ...(fGrid ? { checked: '' } : {}), onchange: toggleGrid }),
            h('span', { class: 'slider green' }))),
        mine ? h('button', { type: 'button', class: 'btn secondary', text: 'Schieramento automatico', onclick: resetFormation }) : null),

      h('p', { class: 'hint', text: mine
        ? 'Trascina ogni giocatore per scegliere la sua posizione esatta nella propria metà campo. Voto base a sinistra, fantavoto a destra. Titolari e panchina si cambiano da “Dettagli”.'
        : 'Voto base a sinistra, fantavoto a destra. In campo ci sono i titolari.' }),
      over.length ? h('p', { class: 'error', text: `Troppi titolari per il formato ${size} vs ${size}: ${over.map((t) => names[t]).join(', ')}. Quelli in più sono in panchina.` }) : null,
      !over.length && few.length ? h('p', { class: 'hint', text: `Titolari mancanti per il formato ${size} vs ${size}: ${few.map((t) => `${names[t]} ${onPitchCount[t]}/${size}`).join(', ')}.` }) : null,
      benchBox('A'),
      benchBox('B')));
  }

  async function saveFormation() {
    const m = matches.find((x) => x.id === formationId);
    if (!m) return;
    const next = lineupOf(m).map((e) => (fShown.has(e.playerId) ? { ...e, pos: fShown.get(e.playerId) } : e));
    fPos = new Map();
    fDirty = false;
    await saveLineup(m, next, 'Posizioni salvate con successo!');
  }

  async function resetFormation() {
    const m = matches.find((x) => x.id === formationId);
    if (!m) return;
    fPos = new Map();
    fDirty = false;
    await saveLineup(m, lineupOf(m).map((e) => ({ ...e, pos: null })));
  }

  // Aggiorna da sola il calendario: una partita passa a "giocata" quando scatta il suo orario
  setInterval(() => { if (me && tab === 'cal') renderCalendar(); }, 60 * 1000);

  // Chiudi i dialog toccando lo sfondo
  for (const id of ['#add-dialog', '#detail-dialog', '#match-dialog', '#match-detail-dialog', '#vote-dialog', '#formation-dialog']) {
    $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }

  // ---------- Il mio profilo ----------
  const profileKey = () => 'fanta-profilo:' + me;
  const getProfileId = () => { try { return localStorage.getItem(profileKey()) || ''; } catch { return ''; } };
  const setProfileId = (v) => { try { localStorage.setItem(profileKey(), v); } catch { /* ignora */ } };

  function renderProfile() {
    const sel = $('#profile-select');
    const list = [...players].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    let id = sel.value || getProfileId();
    if (!list.some((p) => p.id === id)) id = '';
    sel.replaceChildren(
      h('option', { value: '', text: '— Scegli un giocatore —' }),
      ...list.map((p) => h('option', { value: p.id, text: p.name })));
    sel.value = id;
    sel.closest('label').classList.toggle('hidden', list.length === 0);
    $('#profile-empty').classList.toggle('hidden', list.length > 0);
    const p = list.find((x) => x.id === id);
    const card = $('#profile-card');
    card.classList.toggle('hidden', !p);
    card.className = 'profile-card' + (p ? ' ' + roleClass(p).trim() : ' hidden');
    card.replaceChildren(...(p ? playerCard(p, false) : []));
  }
  $('#profile-select').addEventListener('change', (e) => { setProfileId(e.target.value); renderProfile(); });

  // ---------- Classifica ----------
  let rankParam = 'gol';
  const RANK_PARAMS = [
    { key: 'gol', label: '⚽ Gol', get: (s) => s.gol },
    { key: 'assist', label: '🅰️ Assist', get: (s) => s.assist },
    { key: 'media', label: '📊 Media voto', get: (s) => s.mediaVoto, dec: true },
    { key: 'fanta', label: '⭐ Fantamedia', get: (s) => s.fantamedia, dec: true },
    { key: 'mediaD', label: '🛡️ Media voto difensori', get: (s) => s.mediaVoto, dec: true, only: 'D' },
    { key: 'salv', label: '🚧 Salvataggi sulla linea', get: (s) => s.salvataggi },
    { key: 'avv', label: '⚠️ Avvertimenti', get: (s) => s.gialli + s.rossi },
    { key: 'pres', label: '👥 Presenze a voto', get: (s) => s.voto },
  ];

  function renderRank() {
    const par = RANK_PARAMS.find((x) => x.key === rankParam) || RANK_PARAMS[0];
    $('#rank-params').replaceChildren(...RANK_PARAMS.map((x) =>
      h('button', {
        type: 'button', class: 'rank-chip' + (x.key === par.key ? ' on' : ''),
        'aria-pressed': x.key === par.key ? 'true' : 'false', text: x.label,
        onclick: () => { rankParam = x.key; renderRank(); },
      })));

    const rows = players
      .filter((p) => !par.only || p.role === par.only)
      .map((p) => { const s = playerStats(p.id); return { p, s, v: par.get(s) }; })
      .filter((r) => r.v != null) // media senza voti: il giocatore non compare
      .sort((a, b) => b.v - a.v || a.p.name.localeCompare(b.p.name, 'it'));

    $('#rank-empty').classList.toggle('hidden', players.length > 0);
    const medals = ['🥇', '🥈', '🥉'];
    const list = $('#rank-list');
    list.replaceChildren();
    if (!rows.length && players.length) list.append(h('p', { class: 'hint', text: 'Nessun dato per questo parametro.' }));
    rows.forEach((r, i) => {
      const pos = rows.findIndex((x) => x.v === r.v) + 1; // a pari valore, stessa posizione
      const detail = {
        avv: `🟨 ${r.s.gialli} · 🟥 ${r.s.rossi}` + (r.p.warnings ? ' · ⚠️ avvertimento attivo' : ''),
        media: `${r.s.voto} partite a voto`,
        mediaD: `${r.s.voto} partite a voto`,
        fanta: `${r.s.voto} partite a voto`,
      }[par.key] || (r.p.role && ROLES[r.p.role]) || '';
      list.append(
        h('button', { type: 'button', class: 'rank-row' + (pos <= 3 ? ' top' : ''), onclick: () => openDetail(r.p) },
          h('span', { class: 'rank-pos', text: pos <= 3 ? medals[pos - 1] : String(pos) }),
          h('div', { class: 'lp-av' + roleClass(r.p) }, avatar(r.p, 'avatar sm')),
          h('div', { class: 'rank-info' },
            h('b', { text: r.p.name }),
            detail ? h('small', { text: detail }) : null),
          h('span', { class: 'rank-val', text: par.dec ? fmt(r.v) : String(r.v) })));
    });
  }

  // ---------- Notifiche: infortuni e avvertimenti ----------
  // Il sito controlla ogni 30 secondi e avvisa quando un giocatore risulta infortunato o riceve un avvertimento
  // (modifiche fatte da altri). Avvisa sempre con un messaggio nel sito, e con una notifica del browser se attivata.
  const NOTIF_KEY = 'fanta-notif';
  const notifOn = () => { try { return localStorage.getItem(NOTIF_KEY) === '1'; } catch { return false; } };
  const setNotifPref = (v) => { try { localStorage.setItem(NOTIF_KEY, v ? '1' : '0'); } catch { /* ignora */ } };
  const canNotify = () => 'Notification' in window;
  // Notifiche push vere: arrivano sul telefono anche a sito chiuso (service worker + server)
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => !!navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  let pushSub = null; // iscrizione push di questo dispositivo
  const notifActive = () => notifOn() && canNotify() && Notification.permission === 'granted' && (!pushSupported || !!pushSub);

  const b64ToU8 = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  // Comunica al server questo dispositivo e i giocatori seguiti (il server invia le notifiche)
  async function pushSync(test) {
    if (!pushSub) return;
    await api('/push/subscribe', { method: 'POST', body: { subscription: pushSub.toJSON(), followed: [...followed], test: !!test } });
  }
  // Toglie questo dispositivo dall'utente corrente (al logout)
  async function pushDetach() {
    if (!pushSub) return;
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: pushSub.endpoint } }).catch(() => {});
  }
  async function initPush() {
    if (pushSupported) {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        pushSub = await reg.pushManager.getSubscription();
        if (pushSub && notifOn() && Notification.permission === 'granted') await pushSync(false);
      } catch { /* senza service worker restano le notifiche nel sito */ }
    }
    updateNotifBtn();
  }

  function updateNotifBtn() {
    const on = notifActive();
    $('#notif').textContent = on ? '🔔' : '🔕';
    $('#notif').title = on ? 'Notifiche attive (tocca per disattivare)' : 'Attiva le notifiche';
    $('#notif').setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  async function enablePush() {
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('Permesso negato: abilita le notifiche per questo sito dalle impostazioni del telefono');
      return;
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/key');
    const subscribe = async () => {
      try {
        return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
      } catch (err) {
        // il servizio push del browser (FCM / Apple) ha rifiutato l'iscrizione: spiego cosa fare davvero
        const brave = !!(navigator.brave && (await navigator.brave.isBrave().catch(() => false)));
        if (brave) throw new Error('Brave blocca le notifiche push di default: vai in brave://settings/privacy, attiva \"Usa Google Services per i messaggi push\", riavvia Brave e riprova');
        if (isIOS) throw new Error('Su iPhone apri Calciograsso dall\'icona sulla Home (non da Safari) e riprova');
        if (err && (err.name === 'AbortError' || /push service/i.test(err.message || ''))) {
          throw new Error('Il telefono non riesce a contattare il servizio notifiche: spegni VPN/DNS filtrante, controlla data e ora automatiche e riprova (con Google Play Services aggiornati)');
        }
        throw err;
      }
    };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await subscribe();
    pushSub = sub;
    try {
      await pushSync(true);
    } catch (err) {
      // iscrizione fatta con una chiave diversa (server reinstallato): si rifà da capo
      await sub.unsubscribe().catch(() => {});
      pushSub = await subscribe();
      await pushSync(true);
    }
    setNotifPref(true);
  }

  $('#notif').addEventListener('click', async () => {
    if (notifActive()) {
      setNotifPref(false);
      if (pushSub) {
        await pushDetach();
        await pushSub.unsubscribe().catch(() => {});
        pushSub = null;
      }
      updateNotifBtn();
      toast('Notifiche disattivate');
      return;
    }
    if (!pushSupported) {
      toast(isIOS && !isStandalone()
        ? 'Su iPhone: tocca Condividi → "Aggiungi alla schermata Home", poi apri Calciograsso dalla Home e attiva le notifiche'
        : 'Questo browser non supporta le notifiche push');
      return;
    }
    try {
      await enablePush();
      if (notifActive()) toast('Notifiche attivate ✔ Ti ho mandato una notifica di prova');
    } catch (err) {
      toast('Impossibile attivare le notifiche: ' + (err.message || 'errore'));
    }
    updateNotifBtn();
  });

  let alertSnap = null; // stato precedente di infortuni/avvertimenti: id -> { inj, warn }
  const alertState = (p) => {
    const inj = activeInjury(p);
    return { inj: inj ? inj.types.join(', ') + (inj.other ? ': ' + inj.other : '') : '', warn: p.warnings || '' };
  };

  function notify(title, body, tag) {
    toast(title);
    // con le notifiche push attive le invia il server: qui niente doppioni
    if (!pushSupported && notifActive()) {
      try { new Notification(title, { body, tag }); } catch { /* alcuni browser mobili non lo consentono */ }
    }
  }

  function checkAlerts(list) {
    const next = new Map(list.map((p) => [p.id, alertState(p)]));
    if (alertSnap) {
      for (const p of list) {
        const was = alertSnap.get(p.id);
        if (!was || !followed.has(p.id)) continue; // avvisi solo per i giocatori seguiti
        const now = next.get(p.id);
        if (now.inj && now.inj !== was.inj) notify(`🩹 ${p.name} infortunato`, now.inj, 'inj-' + p.id);
        if (now.warn && now.warn !== was.warn) notify(`⚠️ Avvertimento per ${p.name}`, now.warn, 'warn-' + p.id);
      }
    }
    alertSnap = next;
  }

  async function pollPlayers() {
    if (!me) return;
    try {
      const fresh = await api('/players');
      if (JSON.stringify(fresh) === JSON.stringify(players)) return;
      players = fresh;
      checkAlerts(players);
      renderList();
      renderCalendar();
    } catch { /* senza rete: riprova al prossimo giro */ }
  }
  setInterval(pollPlayers, 30 * 1000);

  // Bonus / malus: confronta gli eventi di ogni presenza con l'ultimo stato noto e avvisa per i giocatori seguiti
  let eventSnap = null; // "matchId|playerId" -> events
  const snapEvents = (list) => {
    const s = new Map();
    for (const m of list) for (const e of lineupOf(m)) s.set(m.id + '|' + e.playerId, e.events || {});
    eventSnap = s;
  };
  function checkEventAlerts(list) {
    if (eventSnap) {
      for (const m of list) {
        for (const e of lineupOf(m)) {
          if (!followed.has(e.playerId)) continue;
          const p = playerById(e.playerId);
          const was = eventSnap.get(m.id + '|' + e.playerId);
          if (!p || !was) continue;
          const parts = [];
          let hasBonus = false, hasMalus = false;
          for (const d of EVENT_DEFS) {
            const delta = ((e.events && e.events[d.key]) || 0) - (was[d.key] || 0);
            if (delta <= 0) continue;
            if (d.group === 'bonus') hasBonus = true; else hasMalus = true;
            parts.push(`${d.icon} ${d.label}${delta > 1 ? ' ×' + delta : ''} (${d.group === 'bonus' ? '+' : '−'}${fmt((settings[d.key] ?? 0) * delta)})`);
          }
          if (!parts.length) continue;
          const kind = hasBonus && hasMalus ? 'bonus e malus' : hasBonus ? 'bonus' : 'malus';
          notify(`${hasMalus && !hasBonus ? '🔻' : '⭐'} ${p.name}: nuovo ${kind}`, `${parts.join(', ')} · ${matchTitle(m)}`, 'ev-' + m.id + '-' + p.id);
        }
      }
    }
    snapEvents(list);
  }

  async function pollMatches() {
    if (!me) return;
    try {
      const fresh = await api('/matches');
      if (JSON.stringify(fresh) === JSON.stringify(matches)) return;
      checkEventAlerts(fresh);
      matches = fresh;
      renderCalendar();
      renderMatchDetail();
      if (!fDrag && !fDirty) renderFormation();
    } catch { /* senza rete: riprova al prossimo giro */ }
  }
  setInterval(pollMatches, 30 * 1000);

  // ---------- Menu + sezione Video ----------
  let area = 'fanta'; // 'fanta' | 'video'
  let videos = [];
  let videoMaxMB = 500;
  let videoFile = null; // file scelto, in attesa di caricamento
  let videoXhr = null; // upload in corso
  const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime'];
  const VIDEO_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

  const pauseVideos = () => document.querySelectorAll('#video-list video').forEach((v) => v.pause());

  function openMenu() {
    $('#menu').classList.remove('hidden');
    $('#menu-backdrop').classList.remove('hidden');
    $('#menu-btn').setAttribute('aria-expanded', 'true');
    $('#menu-close').focus();
  }
  function closeMenu(returnFocus = true) {
    $('#menu').classList.add('hidden');
    $('#menu-backdrop').classList.add('hidden');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
    if (returnFocus) $('#menu-btn').focus();
  }
  $('#menu-btn').addEventListener('click', openMenu);
  $('#menu-close').addEventListener('click', () => closeMenu());
  $('#menu-backdrop').addEventListener('click', () => closeMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#menu').classList.contains('hidden')) closeMenu();
  });

  function setArea(a) {
    area = a;
    const fanta = a === 'fanta';
    $('.tabs').classList.toggle('hidden', !fanta);
    $('#view-videos').classList.toggle('hidden', a !== 'video');
    $('#view-news').classList.toggle('hidden', a !== 'news');
    $('#view-settings').classList.toggle('hidden', a !== 'settings');
    $('#menu-settings').classList.toggle('on', a === 'settings');
    $('#menu-home').classList.toggle('on', fanta);
    $('#menu-news').classList.toggle('on', a === 'news');
    $('#menu-video').classList.toggle('on', a === 'video');
    pauseVideos();
    if (fanta) {
      setTab(tab);
    } else {
      for (const v of ['#view-profile', '#view-players', '#view-cal', '#view-rank']) $(v).classList.add('hidden');
      $('#fab').classList.add('hidden');
      if (a === 'video') { renderVideos(); loadVideos(); }
      if (a === 'news') { renderNews(); loadNews(); }
    }
    window.scrollTo(0, 0);
  }
  $('#menu-home').addEventListener('click', () => { setArea('fanta'); closeMenu(); });
  $('#menu-video').addEventListener('click', () => { setArea('video'); closeMenu(); });
  $('#menu-news').addEventListener('click', () => { setArea('news'); closeMenu(); });
  $('#menu-settings').addEventListener('click', () => { setArea('settings'); closeMenu(); });

  const fmtSize = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : (b / 1024 ** 2).toFixed(1) + ' MB');
  function videoType(file) {
    if (VIDEO_MIME.includes(file.type)) return file.type;
    return VIDEO_EXT[(file.name.split('.').pop() || '').toLowerCase()] || null;
  }

  async function loadVideos() {
    try {
      const r = await api('/videos');
      videoMaxMB = r.maxMB || videoMaxMB;
      $('#video-limit').textContent = `MP4, WebM o MOV · max ${videoMaxMB} MB`;
      if (JSON.stringify(r.items) !== JSON.stringify(videos)) {
        videos = r.items;
        renderVideos();
      }
    } catch (err) { if (area === 'video') toast(err.message); }
  }

  function videoCard(v) {
    const mine = isAdmin && v.createdBy === me;
    const when = new Date(v.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    return h('article', { class: 'video-card' },
      h('video', { controls: '', preload: 'metadata', playsinline: '', src: v.url + '#t=0.1', 'aria-label': v.title }),
      h('div', { class: 'video-info' },
        h('div', {},
          h('h3', { text: v.title }),
          h('p', { text: `${v.createdBy} · ${when} · ${fmtSize(v.size)}` })),
        mine ? h('button', { class: 'icon-btn video-del', type: 'button', 'aria-label': 'Elimina video', title: 'Elimina video', text: '🗑', onclick: () => deleteVideo(v) }) : null));
  }

  function renderVideos() {
    $('#video-admin').classList.toggle('hidden', !isAdmin);
    $('#video-list').replaceChildren(...videos.map(videoCard));
    $('#video-empty').classList.toggle('hidden', videos.length > 0);
  }

  async function deleteVideo(v) {
    if (!confirm(`Eliminare il video "${v.title}"?`)) return;
    try {
      await api('/videos/' + v.id, { method: 'DELETE' });
      videos = videos.filter((x) => x.id !== v.id);
      renderVideos();
      toast('Video eliminato');
    } catch (err) { toast(err.message); }
  }

  function resetVideoForm() {
    videoFile = null;
    videoXhr = null;
    $('#video-file').value = '';
    $('#video-compose').classList.add('hidden');
    $('#video-pick').classList.remove('hidden');
    $('#video-progress').classList.add('hidden');
    $('#video-pct').classList.add('hidden');
    $('#video-bar').style.width = '0';
    $('#video-error').textContent = '';
    $('#video-upload').disabled = false;
    $('#video-title').disabled = false;
  }

  $('#video-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#video-error').textContent = '';
    if (!videoType(f)) { resetVideoForm(); toast('Formato non supportato: usa MP4, WebM o MOV'); return; }
    if (f.size > videoMaxMB * 1024 * 1024) { resetVideoForm(); toast(`Video troppo grande (max ${videoMaxMB} MB)`); return; }
    videoFile = f;
    $('#video-title').value = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
    $('#video-fileinfo').textContent = `${f.name} · ${fmtSize(f.size)}`;
    $('#video-pick').classList.add('hidden');
    $('#video-compose').classList.remove('hidden');
    $('#video-title').focus();
  });

  $('#video-cancel').addEventListener('click', () => {
    if (videoXhr) videoXhr.abort();
    resetVideoForm();
  });

  $('#video-upload').addEventListener('click', () => {
    if (!videoFile || videoXhr) return;
    const file = videoFile;
    const title = $('#video-title').value.trim() || 'Video';
    const xhr = new XMLHttpRequest();
    videoXhr = xhr;
    $('#video-upload').disabled = true;
    $('#video-title').disabled = true;
    $('#video-error').textContent = '';
    $('#video-progress').classList.remove('hidden');
    $('#video-pct').classList.remove('hidden');
    $('#video-pct').textContent = 'Caricamento… 0%';

    const fail = (msg) => {
      videoXhr = null;
      $('#video-error').textContent = msg;
      $('#video-upload').disabled = false;
      $('#video-title').disabled = false;
      $('#video-progress').classList.add('hidden');
      $('#video-pct').classList.add('hidden');
    };

    xhr.open('POST', '/api/videos?title=' + encodeURIComponent(title));
    xhr.setRequestHeader('Content-Type', videoType(file));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $('#video-bar').style.width = pct + '%';
      $('#video-progress').setAttribute('aria-valuenow', String(pct));
      $('#video-pct').textContent = pct < 100 ? `Caricamento… ${pct}%` : 'Salvataggio…';
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* risposta non JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        videos.unshift(data);
        resetVideoForm();
        renderVideos();
        toast('Video caricato');
      } else {
        if (xhr.status === 401) showAuth();
        fail(data.error || 'Caricamento non riuscito');
      }
    };
    xhr.onerror = () => fail('Errore di rete durante il caricamento');
    xhr.onabort = () => { videoXhr = null; };
    xhr.send(file);
  });

  // ---------- News ----------
  let news = [];
  let newsImage = null; // data URL dell'immagine scelta nel form
  let editingNewsId = null; // id della notizia in modifica (null = nuova)

  let newsSeen = null; // id delle notizie già viste (la prima lettura non avvisa)
  let newsPlayers = new Set(); // giocatori scelti nel form notizia

  const newsPlayerList = (n) => (n.playerIds || []).map(playerById).filter(Boolean);

  function checkNewsAlerts(list) {
    if (newsSeen) {
      for (const n of list) {
        if (newsSeen.has(n.id) || n.createdBy === me) continue;
        const hit = newsPlayerList(n).filter((p) => followed.has(p.id));
        if (!(n.playerIds || []).length) notify("📰 C'è una nuova notizia", n.title, 'news-' + n.id); // notizia generale: per tutti
        else if (hit.length) notify(`📰 C'è una nuova notizia per te per ${hit.map((p) => p.name).join(', ')}`, n.title, 'news-' + n.id);
      }
    }
    newsSeen = new Set(list.map((n) => n.id));
  }
  setInterval(() => { if (me) loadNews(); }, 30 * 1000);

  function newsTags(n) {
    const list = newsPlayerList(n);
    if (!list.length) return null;
    return h('div', { class: 'news-tags' },
      ...list.map((p) => h('span', { class: 'news-tag' + (followed.has(p.id) ? ' follow' : ''), text: (followed.has(p.id) ? '🔔 ' : '') + p.name })));
  }

  async function loadNews() {
    try {
      const fresh = await api('/news');
      if (JSON.stringify(fresh) !== JSON.stringify(news)) {
        checkNewsAlerts(fresh);
        news = fresh;
        renderNews();
      }
    } catch (err) { if (area === 'news') toast(err.message); }
  }

  const newsDate = (n) => new Date(n.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  function newsCard(n) {
    return h('button', { class: 'news-card', type: 'button', onclick: () => openNews(n) },
      n.image
        ? h('img', { class: 'news-thumb', src: n.image, alt: '', loading: 'lazy' })
        : h('div', { class: 'news-thumb news-thumb-ph', 'aria-hidden': 'true', text: '📰' }),
      h('div', { class: 'news-body' },
        h('h3', { text: n.title }),
        h('p', { class: 'news-excerpt', text: n.description }),
        newsTags(n)));
  }

  function renderNews() {
    $('#news-add').classList.toggle('hidden', !isAdmin);
    $('#news-list').replaceChildren(...news.map(newsCard));
    $('#news-empty').classList.toggle('hidden', news.length > 0);
  }

  function openNews(n) {
    const mine = isAdmin && n.createdBy === me;
    $('#news-detail').replaceChildren(
      h('div', { class: 'sheet-head' },
        h('span', { class: 'news-meta', text: `${n.createdBy} · ${newsDate(n)}` }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', text: '✕', onclick: () => $('#news-detail-dialog').close() })),
      n.image ? h('img', { class: 'news-full', src: n.image, alt: '' }) : null,
      h('h2', { text: n.title }),
      h('p', { class: 'news-text', text: n.description }),
      newsTags(n),
      mine ? h('button', {
        class: 'btn secondary', type: 'button', text: '✎ Modifica notizia',
        onclick: () => { $('#news-detail-dialog').close(); openNewsForm(n); },
      }) : null,
      mine ? h('button', {
        class: 'btn danger', type: 'button', text: 'Elimina notizia',
        onclick: async () => {
          if (!confirm(`Eliminare la notizia "${n.title}"?`)) return;
          try {
            await api('/news/' + n.id, { method: 'DELETE' });
            news = news.filter((x) => x.id !== n.id);
            $('#news-detail-dialog').close();
            renderNews();
            toast('Notizia eliminata');
          } catch (err) { toast(err.message); }
        },
      }) : null);
    $('#news-detail-dialog').showModal();
  }

  function showNewsImage() {
    const has = !!newsImage;
    if (has) $('#n-prev').src = newsImage;
    $('#n-prev').classList.toggle('hidden', !has);
    $('#n-ph').classList.toggle('hidden', has);
    $('#n-remove').classList.toggle('hidden', !has);
  }


  // Giocatori collegati alla notizia (facoltativo)
  function renderNewsPlayers() {
    const q = $('#n-psearch').value.trim().toLowerCase();
    $('#n-pcount').textContent = newsPlayers.size ? `${newsPlayers.size} giocatori selezionati` : 'Nessun giocatore selezionato';
    const list = sortedPlayers(players).filter((p) => newsPlayers.has(p.id) || p.name.toLowerCase().includes(q));
    $('#n-pchips').replaceChildren(...(list.length ? list.map((p) => h('button', {
      type: 'button',
      class: 'chip pick' + (newsPlayers.has(p.id) ? ' on' : ''),
      'aria-pressed': newsPlayers.has(p.id) ? 'true' : 'false',
      text: p.name,
      onclick: () => { newsPlayers.has(p.id) ? newsPlayers.delete(p.id) : newsPlayers.add(p.id); renderNewsPlayers(); },
    })) : [h('p', { class: 'hint', text: players.length ? 'Nessun risultato.' : 'Nessun giocatore in lista.' })]));
  }
  $('#n-players-toggle').addEventListener('change', (e) => {
    $('#n-players-panel').classList.toggle('hidden', !e.target.checked);
    if (e.target.checked) renderNewsPlayers();
  });
  $('#n-psearch').addEventListener('input', renderNewsPlayers);

  // Apre il form notizia: vuoto per una nuova notizia, già compilato per modificarne una esistente
  function openNewsForm(n) {
    $('#news-form').reset();
    editingNewsId = n ? n.id : null;
    $('#news-form-title').textContent = n ? 'Modifica notizia' : 'Nuova notizia';
    $('#news-submit').textContent = n ? 'Salva modifiche' : 'Pubblica notizia';
    newsImage = n && n.image ? n.image : null;
    newsPlayers = new Set(n ? (n.playerIds || []).filter((id) => playerById(id)) : []);
    $('#n-title').value = n ? n.title : '';
    $('#n-desc').value = n ? n.description : '';
    const withPlayers = newsPlayers.size > 0;
    $('#n-players-toggle').checked = withPlayers;
    $('#n-players-panel').classList.toggle('hidden', !withPlayers);
    $('#n-psearch').value = '';
    if (withPlayers) renderNewsPlayers();
    showNewsImage();
    $('#news-error').textContent = '';
    $('#news-dialog').showModal();
  }
  $('#news-add').addEventListener('click', () => openNewsForm(null));
  $('#news-close').addEventListener('click', () => $('#news-dialog').close());

  $('#n-image').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      newsImage = await resizeImage(f, 1200);
      showNewsImage();
    } catch (err) { $('#news-error').textContent = err.message; }
  });
  $('#n-remove').addEventListener('click', () => {
    newsImage = null;
    $('#n-image').value = '';
    showNewsImage();
  });

  $('#news-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#news-submit');
    btn.disabled = true;
    $('#news-error').textContent = '';
    try {
      const wasEditing = editingNewsId;
      const item = await api(wasEditing ? '/news/' + wasEditing : '/news', {
        method: wasEditing ? 'PUT' : 'POST',
        body: { title: $('#n-title').value, description: $('#n-desc').value, image: newsImage,
          playerIds: $('#n-players-toggle').checked ? [...newsPlayers] : [] },
      });
      if (wasEditing) {
        const i = news.findIndex((x) => x.id === item.id);
        if (i >= 0) news[i] = item; else news.unshift(item);
      } else {
        news.unshift(item);
      }
      if (newsSeen) newsSeen.add(item.id);
      editingNewsId = null;
      $('#news-dialog').close();
      renderNews();
      toast(wasEditing ? 'Modifiche salvate ✔' : 'Notizia pubblicata');
    } catch (err) {
      $('#news-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Avvio ----------
  renderChips();
  renderRoles();
  renderFoot();
  api('/me').then((r) => { me = r.username; isAdmin = !!r.isAdmin; showApp(); }).catch(showAuth);
})();
