/* App del juego "Diez" (cliente). */
(function () {
  const R = window.Reglas;
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- almacenamiento local ----------
  const guardar = (k, v) => { try { v === undefined || v === null ? localStorage.removeItem('diez_' + k) : localStorage.setItem('diez_' + k, JSON.stringify(v)); } catch {} };
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
  let miFoto = leer('foto') || null;
  let mesa = null;
  let V = null;
  let fotos = [];
  let es = null;
  let conectado = false;
  let aviso = null;
  let enviando = false;
  let armarSalir = false;
  let armarCierre = false, timerCierre = null;
  const ui = { modo: 'idle', sel: [], ext: null, des: null, pago: null, orden: leer('orden') || 'palo', clave: '' };
  let miOrden = leer('miorden') || [];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const lps = (n) => (n < 0 ? '-' : '') + 'L ' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const apuestaTxt = (n) => ['', '', 'Va doble', 'Va triple', 'Va cuádruple', 'Va quíntuple'][n] || `Va x${n}`;

  const ICON = {
    mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-2a5 5 0 0 1-.6 2.4l1.5 1.5A7 7 0 0 0 19 11zM15 11V5a3 3 0 0 0-5.9-.8L15 10.1zM4.3 3 3 4.3l6 6V11a3 3 0 0 0 4.4 2.6l1.6 1.6A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 3.5-1.4l3.2 3.2 1.3-1.3z"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>',
    salir: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 3H4v18h6v-2H6V5h4zm5.6 4.4L14.2 8.8l2.2 2.2H9v2h7.4l-2.2 2.2 1.4 1.4L20.2 12z"/></svg>',
    compartir: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg>',
  };

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
      let nv;
      try { nv = JSON.parse(e.data); } catch { return; }
      alCambiarVista(nv);
    });
    es.addEventListener('fotos', (e) => { try { fotos = JSON.parse(e.data) || []; } catch {} render(); });
    es.addEventListener('senal', (e) => { try { Voz.recibir(JSON.parse(e.data)); } catch {} });
    es.onopen = () => {
      conectado = true;
      if (miFoto) post('foto', { code, foto: miFoto });
      render();
    };
    es.onerror = async () => {
      conectado = false;
      render();
      const r = await post('unirse', { code, name: nombre });
      if (r.error && /no existe/i.test(r.error)) {
        salirLocal();
        aviso = { txt: 'Esa mesa ya no existe (el servidor se reinició). Crea una nueva.', error: true };
        render();
      }
    };
  }

  function salirLocal() {
    Voz.salir(true);
    if (es) es.close();
    es = null; mesa = null; V = null; fotos = []; conectado = false; evVisto = -1;
    guardar('mesa', undefined);
    history.replaceState(null, '', '/');
  }

  async function accion(a, silencioso) {
    if (enviando && !silencioso) return;
    if (!silencioso) { enviando = true; render(); }
    const r = await post('accion', { code: mesa, a });
    if (!silencioso) enviando = false;
    if (r.error) aviso = { txt: r.error, error: true };
    render();
    return r;
  }

  // ---------- cambios de vista ----------
  let ultimaMia = false;
  function alCambiarVista(nv) {
    V = nv;
    window.__V = nv;
    const clave = V.fase + '|' + (V.offer ? [V.offer.c, V.offer.to, V.offer.src, V.offer.by].join(',') : '') + '|' + (V.pagoPendiente ? 'pp' + V.pagoPendiente.seat : '') + '|' + V.partidas;
    if (clave !== ui.clave) {
      ui.clave = clave; ui.modo = 'idle'; ui.sel = []; ui.ext = null; ui.des = null; ui.pago = null;
      if (aviso) aviso = null;
    }
    const mia = V.fase === 'juego' && ((V.offer && V.offer.to === V.yo) || (V.pagoPendiente && V.pagoPendiente.seat === V.yo) || V.voltea === V.yo);
    if (mia && !ultimaMia && navigator.vibrate) { try { navigator.vibrate(90); } catch {} }
    ultimaMia = mia;
    const nuevos = eventosNuevos();
    render();
    if (nuevos.length) animar(nuevos);
    Voz.sync();
  }

  // ---------- piezas de interfaz ----------
  const PIPS = {
    2: [[50, 20], [50, 80]],
    3: [[50, 20], [50, 50], [50, 80]],
    4: [[34, 20], [66, 20], [34, 80], [66, 80]],
    5: [[34, 20], [66, 20], [50, 50], [34, 80], [66, 80]],
    6: [[34, 20], [66, 20], [34, 50], [66, 50], [34, 80], [66, 80]],
    7: [[34, 20], [66, 20], [50, 35], [34, 50], [66, 50], [34, 80], [66, 80]],
    8: [[34, 20], [66, 20], [50, 35], [34, 50], [66, 50], [50, 65], [34, 80], [66, 80]],
    9: [[34, 20], [66, 20], [34, 40], [66, 40], [50, 50], [34, 60], [66, 60], [34, 80], [66, 80]],
    10: [[34, 20], [66, 20], [50, 30], [34, 40], [66, 40], [34, 60], [66, 60], [50, 70], [34, 80], [66, 80]],
  };
  function carta(c, tam = 'md', cls = '', attrs = '') {
    if (!R.CODE_RE.test(c)) return '';
    const roja = c[1] === 'h' || c[1] === 'd';
    const s = R.SYM[c[1]];
    const r = R.rv(c);
    const lab = R.rankLabel(c);
    let centro = '';
    if (r === 1) centro = `<span class="as">${s}</span>`;
    else if (r >= 11) centro = `<span class="fig"><b>${lab}</b><i class="s1">${s}</i><i class="s2">${s}</i></span>`;
    else centro = PIPS[r].map(([x, y]) => `<span class="pip ${y > 52 ? 'inv' : ''}" style="left:${x}%;top:${y}%">${s}</span>`).join('');
    return `<span class="carta ${tam} ${roja ? 'roja' : ''} ${cls}" ${attrs} aria-label="${R.cardName(c)}"><span class="ix a"><b>${lab}</b><i>${s}</i></span><span class="ix b"><b>${lab}</b><i>${s}</i></span>${centro}<span class="grande">${s}</span></span>`;
  }
  const dorso = (tam = 'md', cls = '', attrs = '') => `<span class="carta dorso ${tam} ${cls}" ${attrs} aria-hidden="true"></span>`;
  const juego = (m, tam = 'xs', extra = '', attrs = '') => `<span class="juego ${extra}" ${attrs}>${m.map((c) => carta(c, tam)).join('')}</span>`;
  const nom = (i) => (V && V.seats[i] ? esc(V.seats[i].name) : '¿?');

  function colorDe(txt) {
    let h = 0;
    for (const ch of String(txt)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 38%)`;
  }
  const FOTO_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function avatarCrudo(nombreTxt, foto, px, cls = '', attrs = '') {
    const ini = esc(String(nombreTxt || '?').trim().slice(0, 1).toUpperCase() || '?');
    const dentro = foto && FOTO_OK.test(foto) ? `<img src="${foto}" alt="">` : ini;
    return `<span class="avatar ${cls}" ${attrs} style="--a:${px}px;background:${colorDe(nombreTxt)}">${dentro}</span>`;
  }
  function avatar(i, px, cls = '') {
    const s = V.seats[i];
    if (!s) return '';
    const deciding = V.fase === 'juego' && ((V.offer && V.offer.to === i) || (V.pagoPendiente && V.pagoPendiente.seat === i) || V.voltea === i);
    const c = cls + (deciding ? ' decide' : '') + (!s.conectado ? ' off' : '');
    const ins = s.voz ? `<span class="insignia ${s.mudo ? 'mudo' : ''}">${s.mudo ? ICON.micOff : ICON.mic}</span>` : '';
    return `<span class="av-wrap">${avatarCrudo(s.name, fotos[i], px, c, `data-vid="${esc(s.vid)}"`)}${ins}</span>`;
  }
  const ancho = () => matchMedia('(min-width: 900px) and (min-height: 520px)').matches;
  const clamp = (a, x, b) => Math.max(a, Math.min(b, x));
  const tamMano = () => (ancho() ? Math.round(clamp(60, innerHeight * 0.105, 80)) : 56);
  const tamOferta = () => (ancho() ? Math.round(clamp(84, innerHeight * 0.15, 112)) : innerWidth <= 360 ? 72 : 82);
  const tamAvatarRival = () => (ancho() ? 56 : innerWidth <= 360 ? 36 : 42);
  const saldoChip = (s) => (V.config && V.config.apuestas ? `<span class="saldo ${s.saldo < 0 ? 'neg' : ''}">${lps(s.saldo)}</span>` : '');

  // ---------- render (conserva lo que el usuario está escribiendo) ----------
  let avisoTimer = null, avisoVisto = null;
  function render() {
    if (arrastre && arrastre.activo) { renderPendiente = true; return; }
    if (aviso && !aviso.error && aviso !== avisoVisto) {
      avisoVisto = aviso;
      clearTimeout(avisoTimer);
      const este = aviso;
      avisoTimer = setTimeout(() => { if (aviso === este) { aviso = null; render(); } }, 3500);
    }
    try {
      const act = document.activeElement;
      const idAct = act && act.id && app.contains(act) ? act.id : null;
      let selAct = null;
      try { selAct = idAct ? act.selectionStart : null; } catch {}
      const vals = {};
      app.querySelectorAll('input[id]').forEach((i) => { vals[i.id] = i.type === 'checkbox' ? i.checked : i.value; });
      app.innerHTML = mesa ? vistaMesa() : vistaInicio();
      for (const k in vals) {
        const el = document.getElementById(k);
        if (el && app.contains(el)) { if (el.type === 'checkbox') el.checked = vals[k]; else el.value = vals[k]; }
      }
      if (idAct) {
        const el = document.getElementById(idAct);
        if (el) { el.focus({ preventScroll: true }); try { if (selAct !== null) el.setSelectionRange(selAct, selAct); } catch {} }
      }
      const inp = $('#nombre');
      if (inp) inp.oninput = () => { nombre = inp.value; guardar('nombre', nombre); };
      const cod = $('#codigo');
      if (cod) cod.onkeydown = (e) => { if (e.key === 'Enter') acciones.unirse(); };
      if (ocultarOferta) { const o = $('[data-anchor="offer"] .carta'); if (o) o.classList.add('oculta'); }
    } catch (e) {
      console.error(e);
    }
  }

  function vistaInicio() {
    const qs = new URLSearchParams(location.search).get('mesa') || '';
    const abanico = ['As', 'Kh', 'Qd', 'Jc', 'Ts']
      .map((c, i) => carta(c, '', '', `style="margin-left:-31px;transform:translateX(${(i - 2) * 24}px) translateY(${Math.abs(i - 2) * 5}px) rotate(${(i - 2) * 10}deg)"`))
      .join('');
    return `
      <section class="portada">
        <div class="abanico-portada" aria-hidden="true">${abanico}</div>
        <h1>Diez</h1>
        <p>Juego de cartas para 2 a 4 amigos, cada quien desde su celular.</p>
      </section>
      <div class="perfil">
        <span data-act="foto" role="button" tabindex="0" aria-label="Cambiar tu foto">${avatarCrudo(nombre || '?', miFoto, 72)}</span>
        <div style="flex:1">
          <input id="nombre" maxlength="14" autocomplete="nickname" placeholder="Tu nombre" aria-label="Tu nombre" value="${esc(nombre)}">
          <span class="cambiar" data-act="foto" role="button" tabindex="0">${miFoto ? 'Cambiar foto' : 'Toca el círculo para poner tu foto'}</span>
        </div>
      </div>
      <div class="home-cuerpo">
        <div style="margin-top:22px"><button class="btn ancho" data-act="crear">Crear mesa nueva</button></div>
        <div class="separador">o entra con el código que te mandaron</div>
        <div class="fila">
          <input id="codigo" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="CÓDIGO" aria-label="Código de la mesa" value="${esc(qs.toUpperCase())}">
          <button class="btn cielo" data-act="unirse">Entrar</button>
        </div>
        ${aviso ? `<div class="aviso ${aviso.error ? 'error' : ''}" style="margin:14px 0 0">${esc(aviso.txt)}</div>` : ''}
        <div style="text-align:center;margin-top:14px"><button class="texto" data-act="reglas">Ver las reglas</button></div>
        ${instalarTxt()}
      </div>
    `;
  }

  function instalarTxt() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (deferredPrompt) return `<div class="instalar"><button class="btn menta chico" data-act="instalar">Instalar la app en este teléfono</button></div>`;
    return `<p class="instalar">${ios ? 'Para instalarla en iPhone: en Safari toca Compartir y luego "Agregar a inicio".' : 'Para instalarla: abre el menú del navegador y toca "Instalar app".'}</p>`;
  }

  function barra() {
    const enMesa = V && V.yo >= 0;
    let mic = '';
    if (enMesa) {
      if (!Voz.on) mic = `<button class="chip" data-act="voz" aria-label="Entrar al audio de la mesa">${ICON.micOff}<span class="lbl">Audio</span></button>`;
      else {
        const otros = V.seats.filter((s, i) => i !== V.yo && s.voz && s.conectado);
        const ok = otros.filter((s) => (Voz.info.get(s.vid) || {}).estado === 'conectado').length;
        mic = (Voz.micCortado ? `<button class="chip mudo" data-act="reactivar-mic">${ICON.micOff}<span class="lbl">Reactivar mic</span></button>` :
          `<button class="chip ${Voz.mudo ? 'mudo' : 'activo'}" data-act="mudo" aria-label="${Voz.mudo ? 'Activar micrófono' : 'Silenciar micrófono'}">${Voz.mudo ? ICON.micOff + '<span class="lbl">Silenciado</span>' : ICON.mic + '<span class="lbl">Mic abierto</span>'}</button>`) +
          (Voz.bloqueado ? `<button class="chip mudo" data-act="destrabar">Toca para oír</button>` : '') +
          `<button class="chip ${otros.length && ok < otros.length ? 'mudo' : ''}" data-act="estado-audio" aria-label="Estado del audio">🔊 ${ok}/${otros.length}</button>` +
          `<button class="chip" data-act="voz-salir" aria-label="Salir del audio">${ICON.cerrar}</button>`;
      }
    }
    return `<div class="barra">
      <span class="chip codigo">${esc(mesa)}</span>
      <button class="chip" data-act="compartir" aria-label="Invitar">${ICON.compartir}<span class="lbl">Invitar</span></button>
      <span class="esp"></span>
      ${!conectado ? '<span class="chip mudo" style="cursor:default">…<span class="lbl">Reconectando</span></span>' : ''}
      ${mic}
      <button class="chip" data-act="reglas" aria-label="Reglas">?</button>
      <button class="chip ${armarSalir ? 'mudo' : ''}" data-act="salir" aria-label="Salir de la mesa">${armarSalir ? '¿Salir?' : ICON.salir}</button>
    </div>`;
  }

  function vistaMesa() {
    if (!V) return barra() + `<div class="sala"><p class="sub">Conectando con la mesa…</p></div>`;
    const avisoHtml = aviso ? `<div class="aviso ${aviso.error ? 'error' : ''}">${esc(aviso.txt)}</div>` : '';
    if (V.fase === 'espera') return barra() + vistaEspera() + avisoHtml;
    return barra() + vistaJuego(avisoHtml);
  }

  function vistaEspera() {
    const soyAnf = V.yo === V.anfitrion;
    const n = V.seats.length;
    const cfg = V.config || {};
    let asientos = '';
    for (let i = 0; i < 4; i++) {
      const s = V.seats[i];
      asientos += s
        ? `<div class="asiento">${avatar(i, 56)}<span class="etq-nombre">${esc(s.name)}${i === V.yo ? ' (tú)' : ''}</span>${i === V.anfitrion ? '<span class="etq">anfitrión</span>' : ''}${!s.conectado ? '<span class="etq off">sin conexión</span>' : ''}</div>`
        : `<div class="asiento libre"><span class="avatar" style="--a:56px">+</span><span class="etq-nombre" style="opacity:.5">Libre</span></div>`;
    }
    const config = soyAnf
      ? `<div class="config">
          <h3>Apuestas con dinero de juego</h3>
          <label class="interruptor"><span>Jugar con apuestas en lempiras</span><input type="checkbox" id="cfg-on" ${cfg.apuestas ? 'checked' : ''}><span class="riel"></span></label>
          <div class="fila">
            <div><label for="cfg-monto">Apuesta por partida (L)</label><input id="cfg-monto" inputmode="numeric" value="${cfg.monto}"></div>
            <div><label for="cfg-saldo">Saldo inicial (L)</label><input id="cfg-saldo" inputmode="numeric" value="${cfg.saldo}"></div>
          </div>
          <div style="margin-top:12px;text-align:right"><button class="btn cielo chico" data-act="guardar-config" ${enviando ? 'disabled' : ''}>Guardar apuestas</button></div>
        </div>`
      : `<div class="config"><h3>Apuestas</h3>${cfg.apuestas ? `Cada partida: <b>${lps(cfg.monto)}</b> al pozo · saldo inicial <b>${lps(cfg.saldo)}</b>` : 'Esta mesa juega sin apuestas.'}</div>`;
    return `<div class="sala">
      <p class="sub">Comparte este código con tus amigos</p>
      <div class="gran-codigo">${esc(mesa)}</div>
      <button class="btn cielo ancho" data-act="compartir">Enviar invitación por WhatsApp</button>
      <div class="asientos">${asientos}</div>
      ${V.espectador ? '<p class="sub">La mesa está llena. Estás mirando.</p>' : ''}
      ${config}
      ${soyAnf
        ? `<button class="btn ancho" data-act="repartir" ${n < 2 || enviando ? 'disabled' : ''}>${n < 2 ? 'Esperando al menos 2 jugadores' : `Repartir (${n} jugadores)`}</button>`
        : `<p class="sub">Esperando que ${nom(V.anfitrion)} reparta…</p>`}
    </div>`;
  }

  // Posición de cada rival alrededor de la mesa. El juego va en sentido antihorario:
  // el siguiente jugador queda a tu derecha.
  function posiciones() {
    const n = V.seats.length;
    const yo = V.yo;
    const otros = [];
    if (yo >= 0) for (let k = 1; k < n; k++) otros.push((yo + k) % n);
    else for (let k = 0; k < n; k++) otros.push(k);
    const mapa = { 1: ['top'], 2: ['tr', 'tl'], 3: ['right', 'top', 'left'], 4: ['right', 'top', 'left', 'bottom'] }[otros.length] || [];
    return otros.map((i, k) => ({ i, pos: mapa[k] }));
  }

  function rivalHtml({ i, pos }) {
    const s = V.seats[i];
    const n = Math.min(s.cartas, 10);
    let dorsos = '';
    for (let k = 0; k < n; k++) dorsos += dorso('', '', `style="left:${k * 5}px;transform:rotate(${(k - (n - 1) / 2) * 5}deg)"`);
    const etq =
      (s.cerrado ? '<span class="etq off">se cerró</span>' : '') +
      (i === V.dealer ? '<span class="etq">reparte</span>' : '') +
      (V.fase === 'cambio' ? `<span class="etq">${s.cambioListo ? 'listo' : 'eligiendo'}</span>` : '') +
      (!s.conectado ? '<span class="etq off">sin señal</span>' : '');
    // Botón para obligar a este jugador si pasó la carta que está en la mesa
    const puedeObligar = V.fase === 'juego' && V.offer && V.yo >= 0 && !s.cerrado && !(V.seats[V.yo] || {}).cerrado && (V.offer.pasaron || []).includes(i) && !(ui.modo !== 'idle' && V.offer.to === V.yo);
    const obligar = puedeObligar ? `<button class="chip rojo obligar-chip" data-act="obligar" data-seat="${i}" ${enviando ? 'disabled' : ''} aria-label="Obligar a ${esc(s.name)} a tomar la carta">Obligar</button>` : '';
    return `<div class="rival p-${pos} ${s.cerrado && V.fase !== 'fin' ? 'cerrado' : ''}">
      <div class="cabeza" data-anchor="seat-${i}">
        <div class="fila-av">${avatar(i, tamAvatarRival())}<div class="abanico-dorsos" style="--n:${Math.max(1, n)}">${dorsos}<b>${s.cartas}</b></div></div>
        <div class="datos"><span class="etq-nombre">${esc(s.name)}</span>${saldoChip(s)}${etq}</div>
        ${obligar}
      </div>
      <div class="juegos" data-anchor="melds-${i}">${s.melds.map((m) => juego(m, 'xs')).join('')}</div>
    </div>`;
  }

  function vistaJuego(avisoHtml) {
    const n = V.seats.length;
    const yo = V.yo;
    const misJuegos = yo >= 0 ? V.seats[yo].melds : [];
    const mano = ordenarMano(V.mano || []);
    let textoMesa = '';
    let pista = '';
    let botones = '';
    let manoSeleccionable = false;
    let juegosToc = false;

    const yoCerrado = yo >= 0 && V.seats[yo].cerrado && (V.fase === 'cambio' || V.fase === 'juego');
    const siguienteActivo = (i) => { for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (!V.seats[j].cerrado) return j; } return i; };
    if (V.fase === 'cambio') {
      const dest = yo >= 0 ? nom(siguienteActivo(yo)) : '';
      textoMesa = 'Carta de cambio: cada quien pasa 1 al siguiente';
      if (yoCerrado) {
        pista = 'Te cerraste: estás viendo la partida';
      } else if (yo >= 0 && !V.miCambio) {
        manoSeleccionable = true;
        pista = `Elige la carta que le pasas a ${dest}`;
        botones = `<button class="btn" data-act="pasar-cambio" ${!ui.pago || enviando ? 'disabled' : ''}>${ui.pago ? 'Pasarle el ' + R.cardName(ui.pago) : 'Elige una carta'}</button>`;
      } else if (yo >= 0) {
        pista = `Le pasaste el ${R.cardName(V.miCambio)} a ${dest}. Esperando a los demás…`;
      }
    }

    if (V.fase === 'juego' && V.pagoPendiente) {
      const pp = V.pagoPendiente;
      textoMesa = pp.seat === yo ? `${nom(pp.por)} te obligó a tomar el ${R.cardName(pp.c)}` : `${nom(pp.por)} obligó a ${nom(pp.seat)} a tomar el ${R.cardName(pp.c)}`;
      if (pp.seat === yo) {
        manoSeleccionable = true;
        const errP = ui.pago ? R.errorPago(misJuegos, V.mano, ui.pago) : null;
        pista = `Te obligaron: paga con una carta de tu mano` + (errP ? `<br><span class="err">${esc(errP)}</span>` : '');
        botones = `<button class="btn rojo" data-act="pagar-obligado" ${!ui.pago || errP || enviando ? 'disabled' : ''}>${ui.pago ? 'Pagar con ' + R.cardName(ui.pago) : 'Elige tu pago'}</button>`;
      } else pista = `Esperando que ${nom(pp.seat)} pague`;
    }
    if (V.fase === 'juego' && V.offer) {
      const o = V.offer;
      const mia = o.to === yo;
      if (o.to < 0) {
        textoMesa = `Nadie quiso el ${R.cardName(o.c)} · ${V.voltea === yo ? 'te toca voltear' : 'voltea ' + nom(V.voltea)}`;
        if (V.voltea === yo) {
          pista = 'Puedes obligar a quien la pasó, o voltear la siguiente: tendrás prioridad sobre ella';
          botones = `<button class="btn" data-act="voltear" ${enviando ? 'disabled' : ''}>Voltear siguiente</button>`;
        } else if (yo >= 0) pista = `Esperando que ${nom(V.voltea)} voltee la siguiente carta`;
      }
      else textoMesa = (o.src === 'mazo' ? 'Salió del mazo' : `Pago de ${nom(o.by)}`) + ' · ' + (mia ? 'te toca decidir' : 'decide ' + nom(o.to));
      if (mia) {
        if (ui.modo === 'idle') {
          botones = `<button class="btn" data-act="tomar" ${enviando ? 'disabled' : ''}>Tomar</button>` +
            `<button class="btn cielo" data-act="pasar" ${enviando ? 'disabled' : ''}>Pasar</button>`;
          pista = `¿Tomas el ${R.cardName(o.c)}?`;
        } else if (ui.modo === 'elegir') {
          manoSeleccionable = true;
          juegosToc = misJuegos.length > 0;
          const res = R.applyTake(misJuegos, V.mano, o.c, ui.sel, ui.ext, ui.des);
          pista = misJuegos.length
            ? `Elige cartas de tu mano para el ${R.cardName(o.c)} · <b>+</b> lo agrega a un juego · una carta punteada se desmocha`
            : `Toca las cartas que forman juego con el ${R.cardName(o.c)}`;
          if (ui.des && !res.err) pista = `Desmochas el ${R.cardName(ui.des.c)}: el juego nuevo queda expuesto`;
          if ((ui.sel.length || ui.ext !== null || ui.des) && res.err) pista += `<br><span class="err">${esc(res.err)}</span>`;
          pista += '';
          botones = `<button class="btn" data-act="bajar" ${res.err || enviando ? 'disabled' : ''}>Bajar juego</button><button class="btn cielo" data-act="cancelar">Cancelar</button>`;
        } else if (ui.modo === 'pagar') {
          manoSeleccionable = true;
          const tras = R.applyTake(misJuegos, V.mano, o.c, ui.sel, ui.ext, ui.des);
          const errP = ui.pago && !tras.err ? R.errorPago(tras.melds, tras.hand, ui.pago) : null;
          pista = `Ahora paga: elige la carta que vas a soltar` + (errP ? `<br><span class="err">${esc(errP)}</span>` : '');
          botones = `<button class="btn rojo" data-act="pagar" ${!ui.pago || errP || enviando ? 'disabled' : ''}>${ui.pago ? 'Pagar con ' + R.cardName(ui.pago) : 'Elige tu pago'}</button><button class="btn cielo" data-act="atras">Atrás</button>`;
        }
      }
    }

    const vivosN = V.seats.filter((x) => !x.cerrado).length;
    if (vivosN === 1 && V.fase === 'juego') textoMesa += !yoCerrado && yo >= 0 ? ' · juegas solo contra el mazo' : ` · ${nom(V.seats.findIndex((x) => !x.cerrado))} juega solo`;
    if (yoCerrado && V.fase === 'juego') { pista = 'Te cerraste: estás viendo la partida. Tu apuesta sigue en el pozo.'; botones = ''; manoSeleccionable = false; juegosToc = false; }
    const accionesHtml = yo >= 0 && V.fase !== 'fin' && (pista || botones)
      ? `<div class="acciones-barra">${pista ? `<div class="pista">${pista}</div>` : ''}${botones ? `<div class="botones">${botones}</div>` : ''}</div>`
      : ancho() && yo >= 0 ? '<div class="acciones-barra"></div>' : '';
    // Centro de la mesa
    const cfg = V.config || {};
    const info =
      (cfg.apuestas && V.pozo > 0 ? `<span class="pozo"><span class="l1">Pozo</span><span class="l2">${lps(V.pozo)}</span></span>` : '') +
      (V.apuesta > 1 && V.fase !== 'fin' ? `<span class="chip" style="background:#c8201b">${apuestaTxt(V.apuesta)}</span>` : '');
    const capas = Math.min(4, Math.ceil(V.mazo / 8));
    let mazo = '';
    for (let k = 0; k < capas; k++) mazo += dorso('', '', `style="left:${k * 1.5}px;top:${-k * 1.5}px"`);
    const giros = [-14, 9, -4];
    const descarte = (V.muertas || []).map((c, k) => carta(c, '', '', `style="transform:rotate(${giros[k % 3]}deg) translate(${k * 3 - 3}px,${k * 2}px)"`)).join('');
    const ofertaMia = V.fase === 'juego' && V.offer && V.offer.to === yo;
    const centro = `<div class="centro">
      <div class="info-centro">${info}</div>
      <div class="pila">
        <div class="mazo" data-anchor="deck">${V.mazo ? mazo + `<span class="num">${V.mazo}</span>` : ''}</div>
        <div class="oferta ${ofertaMia ? 'mia' : ''}" data-anchor="offer">${V.fase === 'juego' && V.offer ? carta(V.offer.c, 'lg') : '<span class="vacio-slot"></span>'}</div>
        <div class="descarte" data-anchor="discard">${descarte}</div>
      </div>
      <div class="aviso-mesa">${textoMesa}</div>
    </div>`;

    // Mi mano en abanico
    let manoVis = mano;
    if (ui.modo === 'pagar') manoVis = mano.filter((c) => !ui.sel.includes(c));
    const anchoApp = app.clientWidth || Math.min(window.innerWidth, 560);
    const W = Math.max(240, ancho() ? (anchoApp - 40) * 2.3 / 4.3 - 24 : anchoApp - 24);
    const cw = tamMano();
    const cnt = manoVis.length;
    const paso = cnt > 1 ? Math.min(cw * (ancho() ? 0.92 : 0.8), (W - cw - 34) / (cnt - 1)) : 0;
    const mid = (cnt - 1) / 2;
    manoLayout = { orden: manoVis, x0: W / 2 - mid * paso - cw / 2, paso: paso || cw };
    const manoHtml = manoVis.map((c, k) => {
      let sel = false;
      if (ui.modo === 'elegir' && ui.sel.includes(c)) sel = true;
      if ((ui.modo === 'pagar' || V.fase === 'cambio' || (V.pagoPendiente && V.pagoPendiente.seat === V.yo)) && ui.pago === c) sel = true;
      if (V.fase === 'cambio' && V.miCambio === c) sel = true;
      const d = k - mid;
      const x = W / 2 + d * paso - cw / 2;
      const y = d * d * 0.9 + (sel ? -20 : 0);
      const cls = (sel ? 'sel' : '') + (V.recibida === c && V.fase === 'juego' ? ' nueva' : '');
      const a = `style="left:${x}px;transform:translateY(${y}px) rotate(${d * 2.2}deg);z-index:${k + 1}" data-c="${c}"` +
        (manoSeleccionable ? ` data-act="carta" role="button" tabindex="0"` : '');
      return carta(c, 'md', cls, a);
    }).join('');

    const juegosHtml = misJuegos.length
      ? misJuegos.map((m, i) => miJuego(m, i, juegosToc)).join('')
      : '<span class="vacio">Tus juegos bajados</span>';

    const mio = yo >= 0
      ? `<section class="mio">
          <div class="mi-fila">
            <div class="mi-info-fila" style="display:flex;align-items:center;gap:8px">${avatar(yo, ancho() ? 52 : 40)}
            <div class="mi-info"><span class="etq-nombre">${nom(yo)}</span>${saldoChip(V.seats[yo])}</div>
            ${ancho() && V.fase !== 'fin' ? `<button class="chip orden" data-act="orden" title="Cambiar orden. También puedes arrastrar las cartas.">Orden: ${{ palo: 'palo', numero: 'número', libre: 'a mi gusto' }[ui.orden] || 'palo'}</button>` : ''}</div>
            <div class="misjuegos" data-anchor="melds-${yo}">${juegosHtml}</div>
            <div class="mis-botones">
            ${(V.fase === 'cambio' || V.fase === 'juego') && !yoCerrado ? `<button class="chip ${armarCierre ? 'mudo' : 'cerrarme'}" data-act="me-cierro">${armarCierre ? '¿Seguro? Toca otra vez' : 'Me cierro'}</button>` : ''}
            ${!ancho() && V.fase !== 'fin' ? `<button class="chip orden" data-act="orden" title="Cambiar orden. También puedes arrastrar las cartas.">Orden: ${{ palo: 'palo', numero: 'número', libre: 'a mi gusto' }[ui.orden] || 'palo'}</button>` : ''}
            </div>
          </div>
          <div class="mano-wrap ${yoCerrado ? 'cerrado' : ''}" data-anchor="seat-${yo}">
            ${V.fase !== 'fin' ? manoHtml : ''}
          </div>
          ${ancho() ? accionesHtml : ''}
          <div class="bitacora">${esc((V.log || [])[0] || '')}</div>
        </section>`
      : `<p class="aviso">Estás mirando esta partida. Entras en la próxima si hay lugar.</p>`;

    return `
      <div class="tapete">
        ${posiciones().map(rivalHtml).join('')}
        ${centro}
        ${!ancho() ? accionesHtml : ''}
        ${V.fase === 'fin' ? vistaFinal() : ''}
      </div>
      ${avisoHtml}
      ${mio}
    `;
  }

  // Orden de la mano: por palo, por número o "a mi gusto" (arrastrando)
  function ordenarMano(m) {
    if (ui.orden !== 'libre') return R.sortHand(m, ui.orden);
    const base = miOrden.filter((c) => m.includes(c));
    const nuevos = R.sortHand(m.filter((c) => !base.includes(c)), 'palo');
    miOrden = [...base, ...nuevos];
    return miOrden.slice();
  }

  // Mis juegos expuestos: en modo elegir, "+" agrega la carta y las cartas punteadas se pueden desmochar
  function miJuego(m, i, activo) {
    if (!activo) return juego(m, 'sm');
    const cartas = m.map((c) => {
      const puede = R.removible(m, c);
      const sel = ui.des && ui.des.m === i && ui.des.c === c;
      return carta(c, 'sm', (puede ? 'desmochable' : '') + (sel ? ' sel' : ''), puede ? `data-act="des" data-m="${i}" data-c="${c}" role="button" tabindex="0" title="Desmochar el ${R.cardName(c)}"` : '');
    }).join('');
    return `<span class="juego toc ${ui.ext === i ? 'sel' : ''}">${cartas}<button class="mas" data-act="ext" data-i="${i}" aria-label="Agregar la carta a este juego">+</button></span>`;
  }

  function vistaFinal() {
    const soyAnf = V.yo === V.anfitrion;
    let html = '';
    if (V.win) {
      const g = V.win;
      html += `<div>${avatar(g.seat, 64)}</div>
        <h2>${g.seat === V.yo ? '¡Ganaste!' : `Ganó ${nom(g.seat)}`}</h2>
        <div style="color:var(--tenue);font-weight:700">${g.porCierre ? 'porque todos los demás se cerraron' : `con el ${R.cardName(g.carta)}`}${!g.premio && g.apuesta > 1 ? ' · iba ' + apuestaTxt(g.apuesta).replace('Va ', '') : ''}</div>
        ${g.premio ? `<div class="premio">+${lps(g.premio)}</div>` : ''}
        <div class="juegos">${g.melds.map((m) => juego(m, 'sm')).join('')}</div>`;
    } else {
      html += `<h2>${esc(V.motivoFin || 'Se acabó el mazo')}</h2><div style="font-weight:700">Nadie ganó esta partida.</div>
        <div class="premio" style="background:linear-gradient(#ff9a8f,#c8201b);color:#fff">${V.pozo ? `Pozo de ${lps(V.pozo)} · ` : ''}${apuestaTxt(V.apuesta).toLowerCase()}</div>`;
    }
    const otros = V.seats.map((s, i) => ({ s, i })).filter(({ i }) => !V.win || i !== V.win.seat);
    html += `<div class="otras">${otros.map(({ s, i }) => `<div>${avatar(i, 28)}<b>${esc(s.name)}</b>${s.cerrado ? '<span class="etq off">se cerró</span>' : ''}${saldoChip(s)}
      ${s.melds.map((m) => juego(m, 'xs')).join('')} ${(s.mano || []).map((c) => carta(c, 'xs')).join('')}</div>`).join('')}</div>`;
    html += soyAnf
      ? `<div style="margin-top:14px"><button class="btn" data-act="repartir" ${V.seats.length < 2 || enviando ? 'disabled' : ''}>Repartir otra</button></div>`
      : `<p style="color:var(--tenue);font-weight:700">Esperando que ${nom(V.anfitrion)} reparta otra…</p>`;
    return `<div class="velo"><div class="final">${html}</div></div>`;
  }

  // ---------- animaciones ----------
  let evVisto = -1; // -1 = aún no inicializado
  let ocultarOferta = false;
  let colaAnim = Promise.resolve();
  function eventosNuevos() {
    const evs = V.evs || [];
    const max = evs.reduce((m, e) => Math.max(m, e.id), 0);
    if (evVisto < 0 || reducido) { evVisto = max; return []; }
    const nuevos = evs.filter((e) => e.id > evVisto);
    evVisto = Math.max(evVisto, max);
    if (nuevos.length > 8) return [];
    if (nuevos.some((e) => e.t === 'flip' || e.t === 'pago')) ocultarOferta = true;
    return nuevos;
  }
  const rect = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
  const anclaSeat = (i) => rect(`[data-anchor="seat-${i}"]`);
  const anclaMelds = (i) => rect(`[data-anchor="melds-${i}"]`) || anclaSeat(i);
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  function volar(desde, hasta, { c = null, dorsoInicio = false, voltear = false, dur = 420, tam = 56, rot = 0, finTam = null } = {}) {
    if (!desde || !hasta) return Promise.resolve();
    const h = tam * 1.4;
    const el = document.createElement('div');
    el.className = 'vuela';
    el.style.width = tam + 'px';
    el.style.height = h + 'px';
    el.style.left = '0px';
    el.style.top = '0px';
    const cara = c ? carta(c, '', '', `style="--w:${tam}px"`) : dorso('', '', `style="--w:${tam}px"`);
    const reves = dorso('', '', `style="--w:${tam}px"`);
    el.innerHTML = `<div class="vuela-in"><div class="cara">${dorsoInicio && !voltear ? reves : cara}</div><div class="reves">${reves}</div></div>`;
    document.body.appendChild(el);
    const x0 = desde.left + desde.width / 2 - tam / 2, y0 = desde.top + desde.height / 2 - h / 2;
    const x1 = hasta.left + hasta.width / 2 - tam / 2, y1 = hasta.top + hasta.height / 2 - h / 2;
    const s1 = finTam ? finTam / tam : 1;
    const a = el.animate(
      [
        { transform: `translate(${x0}px,${y0}px) rotate(${rot}deg) scale(0.9)` },
        { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 30}px) rotate(${rot / 2}deg) scale(1.08)`, offset: 0.5 },
        { transform: `translate(${x1}px,${y1}px) rotate(0deg) scale(${s1})` },
      ],
      { duration: dur, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' }
    );
    if (voltear) {
      el.querySelector('.vuela-in').animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });
    }
    return a.finished.catch(() => {}).then(() => el.remove());
  }

  function burbuja(r, txt) {
    if (!r) return;
    const b = document.createElement('div');
    b.className = 'burbuja';
    b.textContent = txt;
    b.style.position = 'fixed';
    b.style.left = r.left + r.width / 2 + 'px';
    b.style.top = r.top - 6 + 'px';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1500);
  }

  function confeti(r) {
    if (!r) return;
    const colores = ['#e2bd55', '#ffffff', '#8ff0b0', '#c8201b', '#8fd3f5'];
    for (let k = 0; k < 46; k++) {
      const p = document.createElement('div');
      p.className = 'chispa';
      p.style.background = colores[k % colores.length];
      p.style.left = r.left + r.width / 2 + 'px';
      p.style.top = r.top + r.height / 2 + 'px';
      document.body.appendChild(p);
      const ang = Math.random() * Math.PI * 2, vel = 90 + Math.random() * 160;
      const dx = Math.cos(ang) * vel, dy = Math.sin(ang) * vel - 120;
      p.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${dx}px,${dy + 260}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ], { duration: 1300 + Math.random() * 500, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).finished.then(() => p.remove());
    }
  }

  function mostrarOferta() {
    ocultarOferta = false;
    const o = $('[data-anchor="offer"] .carta');
    if (o) o.classList.remove('oculta');
  }

  function animar(evs) {
    colaAnim = colaAnim.then(async () => {
      for (const e of evs) {
        try {
          if (e.t === 'reparto') {
            const n = V.seats.length;
            const ps = [];
            for (let k = 0; k < 9; k++)
              for (let s = 0; s < n; s++) {
                const i = (V.dealer + 1 + s) % n;
                ps.push(espera((k * n + s) * 32).then(() => volar(rect('[data-anchor="deck"]'), anclaSeat(i), { dur: 340, tam: 40 })));
              }
            await Promise.all(ps);
          } else if (e.t === 'cambio') {
            const n = V.seats.length;
            await Promise.all(V.seats.map((_, i) => volar(anclaSeat(i), anclaSeat((i + 1) % n), { dur: 520, tam: 40 })));
          } else if (e.t === 'flip') {
            await volar(rect('[data-anchor="deck"]'), rect('[data-anchor="offer"]'), { c: e.c, voltear: true, dur: 460, tam: tamOferta() });
            mostrarOferta();
          } else if (e.t === 'muerta') {
            await volar(rect('[data-anchor="offer"]'), rect('[data-anchor="discard"]'), { c: e.c, dur: 380, tam: tamOferta(), finTam: 40, rot: 8 });
          } else if (e.t === 'cierra') {
            burbuja(anclaSeat(e.seat), 'Me cierro');
            await espera(200);
          } else if (e.t === 'pasa') {
            burbuja(anclaSeat(e.seat), 'Paso');
            await espera(160);
          } else if (e.t === 'toma') {
            await volar(rect('[data-anchor="offer"]'), anclaMelds(e.seat), { c: e.c, dur: 460, tam: tamOferta(), finTam: e.seat === V.yo ? 36 : 28 });
          } else if (e.t === 'pago') {
            await volar(anclaSeat(e.seat), rect('[data-anchor="offer"]'), { c: e.c, dur: 460, tam: tamMano(), finTam: tamOferta(), rot: -10 });
            mostrarOferta();
          } else if (e.t === 'gana') {
            confeti(rect('.final .avatar') || anclaSeat(e.seat));
            if (navigator.vibrate) try { navigator.vibrate([60, 60, 120]); } catch {}
          }
        } catch (err) {
          console.warn(err);
        }
      }
      mostrarOferta();
    });
  }

  // ---------- audio (micrófono abierto entre la mesa) ----------
  // Conexión directa entre teléfonos (WebRTC). Cada oferta/respuesta viaja en UN solo mensaje
  // con todas las rutas de red incluidas, para que no se pierdan ni lleguen desordenadas.
  const Voz = {
    on: false, mudo: false, stream: null, ice: null,
    pcs: new Map(),      // vid -> RTCPeerConnection
    info: new Map(),     // vid -> {estado, bytes, recibe, nivel}
    bloqueado: false,    // el navegador no dejó reproducir el sonido todavía
    micCortado: false,

    async entrar() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
        aviso = { txt: 'Este navegador no permite audio. Usa Chrome en Android o Safari en iPhone.', error: true };
        return render();
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch {
        aviso = { txt: 'No se pudo usar el micrófono. Da permiso de micrófono a la app en los ajustes del teléfono.', error: true };
        return render();
      }
      this.vigilarMic();
      if (!this.ice) {
        try { this.ice = (await (await fetch('/api/ice', { cache: 'no-store' })).json()).iceServers; } catch { this.ice = [{ urls: 'stun:stun.l.google.com:19302' }]; }
      }
      this.on = true;
      this.mudo = false;
      this.micCortado = false;
      await accion({ t: 'voz', on: true, mudo: false }, true);
      this.sync();
      render();
    },

    vigilarMic() {
      const t = this.stream && this.stream.getAudioTracks()[0];
      if (!t) return;
      const cortado = () => { if (this.on) { this.micCortado = true; render(); } };
      t.onended = cortado;
      t.onmute = cortado;
      t.onunmute = () => { this.micCortado = false; render(); };
    },

    // Volver a pedir el micrófono y ponerlo en todas las conexiones (si el teléfono lo cortó)
    async reactivarMic() {
      try {
        const nuevo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        const pista = nuevo.getAudioTracks()[0];
        pista.enabled = !this.mudo;
        for (const pc of this.pcs.values()) {
          const sender = pc.getSenders().find((x) => x.track === null || (x.track && x.track.kind === 'audio'));
          if (sender) await sender.replaceTrack(pista);
        }
        if (this.stream) this.stream.getTracks().forEach((x) => x.stop());
        this.stream = nuevo;
        this.micCortado = false;
        this.vigilarMic();
      } catch {
        aviso = { txt: 'No se pudo reactivar el micrófono. Revisa el permiso en los ajustes.', error: true };
      }
      render();
    },

    salir(silencioso) {
      if (!this.on) return;
      this.on = false;
      for (const vid of [...this.pcs.keys()]) this.cerrar(vid);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.info.clear();
      $('#audios').innerHTML = '';
      if (!silencioso && mesa) accion({ t: 'voz', on: false }, true);
      render();
    },

    alternarMudo() {
      if (!this.on) return;
      this.mudo = !this.mudo;
      this.stream.getAudioTracks().forEach((t) => (t.enabled = !this.mudo));
      accion({ t: 'voz', on: true, mudo: this.mudo }, true);
      render();
    },

    // Con quién debo estar conectado; el de id menor llama, el mayor contesta
    sync() {
      if (!this.on || !V || V.yo < 0) return;
      const yo = V.seats[V.yo].vid;
      const quieren = new Set(V.seats.filter((s, i) => i !== V.yo && s.voz && s.conectado).map((s) => s.vid));
      for (const vid of [...this.pcs.keys()]) if (!quieren.has(vid)) { this.cerrar(vid); this.info.delete(vid); }
      for (const vid of quieren) {
        if (!this.info.has(vid)) this.info.set(vid, { estado: 'conectando', bytes: 0, recibe: false, nivel: 0 });
        if (!this.pcs.has(vid) && yo < vid) this.llamar(vid);
      }
    },

    nueva(vid) {
      const pc = new RTCPeerConnection({ iceServers: this.ice });
      this.stream.getAudioTracks().forEach((t) => pc.addTrack(t, this.stream));
      pc.ontrack = (e) => {
        const st = e.streams[0] || new MediaStream([e.track]);
        let a = document.getElementById('au-' + vid);
        if (!a) {
          a = document.createElement('audio');
          a.id = 'au-' + vid;
          a.autoplay = true;
          a.setAttribute('playsinline', '');
          $('#audios').appendChild(a);
        }
        a.srcObject = st;
        this.reproducir(a);
      };
      pc.onconnectionstatechange = () => {
        const inf = this.info.get(vid) || {};
        const st = pc.connectionState;
        inf.estado = st === 'connected' ? 'conectado' : st === 'failed' ? 'falló' : st === 'disconnected' ? 'reconectando' : 'conectando';
        this.info.set(vid, inf);
        if (st === 'failed') this.reintentar(vid, pc);
        if (st === 'disconnected') setTimeout(() => { if (this.pcs.get(vid) === pc && pc.connectionState === 'disconnected') this.reintentar(vid, pc); }, 6000);
        render();
      };
      this.pcs.set(vid, pc);
      return pc;
    },

    reintentar(vid, pc) {
      if (this.pcs.get(vid) !== pc) return;
      this.cerrar(vid);
      setTimeout(() => this.sync(), 1500);
    },

    reproducir(a) {
      const p = a.play();
      if (p && p.catch) p.catch(() => { this.bloqueado = true; render(); });
    },

    // Esperar a reunir todas las rutas de red (máx. 4 s) para mandarlas en un solo mensaje
    esperarRutas(pc) {
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise((ok) => {
        const fin = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', ver); ok(); };
        const ver = () => { if (pc.iceGatheringState === 'complete') fin(); };
        const t = setTimeout(fin, 4000);
        pc.addEventListener('icegatheringstatechange', ver);
      });
    },

    async llamar(vid) {
      const pc = this.nueva(vid);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await this.esperarRutas(pc);
        if (this.pcs.get(vid) === pc) this.enviar(vid, { sdp: pc.localDescription });
      } catch (e) { console.warn(e); }
    },

    cerrar(vid) {
      const pc = this.pcs.get(vid);
      if (pc) try { pc.close(); } catch {}
      this.pcs.delete(vid);
      const a = document.getElementById('au-' + vid);
      if (a) a.remove();
    },

    enviar(to, data) {
      post('senal', { code: mesa, to, data: JSON.parse(JSON.stringify(data)) });
    },

    async recibir({ from, data }) {
      if (!this.on || !data || !from || !data.sdp) return;
      try {
        if (data.sdp.type === 'offer') {
          this.cerrar(from);
          const pc = this.nueva(from);
          await pc.setRemoteDescription(data.sdp);
          await pc.setLocalDescription(await pc.createAnswer());
          await this.esperarRutas(pc);
          if (this.pcs.get(from) === pc) this.enviar(from, { sdp: pc.localDescription });
        } else if (data.sdp.type === 'answer') {
          const pc = this.pcs.get(from);
          if (pc && pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(data.sdp);
        }
      } catch (e) { console.warn(e); }
    },

    // Quién está hablando y si llega sonido de cada uno (sin usar AudioContext: más estable en iPhone)
    async medir() {
      if (!this.on) return;
      let propio = 0;
      for (const [vid, pc] of this.pcs) {
        try {
          const st = await pc.getStats();
          const inf = this.info.get(vid) || {};
          st.forEach((r) => {
            if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) {
              inf.recibe = r.bytesReceived > (inf.bytes || 0);
              inf.bytes = r.bytesReceived;
              inf.nivel = r.audioLevel || 0;
            }
            if (r.type === 'media-source' && r.kind === 'audio' && r.audioLevel !== undefined) propio = Math.max(propio, r.audioLevel);
          });
          this.info.set(vid, inf);
        } catch {}
      }
      const pintar = (vid, habla) => document.querySelectorAll(`[data-vid="${vid}"]`).forEach((el) => el.classList.toggle('habla', habla));
      for (const [vid, inf] of this.info) pintar(vid, (inf.nivel || 0) > 0.03);
      if (V && V.yo >= 0) pintar(V.seats[V.yo].vid, propio > 0.03 && !this.mudo);
    },
  };
  setInterval(() => Voz.medir(), 400);
  // Cualquier toque en la pantalla destraba el sonido si el navegador lo había bloqueado
  document.addEventListener('pointerdown', () => {
    if (!Voz.on) return;
    document.querySelectorAll('#audios audio').forEach((a) => { if (a.paused) a.play().then(() => { if (Voz.bloqueado) { Voz.bloqueado = false; render(); } }).catch(() => {}); });
  });

  function estadoAudioHtml() {
    if (!V) return '';
    const filas = V.seats.map((s, i) => {
      if (i === V.yo) return `<li><b>${esc(s.name)} (tú)</b>: ${Voz.on ? (Voz.micCortado ? 'el micrófono se cortó' : Voz.mudo ? 'silenciado' : 'micrófono abierto') : 'fuera del audio'}</li>`;
      if (!s.voz) return `<li><b>${esc(s.name)}</b>: no ha entrado al audio</li>`;
      const inf = Voz.info.get(s.vid);
      if (!Voz.on) return `<li><b>${esc(s.name)}</b>: en el audio (entra tú también)</li>`;
      const est = inf ? inf.estado : 'conectando';
      const llega = inf && inf.recibe ? ' · llega su sonido' : est === 'conectado' ? ' · todavía no llega su sonido' : '';
      return `<li><b>${esc(s.name)}</b>: ${est}${s.mudo ? ' (silenciado)' : ''}${llega}</li>`;
    }).join('');
    return `<h2>Estado del audio</h2><ul>${filas}</ul>
      <p>Si alguien se queda en "conectando" o "falló", casi siempre es la red de datos móviles: el servidor necesita el servicio TURN (ver la guía). Prueben también con Wi‑Fi.</p>
      <p>Si no oyes a nadie, toca la pantalla una vez y revisa que el teléfono no esté en silencio.</p>`;
  }

  // ---------- foto de perfil ----------
  const archivo = $('#archivo-foto');
  archivo.addEventListener('change', async () => {
    const f = archivo.files && archivo.files[0];
    archivo.value = '';
    if (!f) return;
    try {
      miFoto = await reducirFoto(f);
      guardar('foto', miFoto);
      if (mesa) await post('foto', { code: mesa, foto: miFoto });
    } catch {
      aviso = { txt: 'No se pudo leer esa foto. Prueba con otra.', error: true };
    }
    render();
  });
  function reducirFoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const L = 192;
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        const cv = document.createElement('canvas');
        cv.width = L; cv.height = L;
        const cx = cv.getContext('2d');
        cx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, L, L);
        URL.revokeObjectURL(url);
        let q = 0.82, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 60000 && q > 0.4) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('foto')); };
      img.src = url;
    });
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
      if (navigator.share) { try { await navigator.share({ title: 'Diez', text: texto }); return; } catch {} }
      try { await navigator.clipboard.writeText(texto); aviso = { txt: 'Invitación copiada. Pégala en WhatsApp.' }; }
      catch { aviso = { txt: texto }; }
      render();
    },
    foto() { archivo.click(); },
    reglas() { $('#reglas').classList.add('abierto'); },
    'cerrar-reglas'() { $('#reglas').classList.remove('abierto'); },
    repartir() { accion({ t: 'repartir' }); },
    async 'guardar-config'() {
      const r = await accion({ t: 'config', apuestas: $('#cfg-on').checked, monto: Number(String($('#cfg-monto').value).replace(/[^0-9]/g, '')), saldo: Number(String($('#cfg-saldo').value).replace(/[^0-9]/g, '')) });
      if (r && r.ok) { aviso = { txt: 'Apuestas guardadas.' }; render(); }
    },
    orden() {
      ui.orden = { palo: 'numero', numero: miOrden.length ? 'libre' : 'palo', libre: 'palo' }[ui.orden] || 'palo';
      guardar('orden', ui.orden); render();
    },
    des(el) {
      if (ui.modo !== 'elegir') return;
      const m = Number(el.dataset.m), c = el.dataset.c;
      ui.des = ui.des && ui.des.m === m && ui.des.c === c ? null : { m, c };
      ui.ext = null;
      render();
    },
    carta(el) {
      const c = el.dataset.c;
      if (V.fase === 'cambio' || ui.modo === 'pagar' || (V.pagoPendiente && V.pagoPendiente.seat === V.yo)) ui.pago = ui.pago === c ? null : c;
      else if (ui.modo === 'elegir') ui.sel = ui.sel.includes(c) ? ui.sel.filter((x) => x !== c) : [...ui.sel, c];
      render();
    },
    ext(el) {
      if (ui.modo !== 'elegir') return;
      const i = Number(el.dataset.i);
      ui.ext = ui.ext === i ? null : i;
      ui.des = null;
      render();
    },
    'pasar-cambio'() { if (ui.pago) accion({ t: 'cambio', c: ui.pago }); },
    tomar() { ui.modo = 'elegir'; ui.sel = []; ui.ext = null; ui.des = null; render(); },
    voltear() { accion({ t: 'voltear' }); },
    'me-cierro'() {
      if (!armarCierre) { armarCierre = true; render(); clearTimeout(timerCierre); timerCierre = setTimeout(() => { armarCierre = false; render(); }, 3500); return; }
      armarCierre = false; clearTimeout(timerCierre);
      accion({ t: 'cerrar' });
    },
    obligar(el) { accion({ t: 'obligar', seat: Number(el.dataset.seat) }); },
    'pagar-obligado'() { if (ui.pago) accion({ t: 'pagar', c: ui.pago }); },
    cancelar() { ui.modo = 'idle'; ui.sel = []; ui.ext = null; ui.des = null; render(); },
    pasar() { accion({ t: 'pasar' }); },
    bajar() {
      const res = R.applyTake(V.seats[V.yo].melds, V.mano, V.offer.c, ui.sel, ui.ext, ui.des);
      if (res.err) return;
      if (R.winArrangement(res.melds, res.hand)) return accion({ t: 'tomar', use: ui.sel, ext: ui.ext, des: ui.des });
      ui.modo = 'pagar'; ui.pago = null; render();
    },
    atras() { ui.modo = 'elegir'; ui.pago = null; render(); },
    pagar() { if (ui.pago) accion({ t: 'tomar', use: ui.sel, ext: ui.ext, des: ui.des, pay: ui.pago }); },
    voz() { Voz.entrar(); },
    'voz-salir'() { Voz.salir(); },
    mudo() { Voz.alternarMudo(); },
    'reactivar-mic'() { Voz.reactivarMic(); },
    destrabar() { document.querySelectorAll('#audios audio').forEach((a) => a.play().catch(() => {})); Voz.bloqueado = false; render(); },
    'estado-audio'() { $('#info-audio .contenido').innerHTML = estadoAudioHtml(); $('#info-audio').classList.add('abierto'); },
    'cerrar-info'() { $('#info-audio').classList.remove('abierto'); },
    async instalar() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      deferredPrompt = null; render();
    },
  };

  // ---------- arrastrar cartas de la mano para ordenarlas a tu gusto ----------
  let manoLayout = null, arrastre = null, renderPendiente = false, ignorarClick = false;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.mano-wrap .carta[data-c]');
    if (!el || !manoLayout || (e.button !== undefined && e.button > 0)) return;
    arrastre = { el, c: el.dataset.c, x: e.clientX, y: e.clientY, left: parseFloat(el.style.left) || 0, activo: false, id: e.pointerId, to: null };
  });
  document.addEventListener('pointermove', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (!arrastre.activo) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        arrastre.activo = true;
        arrastre.el.classList.add('arrastrando');
        try { arrastre.el.setPointerCapture(e.pointerId); } catch {}
      } else return;
    }
    e.preventDefault();
    const L = manoLayout;
    arrastre.el.style.left = arrastre.left + dx + 'px';
    let to = Math.round((arrastre.left + dx - L.x0) / L.paso);
    to = Math.max(0, Math.min(L.orden.length - 1, to));
    if (to !== arrastre.to) {
      arrastre.to = to;
      const sin = L.orden.filter((c) => c !== arrastre.c);
      sin.splice(to, 0, arrastre.c);
      sin.forEach((c, k) => {
        if (c === arrastre.c) return;
        const card = document.querySelector(`.mano-wrap .carta[data-c="${c}"]`);
        if (card) card.style.left = L.x0 + k * L.paso + 'px';
      });
    }
  }, { passive: false });
  function soltar(e) {
    if (!arrastre || (e && e.pointerId !== arrastre.id)) return;
    const a = arrastre;
    arrastre = null;
    if (a.activo) {
      const L = manoLayout;
      const to = a.to === null ? L.orden.indexOf(a.c) : a.to;
      const nv = L.orden.filter((c) => c !== a.c);
      nv.splice(to, 0, a.c);
      const resto = ordenarMano(V.mano || []).filter((c) => !nv.includes(c));
      miOrden = [...nv, ...resto];
      guardar('miorden', miOrden);
      ui.orden = 'libre';
      guardar('orden', 'libre');
      ignorarClick = true;
      setTimeout(() => { ignorarClick = false; }, 60);
      renderPendiente = false;
      render();
    } else if (renderPendiente) { renderPendiente = false; render(); }
  }
  document.addEventListener('pointerup', soltar);
  document.addEventListener('pointercancel', soltar);

  document.addEventListener('click', (e) => {
    if (ignorarClick) { e.preventDefault(); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = acciones[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][role="button"]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape') { $('#reglas').classList.remove('abierto'); $('#info-audio').classList.remove('abierto'); }
  });
  window.addEventListener('resize', () => { if (mesa && V && V.fase !== 'espera') render(); });

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
