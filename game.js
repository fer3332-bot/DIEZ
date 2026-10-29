// Lógica de una mesa. El servidor es la única autoridad: guarda el mazo y las manos.
const crypto = require('crypto');
const R = require('./public/rules.js');

const MAX = 4;
// Sin relojes para quien está conectado: los jugadores se recuerdan entre ellos cuando alguien se tarda.
// Solo si un jugador está DESCONECTADO y le toca, pasa solo tras unos segundos.
const AUSENTE_MS = Number(process.env.DIEZ_T_AUSENTE) || 5000;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const idPublico = () => crypto.randomBytes(6).toString('hex');
const lps = (n) => 'L ' + Math.round(n).toLocaleString('en-US');

class Mesa {
  constructor(code) {
    this.code = code;
    this.seats = []; // {pid, vid, name, hand, melds, conectado, desdeAusente, saldo, voz}
    this.espectadores = new Map(); // pid -> name
    this.fase = 'espera'; // espera | cambio | juego | fin
    this.deck = [];
    this.dead = [];
    this.offer = null; // {c, src:'mazo'|'pago', by, to, start}
    this.dealer = -1;
    this.turn = 0;
    this.passes = {};
    this.recibidas = {};
    this.log = ['Mesa creada'];
    this.win = null;
    this.apuesta = 1; // 1 sencilla, 2 doble, 3 triple...
    this.partidas = 0;
    this.version = 0;
    this.ultimaActividad = Date.now();
    // Apuestas con dinero ficticio (lempiras de juego)
    this.config = { apuestas: false, monto: 20, saldo: 1000 };
    this.pozo = 0;
    // Eventos recientes para animar en los teléfonos
    this.evs = [];
    this.evId = 0;
    // Fotos de perfil: pid -> dataURL
    this.fotos = new Map();
  }

  addLog(s) {
    this.log.unshift(s);
    this.log = this.log.slice(0, 6);
  }
  ev(t, o = {}) {
    this.evs.push({ id: ++this.evId, t, ...o });
    if (this.evs.length > 12) this.evs.shift();
  }

  seatOf(pid) {
    return this.seats.findIndex((s) => s.pid === pid);
  }
  vidOf(pid) {
    const s = this.seats.find((x) => x.pid === pid);
    return s ? s.vid : null;
  }
  anfitrion() {
    const i = this.seats.findIndex((s) => s.conectado);
    return i < 0 ? 0 : i;
  }
  nuevoAsiento(pid, name) {
    return { pid, vid: idPublico(), name, hand: [], melds: [], conectado: false, desdeAusente: Date.now(), saldo: this.config.saldo, voz: false };
  }

  unirse(pid, name) {
    name = String(name || 'Jugador').trim().slice(0, 14) || 'Jugador';
    const i = this.seatOf(pid);
    if (i >= 0) {
      this.seats[i].name = name;
      return { ok: true };
    }
    if ((this.fase === 'espera' || this.fase === 'fin') && this.seats.length < MAX) {
      this.seats.push(this.nuevoAsiento(pid, name));
      this.espectadores.delete(pid);
      this.addLog(`${name} se sentó a la mesa`);
      return { ok: true };
    }
    this.espectadores.set(pid, name);
    return { ok: true, espectador: true };
  }

  salir(pid) {
    const i = this.seatOf(pid);
    if (i < 0) {
      this.espectadores.delete(pid);
      return;
    }
    if ((this.fase === 'espera' || this.fase === 'fin') && this.pozo === 0) {
      const [s] = this.seats.splice(i, 1);
      this.fotos.delete(pid);
      this.addLog(`${s.name} salió de la mesa`);
      if (this.dealer >= this.seats.length) this.dealer = -1;
    } else {
      this.seats[i].conectado = false;
      this.seats[i].voz = false;
      this.seats[i].desdeAusente = Date.now();
    }
  }

  setFoto(pid, url) {
    if (url) this.fotos.set(pid, url);
    else this.fotos.delete(pid);
  }
  fotosVista() {
    return this.seats.map((s) => this.fotos.get(s.pid) || null);
  }
  fotosFirma() {
    return this.seats.map((s) => s.pid + ':' + (this.fotos.get(s.pid) || '').length + (this.fotos.get(s.pid) || '').slice(-24)).join('|');
  }

  configurar(pid, c) {
    if (this.seatOf(pid) !== this.anfitrion()) return 'Solo el anfitrión cambia la configuración';
    if (!(this.fase === 'espera' || this.fase === 'fin')) return 'Cambia la configuración entre partidas';
    if (this.pozo > 0) return 'Hay un pozo pendiente: termínalo antes de cambiar las apuestas';
    const monto = Math.round(Number(c.monto));
    const saldo = Math.round(Number(c.saldo));
    if (!(monto >= 1 && monto <= 1000000)) return 'La apuesta debe ser entre L 1 y L 1,000,000';
    if (!(saldo >= monto && saldo <= 100000000)) return 'El saldo inicial debe ser mayor que la apuesta';
    const saldoCambio = saldo !== this.config.saldo || (!!c.apuestas && !this.config.apuestas);
    this.config = { apuestas: !!c.apuestas, monto, saldo };
    if (saldoCambio) for (const s of this.seats) s.saldo = saldo;
    this.addLog(this.config.apuestas ? `Apuestas: ${lps(monto)} por partida · saldo inicial ${lps(saldo)}` : 'Juego sin apuestas');
    return null;
  }

  // Terminar el juego: resumen final para todos; la mesa ya no reparte más
  terminar(pid) {
    if (!(this.fase === 'espera' || this.fase === 'fin')) return 'Termina primero la partida en juego';
    if (this.seatOf(pid) !== this.anfitrion()) return 'Solo el anfitrión puede terminar el juego';
    let devuelto = 0;
    if (this.pozo > 0 && this.seats.length) {
      // Pozo sin ganador: se devuelve repartido en partes iguales
      const parte = Math.floor(this.pozo / this.seats.length);
      this.seats.forEach((s) => (s.saldo += parte));
      devuelto = this.pozo;
      this.pozo = 0;
    }
    this.fase = 'terminada';
    this.resumen = {
      apuestas: this.config.apuestas,
      saldoInicial: this.config.saldo,
      partidas: this.partidas,
      devuelto,
      jugadores: this.seats
        .map((s, i) => ({ i, name: s.name, ganadas: s.ganadas || 0, saldo: s.saldo, diferencia: s.saldo - this.config.saldo }))
        .sort((a, b) => (this.config.apuestas ? b.saldo - a.saldo : 0) || b.ganadas - a.ganadas),
    };
    this.addLog('El anfitrión terminó el juego');
    this.ev('terminado');
    return null;
  }

  repartir(pid) {
    if (this.fase === 'terminada') return 'Este juego ya terminó';
    if (!(this.fase === 'espera' || this.fase === 'fin')) return 'La partida ya empezó';
    if (this.seatOf(pid) !== this.anfitrion()) return 'Solo el anfitrión reparte';
    for (const [epid, name] of this.espectadores) {
      if (this.seats.length >= MAX) break;
      const s = this.nuevoAsiento(epid, name);
      s.conectado = true;
      this.seats.push(s);
      this.espectadores.delete(epid);
    }
    const n = this.seats.length;
    if (n < 2) return 'Se necesitan al menos 2 jugadores';
    this.dealer = (this.dealer + 1) % n;
    this.deck = shuffle(R.newDeck());
    this.dead = [];
    this.passes = {};
    this.recibidas = {};
    this.win = null;
    this.motivoFin = null;
    this.offer = null;
    this.pagoPendiente = null;
    for (const s of this.seats) {
      s.hand = this.deck.splice(0, 9);
      s.melds = [];
      s.cerrado = false;
    }
    if (this.config.apuestas) {
      for (const s of this.seats) s.saldo -= this.config.monto;
      this.pozo += this.config.monto * n;
    }
    this.fase = 'cambio';
    this.partidas++;
    this.addLog(`Reparte ${this.seats[this.dealer].name}` + (this.apuesta > 1 ? ` · va ${nombreApuesta(this.apuesta)}` : '') + (this.pozo ? ` · pozo ${lps(this.pozo)}` : ''));
    this.ev('reparto', { seat: this.dealer });
    return null;
  }

  // ---------- orden de juego (se salta a quien se cerró) ----------
  activos() {
    return this.seats.map((s, i) => i).filter((i) => !this.seats[i].cerrado);
  }
  // i si sigue jugando; si no, el siguiente que sí juega
  activoDesde(i) {
    const n = this.seats.length;
    for (let k = 0; k < n; k++) { const j = (i + k) % n; if (!this.seats[j].cerrado) return j; }
    return -1;
  }
  siguienteActivo(i) {
    return this.activoDesde((i + 1) % this.seats.length);
  }

  ofrecer(c, src, by, to) {
    to = this.activoDesde(to);
    if (src === 'pago' && to === by) to = -1; // juega solo: su propio pago no se le ofrece
    this.offer = { c, src, by, to, start: to, pasaron: [] };
    this.pagoPendiente = null;
  }

  terminarSinGanador(motivo) {
    this.fase = 'fin';
    this.win = null;
    this.offer = null;
    this.pagoPendiente = null;
    this.apuesta++;
    this.motivoFin = motivo;
    this.addLog(`${motivo}: nadie ganó, la próxima va ${nombreApuesta(this.apuesta)}`);
    this.ev('empate');
  }

  flip() {
    if (!this.deck.length) {
      this.terminarSinGanador('Se acabó el mazo');
      return;
    }
    const c = this.deck.pop();
    this.turn = this.activoDesde(this.turn);
    this.ofrecer(c, 'mazo', -1, this.turn);
    this.ev('flip', { c, seat: this.turn });
  }

  // El jugador que decide pasa la carta
  pasar(seat, sinSenal) {
    const o = this.offer;
    const nm = this.seats[seat].name;
    this.addLog(sinSenal ? `${nm} no tiene señal: pasó el ${R.cardName(o.c)}` : `${nm} pasó el ${R.cardName(o.c)}`);
    this.ev('pasa', { seat, c: o.c });
    if (!o.pasaron.includes(seat)) o.pasaron.push(seat);
    // Nadie más la quiere: se queda en la mesa (se puede obligar) hasta que el siguiente voltee
    o.to = this.siguienteDecisor(seat);
  }

  // Siguiente que puede decidir la carta: juega, no la ha pasado y no es quien la pagó
  siguienteDecisor(desde) {
    const o = this.offer;
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (desde + k) % n;
      if (this.seats[i].cerrado || o.pasaron.includes(i) || i === o.by) continue;
      return i;
    }
    return -1;
  }

  // Quien voltea la siguiente carta (y tendrá prioridad sobre ella)
  quienVoltea() {
    const o = this.offer;
    if (!o || o.to !== -1) return -1;
    return o.src === 'mazo' ? this.siguienteActivo(this.turn) : this.activoDesde(this.turn);
  }

  morir() {
    const o = this.offer;
    this.dead.push(o.c);
    this.addLog(`Nadie quiso el ${R.cardName(o.c)}`);
    this.ev('muerta', { c: o.c });
    if (o.src === 'mazo') this.turn = this.siguienteActivo(this.turn);
    this.flip();
  }

  pagar(seat, c) {
    const s = this.seats[seat];
    s.hand.splice(s.hand.indexOf(c), 1);
    this.ev('pago', { seat, c });
    const next = this.siguienteActivo(seat);
    this.turn = next;
    this.ofrecer(c, 'pago', seat, next);
  }

  // "Me cierro": no juega esta partida, la ve y su apuesta sigue en el pozo
  cerrar(seat, sinSenal) {
    const s = this.seats[seat];
    if (!(this.fase === 'cambio' || this.fase === 'juego')) return 'No hay partida en juego';
    if (s.cerrado) return 'Ya te cerraste';
    // Si debía pagar porque lo obligaron, primero se paga con una carta permitida
    if (this.pagoPendiente && this.pagoPendiente.seat === seat) {
      const ok = R.cartasPagables(s.melds, s.hand);
      this.pagar(seat, ok[crypto.randomInt(ok.length)]);
    }
    s.cerrado = true;
    this.addLog(sinSenal ? `${s.name} se quedó sin señal: se cerró` : `${s.name} se cerró`);
    this.ev('cierra', { seat });
    const vivos = this.activos();
    if (vivos.length === 0) {
      // Se cerraron todos: nadie gana y la próxima va doble (o triple…)
      this.terminarSinGanador('Todos se cerraron');
      return null;
    }
    if (vivos.length === 1) this.addLog(`${this.seats[vivos[0]].name} sigue jugando solo contra el mazo`);
    if (this.fase === 'cambio') {
      if (vivos.length === 1 || vivos.every((i) => this.passes[this.seats[i].pid])) this.hacerCambio();
      return null;
    }
    const o = this.offer;
    if (o && o.to === seat) o.to = this.siguienteDecisor(seat);
    if (this.turn === seat && (!o || o.to === -1)) this.turn = this.activoDesde(seat);
    return null;
  }



  accion(pid, a) {
    const seat = this.seatOf(pid);
    if (seat < 0) return 'No estás sentado en esta mesa';
    const s = this.seats[seat];
    a = a || {};

    if (a.t === 'repartir') return this.repartir(pid);
    if (a.t === 'terminar') return this.terminar(pid);
    if (this.fase === 'terminada' && a.t !== 'voz') return 'Este juego ya terminó';
    if (a.t === 'config') return this.configurar(pid, a);
    if (a.t === 'voz') {
      s.voz = !!a.on;
      s.mudo = !!a.mudo;
      return null;
    }

    if (a.t === 'cerrar') return this.cerrar(seat);
    if (s.cerrado && a.t !== 'repartir') return 'Te cerraste: estás viendo esta partida';

    if (a.t === 'cambio') {
      if (this.fase !== 'cambio') return 'No es momento de cambio';
      if (this.passes[pid]) return 'Ya elegiste tu carta';
      if (!s.hand.includes(a.c)) return 'Esa carta no está en tu mano';
      this.passes[pid] = a.c;
      if (this.activos().every((i) => this.passes[this.seats[i].pid])) this.hacerCambio();
      return null;
    }

    if (this.fase !== 'juego') return 'No es momento de jugar';

    // Pago después de que te obligaron a tomar
    if (a.t === 'pagar') {
      if (!this.pagoPendiente || this.pagoPendiente.seat !== seat) return 'No tienes un pago pendiente';
      const errPago = R.errorPago(s.melds, s.hand, a.c);
      if (errPago) return errPago;
      this.addLog(`${s.name} pagó con ${R.cardName(a.c)}`);
      this.pagar(seat, a.c);
      return null;
    }

    if (!this.offer) return 'Espera a que se pague la carta';
    const o = this.offer;

    // Obligar a quien pasó una carta que le servía en sus juegos expuestos
    if (a.t === 'obligar') {
      const obj = Number(a.seat);
      const x = this.seats[obj];
      if (!x || obj === seat) return 'Elige a otro jugador';
      if (!o.pasaron.includes(obj)) return `${x.name} no ha pasado esta carta`;
      if (x.cerrado) return `${x.name} se cerró: ya no juega esta partida`;
      if (!x.hand.length) return `${x.name} ya tiene todo expuesto: no puede pagar`;
      const i = x.melds.findIndex((m) => R.isMeld([...m, o.c]));
      if (i < 0) return `El ${R.cardName(o.c)} no le sirve a ${x.name} en sus juegos de la mesa`;
      x.melds[i] = R.sortMeld([...x.melds[i], o.c]);
      this.addLog(`${s.name} obligó a ${x.name} a tomar el ${R.cardName(o.c)}`);
      this.ev('toma', { seat: obj, c: o.c, obligado: true });
      this.offer = null;
      this.pagoPendiente = { seat: obj, c: o.c, por: seat };
      return null;
    }

    // Nadie quiso la carta: cualquiera voltea la siguiente
    if (a.t === 'voltear') {
      if (o.to !== -1) return 'Todavía hay quien decida esta carta';
      const v = this.quienVoltea();
      if (v !== seat) return `Le toca voltear a ${this.seats[v].name}`;
      this.morir();
      return null;
    }

    if (o.to !== seat) return 'No es tu turno de decidir';
    if (a.t === 'reclamar') return null;

    if (a.t === 'pasar') {
      this.pasar(seat);
      return null;
    }

    // Con las 9 cartas expuestas, la carta 10 tiene que salir del mazo
    const todoExpuesto = s.hand.length === 0;
    const reglaDiez = 'Con todo expuesto, tu carta 10 tiene que salir del mazo, no del pago de otro jugador';

    if (a.t === 'ganar') {
      const arr = R.winArrangement(s.melds, [...s.hand, o.c]);
      if (!arr) return 'Todavía no puedes ganar con esa carta';
      if (todoExpuesto && o.src === 'pago') return reglaDiez;
      this.ganar(seat, arr, o.c);
      return null;
    }

    if (a.t === 'tomar') {
      const res = R.applyTake(s.melds, s.hand, o.c, a.use, a.ext, a.des);
      if (res.err) return res.err;
      const arr = R.winArrangement(res.melds, res.hand);
      if (arr) {
        if (todoExpuesto && o.src === 'pago') return reglaDiez;
        s.melds = res.melds;
        s.hand = res.hand;
        this.ganar(seat, arr, o.c);
        return null;
      }
      if (!res.hand.includes(a.pay)) return 'Elige con qué carta pagas';
      const errPago = R.errorPago(res.melds, res.hand, a.pay);
      if (errPago) return errPago;
      s.melds = res.melds;
      s.hand = res.hand;
      this.addLog(`${s.name} tomó el ${R.cardName(o.c)}` + (res.desmoche ? ` desmochando el ${R.cardName(a.des.c)}` : '') + ` y pagó con ${R.cardName(a.pay)}`);
      this.ev('toma', { seat, c: o.c, des: res.desmoche ? a.des.c : undefined });
      this.pagar(seat, a.pay);
      return null;
    }
    return 'Acción desconocida';
  }

  hacerCambio() {
    // Solo intercambian quienes siguen jugando, cada uno con el siguiente activo
    const vivos = this.activos().length > 1 ? this.activos() : [];
    const cartas = vivos.map((i) => this.passes[this.seats[i].pid]);
    vivos.forEach((i, k) => { const x = this.seats[i]; x.hand.splice(x.hand.indexOf(cartas[k]), 1); });
    vivos.forEach((i, k) => {
      const dest = this.seats[this.siguienteActivo(i)];
      dest.hand.push(cartas[k]);
      this.recibidas[dest.pid] = cartas[k];
    });
    this.fase = 'juego';
    this.turn = this.siguienteActivo(this.dealer);
    this.addLog('Cambio hecho. ¡A jugar!');
    this.ev('cambio');
    this.flip();
  }

  ganar(seat, arr, c) {
    this.seats[seat].ganadas = (this.seats[seat].ganadas || 0) + 1;
    const premio = this.pozo;
    if (premio) this.seats[seat].saldo += premio;
    this.pozo = 0;
    this.fase = 'fin';
    this.win = { seat, melds: arr, carta: c, apuesta: this.apuesta, premio };
    this.offer = null;
    this.pagoPendiente = null;
    this.addLog(`🏆 ¡${this.seats[seat].name} ganó con el ${R.cardName(c)}!` + (premio ? ` Se lleva ${lps(premio)}` : this.apuesta > 1 ? ` (iba ${nombreApuesta(this.apuesta)})` : ''));
    this.ev('gana', { seat, c, premio });
    this.apuesta = 1;
  }

  // Solo para jugadores DESCONECTADOS: si le toca jugar y lleva 5 s sin señal, se cierra
  // (el juego sigue sin él; su apuesta queda en el pozo y puede volver a mirar)
  revisarAusentes() {
    const now = Date.now();
    const ido = (i) => { const x = this.seats[i]; return x && !x.conectado && !x.cerrado && now - x.desdeAusente > AUSENTE_MS; };
    let cambio = false;
    for (const x of this.seats) if (!x.conectado && x.voz) { x.voz = false; cambio = true; }
    if (this.fase === 'cambio') {
      for (let i = 0; i < this.seats.length; i++)
        if (this.fase === 'cambio' && !this.passes[this.seats[i].pid] && ido(i)) { this.cerrar(i, true); cambio = true; }
      return cambio;
    }
    if (this.fase !== 'juego') return cambio;
    const leToca = [];
    if (this.pagoPendiente) leToca.push(this.pagoPendiente.seat);
    if (this.offer && this.offer.to >= 0) leToca.push(this.offer.to);
    const v = this.quienVoltea();
    if (v >= 0) leToca.push(v);
    for (const i of leToca) if (this.fase === 'juego' && ido(i)) { this.cerrar(i, true); return true; }
    return cambio;
  }

  vista(pid) {
    const yo = this.seatOf(pid);
    const fin = this.fase === 'fin';
    return {
      v: this.version,
      code: this.code,
      fase: this.fase,
      yo,
      espectador: yo < 0,
      anfitrion: this.anfitrion(),
      dealer: this.dealer,
      turn: this.turn,
      apuesta: this.apuesta,
      partidas: this.partidas,
      mazo: this.deck.length,
      descarte: this.dead.length,
      muertas: this.dead.slice(-3),
      offer: this.offer,
      voltea: this.quienVoltea(),
      pagoPendiente: this.pagoPendiente,
      log: this.log,
      win: this.win,
      motivoFin: this.motivoFin || null,
      resumen: this.fase === 'terminada' ? this.resumen : null,
      config: this.config,
      pozo: this.pozo,
      evs: this.evs,
      espectadores: this.espectadores.size,
      mano: yo >= 0 ? this.seats[yo].hand : [],
      miCambio: this.passes[pid] || null,
      recibida: this.recibidas[pid] || null,
      seats: this.seats.map((x) => ({
        name: x.name,
        vid: x.vid,
        cartas: x.hand.length,
        melds: x.melds,
        conectado: x.conectado,
        voz: x.voz,
        mudo: !!x.mudo,
        saldo: x.saldo,
        cambioListo: !!this.passes[x.pid],
        cerrado: !!x.cerrado,
        ganadas: x.ganadas || 0,
        mano: fin && this.partidas > 0 ? x.hand : undefined,
      })),
    };
  }
}

function nombreApuesta(n) {
  return ['sencilla', 'sencilla', 'doble', 'triple', 'cuádruple', 'quíntuple'][n] || `x${n}`;
}

module.exports = { Mesa, nombreApuesta };
