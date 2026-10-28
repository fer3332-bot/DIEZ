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

  repartir(pid) {
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
    this.offer = null;
    this.pagoPendiente = null;
    for (const s of this.seats) {
      s.hand = this.deck.splice(0, 9);
      s.melds = [];
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

  ofrecer(c, src, by, to) {
    this.offer = { c, src, by, to, start: to, pasaron: [] };
    this.pagoPendiente = null;
  }

  flip() {
    if (!this.deck.length) {
      this.fase = 'fin';
      this.win = null;
      this.offer = null;
      this.apuesta++;
      this.addLog(`Se acabó el mazo sin ganador: la próxima va ${nombreApuesta(this.apuesta)}`);
      this.ev('empate');
      return;
    }
    const c = this.deck.pop();
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
    const n = this.seats.length;
    let next = (o.to + 1) % n;
    if (o.src === 'pago' && next === o.by) next = (next + 1) % n;
    // Nadie la quiso: se queda en la mesa (se puede obligar) hasta que alguien voltee la siguiente
    o.to = next === o.start ? -1 : next;
  }

  // Quien voltea la siguiente carta (y tendrá prioridad sobre ella)
  quienVoltea() {
    const o = this.offer;
    if (!o || o.to !== -1) return -1;
    return o.src === 'mazo' ? (this.turn + 1) % this.seats.length : this.turn;
  }

  morir() {
    const o = this.offer;
    const n = this.seats.length;
    this.dead.push(o.c);
    this.addLog(`Nadie quiso el ${R.cardName(o.c)}`);
    this.ev('muerta', { c: o.c });
    if (o.src === 'mazo') this.turn = (this.turn + 1) % n;
    this.flip();
  }

  pagar(seat, c) {
    const s = this.seats[seat];
    s.hand.splice(s.hand.indexOf(c), 1);
    this.ev('pago', { seat, c });
    const next = (seat + 1) % this.seats.length;
    this.turn = next;
    this.ofrecer(c, 'pago', seat, next);
  }

  accion(pid, a) {
    const seat = this.seatOf(pid);
    if (seat < 0) return 'No estás sentado en esta mesa';
    const s = this.seats[seat];
    a = a || {};

    if (a.t === 'repartir') return this.repartir(pid);
    if (a.t === 'config') return this.configurar(pid, a);
    if (a.t === 'voz') {
      s.voz = !!a.on;
      s.mudo = !!a.mudo;
      return null;
    }

    if (a.t === 'cambio') {
      if (this.fase !== 'cambio') return 'No es momento de cambio';
      if (this.passes[pid]) return 'Ya elegiste tu carta';
      if (!s.hand.includes(a.c)) return 'Esa carta no está en tu mano';
      this.passes[pid] = a.c;
      if (this.seats.every((x) => this.passes[x.pid])) this.hacerCambio();
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
    const n = this.seats.length;
    const cartas = this.seats.map((x) => this.passes[x.pid]);
    this.seats.forEach((x, i) => x.hand.splice(x.hand.indexOf(cartas[i]), 1));
    this.seats.forEach((x, i) => {
      const dest = this.seats[(i + 1) % n];
      dest.hand.push(cartas[i]);
      this.recibidas[dest.pid] = cartas[i];
    });
    this.fase = 'juego';
    this.turn = (this.dealer + 1) % n;
    this.addLog('Cambio hecho. ¡A jugar!');
    this.ev('cambio');
    this.flip();
  }

  ganar(seat, arr, c) {
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

  // Solo para jugadores DESCONECTADOS: tras unos segundos se juega por ellos lo mínimo
  revisarAusentes() {
    const now = Date.now();
    const ido = (x) => x && !x.conectado && now - x.desdeAusente > AUSENTE_MS;
    let cambio = false;
    for (const x of this.seats) if (!x.conectado && x.voz) { x.voz = false; cambio = true; }
    if (this.fase === 'cambio') {
      for (const x of this.seats)
        if (!this.passes[x.pid] && ido(x)) {
          this.addLog(`${x.name} no tiene señal: se eligió su carta de cambio al azar`);
          this.accion(x.pid, { t: 'cambio', c: x.hand[crypto.randomInt(x.hand.length)] });
          cambio = true;
        }
    }
    if (this.fase !== 'juego') return cambio;
    if (this.pagoPendiente && ido(this.seats[this.pagoPendiente.seat])) {
      const seat = this.pagoPendiente.seat;
      const x = this.seats[seat];
      const ok = R.cartasPagables(x.melds, x.hand);
      const c = ok[crypto.randomInt(ok.length)];
      this.addLog(`${x.name} no tiene señal: se pagó con el ${R.cardName(c)}`);
      this.pagar(seat, c);
      return true;
    }
    if (this.offer && this.offer.to >= 0 && ido(this.seats[this.offer.to])) {
      this.pasar(this.offer.to, true);
      return true;
    }
    const v = this.quienVoltea();
    if (v >= 0 && ido(this.seats[v])) {
      this.addLog(`${this.seats[v].name} no tiene señal: se volteó la siguiente carta`);
      this.morir();
      return true;
    }
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
        mano: fin && this.partidas > 0 ? x.hand : undefined,
      })),
    };
  }
}

function nombreApuesta(n) {
  return ['sencilla', 'sencilla', 'doble', 'triple', 'cuádruple', 'quíntuple'][n] || `x${n}`;
}

module.exports = { Mesa, nombreApuesta };
