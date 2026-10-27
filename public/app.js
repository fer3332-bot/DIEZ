/* App del juego "Diez" (cliente). */
(function () {
  const R = window.Reglas;
  const $ = (s) => document.querySelector(s);
  const app = $('#app');

  // ---------- almacenamiento local ----------
  const guardar = (k, v) => { try { v === undefined ? localStorage.removeItem('diez_' + k) : localStorage.setItem('diez_' + k, JSON.stringify(v)); } catch {} };
  const leer = (k) => { try { const v = localStorage.getItem('diez_' + k); return v ? JSON.parse(v) : null; } catch { return null; } };
  function idAleatorio(n) {
    const a = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = new Uint32Array(n); crypto.getRandomValues(b);
    return [...b].map((x) => a[x % a.length]).join('');
  }
  const pid = leer('pid') || idAleatorio(20);
  guardar('pid', pid);

  // ---------- estado ----------
  let nombre = leer('nombre') || '';
  let mesa = null; // código
  let V = null; // vista del servidor
  let es = null; // EventSource
  let conectado = false;
  let aviso = null; // {txt, error}
  let enviando = false;
  let armarSalir = false;
  const ui = { modo: 'idle', sel: [], ext: null, pago: null, orden: leer('orden') || 'palo', clave: '' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // ---------- red ----------
  async function post(ruta, body) {
    try {
      const r = await fetch('/api/' + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !j.error) j.error = 'Error del servidor (' + r.status + ')';
      return j;
    } catch {
      return { error: 'Sin conexión. Revisa tu internet e inténtalo otra vez.' };
    }
  }

  function conectar(code) {
    if (es) es.close();
    mesa = code;
    guardar('mesa', code);
    history.replaceState(null, '', '/?mesa=' + code);
    es = new EventSource('/api/stream?mesa=' + encodeURIComponent(code) + '&pid=' + pid);
    es.addEventListener('estado', (e) => {
      conectado = true;
      try { V = JSON.parse(e.data); } catch { return; }
      alCambiarVista();
    });
    es.onopen = () => { conectado = true; render(); };
    es.onerror = async () => {
      conectado = false;
      render();
      // ¿La mesa todavía existe? (el servidor pudo reiniciarse)
      const r = await post('unirse', { code, name: nombre });
      if (r.error && /no existe/i.test(r.error)) {
        salirLocal();
        aviso = { txt: 'Esa mesa ya no existe (el servidor se reinició). Crea una nueva.', error: true };
        render();
      }
    };
  }

  function salirLocal() {
    if (es) es.close();
    es = null; mesa = null; V = null; conectado = false;
    guardar('mesa', undefined);
    history.replaceState(null, '', '/');
  }

  async function accion(a) {
    if (enviando) return;
    enviando = true; render();
    const r = await post('accion', { code: mesa, a });
    enviando = false;
    if (r.error) aviso = { txt: r.error, error: true };
    render();
    return r;
  }

  // ---------- cambios de vista ----------
  let ultimaMia = false;
  function alCambiarVista() {
    const clave = V.fase + '|' + (V.offer ? [V.offer.c, V.offer.to, V.offer.src, V.offer.by].join(',') : '') + '|' + V.partidas;
    if (clave !== ui.clave) {
      ui.clave = clave; ui.modo = 'idle'; ui.sel = []; ui.ext = null; ui.pago = null;
      if (aviso && aviso.error) aviso = null;
    }
    const mia = V.fase === 'juego' && V.offer && V.offer.to === V.yo;
    if (mia && !ultimaMia && navigator.vibrate) { try { navigator.vibrate(120); } catch {} }
    ultimaMia = mia;
    render();
  }

  // ---------- piezas de interfaz ----------
  function carta(c, cls = '', attrs = '') {
    if (!R.CODE_RE.test(c)) return '';
    const roja = c[1] === 'h' || c[1] === 'd';
    return `<span class="carta ${roja ? 'roja' : ''} ${cls}" ${attrs} aria-label="${R.cardName(c)}"><span class="r">${R.rankLabel(c)}</span><span class="p1">${R.SYM[c[1]]}</span><span class="p">${R.SYM[c[1]]}</span></span>`;
  }
  const dorso = (cls = '') => `<span class="carta dorso ${cls}" aria-hidden="true"></span>`;
  const juego = (m, cls = 'mini', extra = '') => `<span class="juego ${extra}">${m.map((c) => carta(c, cls)).join('')}</span>`;
  const nom = (i) => (V.seats[i] ? esc(V.seats[i].name) : '¿?');
  const apuestaTxt = (n) => ['', '', 'Va doble', 'Va triple', 'Va cuádruple', 'Va quíntuple'][n] || `Va x${n}`;

  function render() {
    try {
      app.innerHTML = mesa ? vistaMesa() : vistaInicio();
      const inp = $('#nombre');
      if (inp) inp.addEventListener('input', () => { nombre = inp.value; guardar('nombre', nombre); });
      const cod = $('#codigo');
      if (cod) cod.addEventListener('keydown', (e) => { if (e.key === 'Enter') acciones.unirse(); });
    } catch (e) {
      console.error(e);
    }
  }

  function vistaInicio() {
    const qs = new URLSearchParams(location.search).get('mesa') || '';
    const abanico = ['As', 'Kh', 'Qd', 'Jc', 'Ts'].map((c, i) => carta(c, '', `style="transform: rotate(${(i - 2) * 9}deg) translateY(${Math.abs(i - 2) * 6}px)"`)).join('');
    return `
      <section class="portada">
        <div class="abanico" aria-hidden="true">${abanico}</div>
        <h1>Diez</h1>
        <p>Juego de cartas para 2 a 4 amigos, cada quien desde su celular.</p>
      </section>
      <div class="bloque">
        <label for="nombre">Tu nombre</label>
        <input id="nombre" maxlength="14" autocomplete="nickname" placeholder="Ej. Fernando" value="${esc(nombre)}">
      </div>
      <div class="bloque">
        <button class="principal ancho" data-act="crear">Crear mesa nueva</button>
      </div>
      <div class="separador">o entra con el código que te mandaron</div>
      <div class="fila">
        <input id="codigo" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="Código" value="${esc(qs.toUpperCase())}" style="text-transform:uppercase;letter-spacing:4px;font-weight:700">
        <button data-act="unirse">Entrar</button>
      </div>
      ${aviso ? `<div class="aviso ${aviso.error ? 'error' : ''}">${esc(aviso.txt)}</div>` : ''}
      <div class="bloque" style="text-align:center"><button class="texto" data-act="reglas">Ver las reglas</button></div>
      ${instalarTxt()}
    `;
  }

  function instalarTxt() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (deferredPrompt) return `<div class="instalar"><button class="chico" data-act="instalar">Instalar la app en este teléfono</button></div>`;
    return `<p class="instalar">${ios ? 'Para instalarla en iPhone: en Safari toca Compartir y luego "Agregar a inicio".' : 'Para instalarla: abre el menú del navegador y toca "Instalar app" o "Agregar a pantalla principal".'}</p>`;
  }

  function encabezado() {
    return `<div class="top">
      <span class="codigo">${esc(mesa)}</span>
      <button class="chico" data-act="compartir">Invitar</button>
      <span class="esp"></span>
      ${!conectado ? '<span class="estado-red">Reconectando…</span>' : ''}
      <button class="chico" data-act="reglas">Reglas</button>
      <button class="chico" data-act="salir">${armarSalir ? '¿Seguro?' : 'Salir'}</button>
    </div>`;
  }

  function vistaMesa() {
    if (!V) return encabezado() + `<div class="sala">Conectando con la mesa…</div>`;
    const avisoHtml = aviso ? `<div class="aviso ${aviso.error ? 'error' : ''}">${esc(aviso.txt)}</div>` : '';
    if (V.fase === 'espera') return encabezado() + vistaEspera() + avisoHtml;
    return encabezado() + vistaJuego() + avisoHtml + bitacora();
  }

  function vistaEspera() {
    const soyAnf = V.yo === V.anfitrion;
    const n = V.seats.length;
    return `<div class="sala">
      <p style="margin:0;text-align:center;color:var(--tenue)">Comparte este código con tus amigos</p>
      <div class="gran-codigo">${esc(mesa)}</div>
      <button class="ancho" data-act="compartir">Enviar invitación</button>
      <ol>${V.seats.map((s, i) => `<li>${esc(s.name)}${i === V.yo ? ' (tú)' : ''}${i === V.anfitrion ? '<span class="etiqueta">anfitrión</span>' : ''}${!s.conectado ? '<span class="etiqueta off">sin conexión</span>' : ''}</li>`).join('')}</ol>
      ${V.espectador ? '<p>La mesa está llena (4 jugadores). Estás mirando.</p>' : ''}
      ${soyAnf
        ? `<button class="principal ancho" data-act="repartir" ${n < 2 || enviando ? 'disabled' : ''}>${n < 2 ? 'Esperando al menos 2 jugadores' : `Repartir (${n} jugadores)`}</button>`
        : `<p style="text-align:center;color:var(--tenue)">Esperando que ${nom(V.anfitrion)} reparta…</p>`}
    </div>`;
  }

  function rivales() {
    const n = V.seats.length;
    const base = V.yo >= 0 ? V.yo : -1;
    const orden = [];
    for (let k = 1; k <= n; k++) { const i = (base + k + n) % n; if (i !== V.yo) orden.push(i); }
    return `<div class="rivales">${orden.map((i) => {
      const s = V.seats[i];
      const decide = V.fase === 'juego' && V.offer && V.offer.to === i;
      const etiquetas = (i === V.dealer ? '<span class="etiqueta">reparte</span>' : '') +
        (V.fase === 'cambio' ? `<span class="etiqueta">${s.cambioListo ? 'listo' : 'eligiendo…'}</span>` : '') +
        (!s.conectado ? '<span class="etiqueta off">sin conexión</span>' : '');
      const sig = V.yo >= 0 && i === (V.yo + 1) % n ? ' <span style="color:var(--tenue);font-weight:400">· siguiente</span>' : '';
      return `<div class="rival ${decide ? 'decide' : ''}">
        <div class="nombre">${esc(s.name)}${sig}${etiquetas}</div>
        <div class="cuenta">${dorso('mini')} ${s.cartas}</div>
        ${s.melds.length ? `<div class="juegos">${s.melds.map((m) => juego(m)).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function vistaJuego() {
    const n = V.seats.length;
    const yo = V.yo;
    const mano = R.sortHand(V.mano || [], ui.orden);
    const misJuegos = yo >= 0 ? V.seats[yo].melds : [];
    let centro = '';
    let pista = '';
    let botones = '';
    let manoSeleccionable = false;
    let juegosToc = false;

    if (V.fase === 'cambio') {
      const dest = yo >= 0 ? nom((yo + 1) % n) : '';
      centro = `<div class="quien">Carta de cambio</div><div class="origen">Cada jugador le pasa 1 carta al siguiente.</div>`;
      if (yo >= 0 && !V.miCambio) {
        manoSeleccionable = true;
        pista = `Elige la carta que le pasas a <b>${dest}</b>.`;
        botones = `<button class="principal" data-act="pasar-cambio" ${!ui.pago || enviando ? 'disabled' : ''}>${ui.pago ? 'Pasarle el ' + R.cardName(ui.pago) : 'Elige una carta'}</button>`;
      } else if (yo >= 0) {
        pista = `Le pasaste el ${R.cardName(V.miCambio)} a ${dest}. Esperando a los demás…`;
      }
    }

    if (V.fase === 'juego' && V.offer) {
      const o = V.offer;
      const mia = o.to === yo;
      const origen = o.src === 'mazo' ? 'Salió del mazo' : `Pago de ${nom(o.by)}`;
      centro = `
        <div class="pila">
          <div class="mazo">${dorso('media')}<span class="num">${V.mazo}</span></div>
          <div class="oferta ${mia ? 'mia' : ''}">${carta(o.c, 'grande')}</div>
        </div>
        <div class="origen">${origen}</div>
        <div class="quien ${mia ? 'mia' : ''}">${mia ? 'Te toca decidir' : 'Decide ' + nom(o.to)}</div>`;
      if (mia) {
        const puedeGanar = !!R.winArrangement(misJuegos, [...(V.mano || []), o.c]);
        const sirve = R.canUse(misJuegos, V.mano || [], o.c);
        if (ui.modo === 'idle') {
          botones = (puedeGanar ? `<button class="ganar" data-act="ganar" ${enviando ? 'disabled' : ''}>¡Gano!</button>` : '') +
            `<button class="principal" data-act="tomar" ${!sirve || enviando ? 'disabled' : ''}>Tomar</button>` +
            `<button data-act="pasar" ${enviando ? 'disabled' : ''}>Pasar</button>`;
          pista = puedeGanar ? '¡Con esta carta completas tus 10!' : sirve ? '' : 'Esta carta no te forma ningún juego.';
        } else if (ui.modo === 'elegir') {
          manoSeleccionable = true;
          juegosToc = true;
          const res = R.applyTake(misJuegos, V.mano, o.c, ui.sel, ui.ext);
          pista = misJuegos.length
            ? `Toca las cartas de tu mano que van con el ${R.cardName(o.c)}, o toca uno de tus juegos de la mesa para agregarla.`
            : `Toca las cartas de tu mano que forman juego con el ${R.cardName(o.c)}.`;
          if ((ui.sel.length || ui.ext !== null) && res.err) pista += `<br><span style="color:#ffb4a9">${esc(res.err)}</span>`;
          botones = `<button class="principal" data-act="bajar" ${res.err || enviando ? 'disabled' : ''}>Bajar juego</button><button data-act="cancelar">Cancelar</button>`;
        } else if (ui.modo === 'pagar') {
          manoSeleccionable = true;
          pista = `Ahora paga: elige la carta que vas a soltar.`;
          botones = `<button class="principal" data-act="pagar" ${!ui.pago || enviando ? 'disabled' : ''}>${ui.pago ? 'Pagar con ' + R.cardName(ui.pago) : 'Elige tu pago'}</button><button data-act="atras">Atrás</button>`;
        }
      }
    }

    if (V.fase === 'fin') centro = vistaFinal();

    // mano visible (en modo pagar, sin las cartas que ya bajé)
    let manoVis = mano;
    if (ui.modo === 'pagar') manoVis = mano.filter((c) => !ui.sel.includes(c));
    const manoHtml = manoVis.map((c) => {
      let cls = '';
      if (ui.modo === 'elegir' && ui.sel.includes(c)) cls = 'sel';
      if ((ui.modo === 'pagar' || V.fase === 'cambio') && ui.pago === c) cls = 'sel';
      if (V.fase === 'cambio' && V.miCambio === c) cls = 'sel';
      if (V.recibida === c && V.fase === 'juego') cls += ' nueva';
      return carta(c, cls, manoSeleccionable ? `data-act="carta" data-c="${c}" role="button" tabindex="0"` : '');
    }).join('');

    const juegosHtml = misJuegos.length
      ? misJuegos.map((m, i) => juego(m, 'mini', (juegosToc ? 'toc' : '') + (ui.ext === i ? ' sel' : '')).replace('<span class="juego', `<span data-act="ext" data-i="${i}" class="juego`)).join('')
      : '<span class="vacio">Todavía no has bajado juegos.</span>';

    return `
      ${rivales()}
      <section class="centro">
        ${V.apuesta > 1 && V.fase !== 'fin' ? `<div><span class="apuesta">${apuestaTxt(V.apuesta)}</span></div>` : ''}
        ${centro}
        ${pista ? `<div class="pista">${pista}</div>` : ''}
        ${botones ? `<div class="acciones">${botones}</div>` : ''}
      </section>
      ${yo >= 0 && V.fase !== 'fin' ? `
      <section class="mio">
        <h2>Mis juegos en la mesa</h2>
        <div class="misjuegos">${juegosHtml}</div>
        <h2>Mi mano <span class="etiqueta">${mano.length}</span><span class="esp"></span>
          <button class="chico" data-act="orden">Ordenar por ${ui.orden === 'palo' ? 'número' : 'palo'}</button></h2>
        <div class="mano">${manoHtml}</div>
      </section>` : ''}
      ${V.espectador ? '<p class="vacio" style="text-align:center">Estás mirando esta partida. Entrarás en la próxima si hay lugar.</p>' : ''}
    `;
  }

  function vistaFinal() {
    const soyAnf = V.yo === V.anfitrion;
    let html = '';
    if (V.win) {
      const g = V.win;
      html += `<h2>${g.seat === V.yo ? '¡Ganaste!' : `Ganó ${nom(g.seat)}`}</h2>
        <div class="origen">con el ${R.cardName(g.carta)}${g.apuesta > 1 ? ` · iba ${apuestaTxt(g.apuesta).replace('Va ', '')}` : ''}</div>
        <div class="juegos-ganador">${g.melds.map((m) => juego(m, '')).join('')}</div>`;
    } else {
      html += `<h2>Se acabó el mazo</h2><div class="origen">Nadie completó sus 10 cartas.</div>
        <div><span class="apuesta">La próxima ${apuestaTxt(V.apuesta).toLowerCase()}</span></div>`;
    }
    const otros = V.seats.map((s, i) => ({ s, i })).filter(({ i }) => !V.win || i !== V.win.seat);
    html += `<div class="manos-finales">${otros.map(({ s, i }) => `<div><b>${esc(s.name)}</b>${i === V.yo ? ' (tú)' : ''}<br>
      ${s.melds.map((m) => juego(m)).join(' ')} ${(s.mano || []).map((c) => carta(c, 'mini')).join('')}</div>`).join('')}</div>`;
    html += soyAnf
      ? `<div class="acciones"><button class="principal" data-act="repartir" ${V.seats.length < 2 || enviando ? 'disabled' : ''}>Repartir otra</button></div>`
      : `<p class="vacio">Esperando que ${nom(V.anfitrion)} reparta otra…</p>`;
    return `<div class="final">${html}</div>`;
  }

  function bitacora() {
    return `<div class="bitacora" aria-live="polite">${(V.log || []).slice(0, 4).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
  }

  // ---------- acciones ----------
  const acciones = {
    async crear() {
      if (!nombre.trim()) { aviso = { txt: 'Escribe tu nombre primero.', error: true }; return render(); }
      const r = await post('crear', { name: nombre });
      if (r.error) { aviso = { txt: r.error, error: true }; return render(); }
      aviso = null; conectar(r.code); render();
    },
    async unirse() {
      const code = ($('#codigo')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!nombre.trim()) { aviso = { txt: 'Escribe tu nombre primero.', error: true }; return render(); }
      if (code.length !== 4) { aviso = { txt: 'El código tiene 4 letras o números.', error: true }; return render(); }
      const r = await post('unirse', { code, name: nombre });
      if (r.error) { aviso = { txt: r.error, error: true }; return render(); }
      aviso = r.espectador ? { txt: 'La partida ya empezó o está llena: entras mirando.' } : null;
      conectar(code); render();
    },
    async salir() {
      if (!armarSalir) { armarSalir = true; render(); setTimeout(() => { armarSalir = false; render(); }, 3000); return; }
      armarSalir = false;
      await post('salir', { code: mesa });
      salirLocal(); render();
    },
    async compartir() {
      const url = location.origin + '/?mesa=' + mesa;
      const texto = `¡Vamos a jugar Diez! Entra con el código ${mesa}: ${url}`;
      if (navigator.share) { try { await navigator.share({ title: 'Diez', text: texto, url }); return; } catch {} }
      try { await navigator.clipboard.writeText(texto); aviso = { txt: 'Invitación copiada. Pégala en WhatsApp.' }; }
      catch { aviso = { txt: texto }; }
      render();
    },
    reglas() { $('#reglas').classList.add('abierto'); },
    'cerrar-reglas'() { $('#reglas').classList.remove('abierto'); },
    repartir() { accion({ t: 'repartir' }); },
    orden() { ui.orden = ui.orden === 'palo' ? 'numero' : 'palo'; guardar('orden', ui.orden); render(); },
    carta(el) {
      const c = el.dataset.c;
      if (V.fase === 'cambio' || ui.modo === 'pagar') ui.pago = ui.pago === c ? null : c;
      else if (ui.modo === 'elegir') ui.sel = ui.sel.includes(c) ? ui.sel.filter((x) => x !== c) : [...ui.sel, c];
      render();
    },
    ext(el) {
      if (ui.modo !== 'elegir') return;
      const i = Number(el.dataset.i);
      ui.ext = ui.ext === i ? null : i;
      render();
    },
    'pasar-cambio'() { if (ui.pago) accion({ t: 'cambio', c: ui.pago }); },
    tomar() { ui.modo = 'elegir'; ui.sel = []; ui.ext = null; render(); },
    cancelar() { ui.modo = 'idle'; ui.sel = []; ui.ext = null; render(); },
    pasar() { accion({ t: 'pasar' }); },
    ganar() { accion({ t: 'ganar' }); },
    bajar() {
      const yo = V.yo;
      const res = R.applyTake(V.seats[yo].melds, V.mano, V.offer.c, ui.sel, ui.ext);
      if (res.err) return;
      if (R.winArrangement(res.melds, res.hand)) return accion({ t: 'tomar', use: ui.sel, ext: ui.ext });
      ui.modo = 'pagar'; ui.pago = null; render();
    },
    atras() { ui.modo = 'elegir'; ui.pago = null; render(); },
    pagar() { if (ui.pago) accion({ t: 'tomar', use: ui.sel, ext: ui.ext, pay: ui.pago }); },
    async instalar() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      deferredPrompt = null; render();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = acciones[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][role="button"]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape') $('#reglas').classList.remove('abierto');
  });

  // ---------- PWA ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (!mesa) render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // Al volver a la app (iOS suspende las conexiones en segundo plano)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mesa && (!es || es.readyState === 2)) conectar(mesa);
  });

  // Latido: mantiene despierto el servidor (Render gratis se duerme tras 15 min sin peticiones)
  setInterval(() => { if (mesa && document.visibilityState === 'visible') fetch('/salud', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);

  // ---------- arranque ----------
  const qs = new URLSearchParams(location.search).get('mesa');
  const guardada = leer('mesa');
  if (guardada && (!qs || qs.toUpperCase() === guardada)) {
    post('unirse', { code: guardada, name: nombre || 'Jugador' }).then((r) => {
      if (r.error && /no existe/i.test(r.error)) { guardar('mesa', undefined); render(); } else conectar(guardada);
    });
  }
  render();
})();
