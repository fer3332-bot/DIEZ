// Lógica de una mesa. El servidor es la única autoridad: guarda el mazo y las manos.
const crypto = require('crypto');
const R = require('./public/rules.js');

const MAX = 4;
const AUSENTE_MS = 25000; // tras este tiempo sin conexión, el jugador pasa automáticamente

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
    this.offer = { c, src: 'mazo', by: -1, to: this.turn, start: this.turn };
    this.ev('flip', { c, seat: this.turn });
  }

  advance() {
    const n = this.seats.length;
    const o = this.offer;
    let next = (o.to + 1) % n;
    if (o.src === 'pago' && next === o.by) next = (next + 1) % n;
    if (next === o.start) {
      this.dead.push(o.c);
      this.addLog(`Nadie quiso el ${R.cardName(o.c)}`);
      this.ev('muerta', { c: o.c });
      if (o.src === 'mazo') this.turn = (this.turn + 1) % n;
      this.flip();
    } else {
      o.to = next;
    }
  }

  accion(pid, a) {
    const seat = this.seatOf(pid);
    if (seat < 0) return 'No estás sentado en esta mesa';
    const s = this.seats[seat];
    const n = this.seats.length;
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

    if (this.fase !== 'juego' || !this.offer) return 'No es momento de jugar';
    const o = this.offer;
    if (o.to !== seat) return 'No es tu turno de decidir';

    if (a.t === 'pasar') {
      this.addLog(`${s.name} pasó el ${R.cardName(o.c)}`);
      this.ev('pasa', { seat, c: o.c });
      this.advance();
      return null;
    }

    if (a.t === 'ganar') {
      const arr = R.winArrangement(s.melds, [...s.hand, o.c]);
      if (!arr) return 'Todavía no puedes ganar con esa carta';
      this.ganar(seat, arr, o.c);
      return null;
    }

    if (a.t === 'tomar') {
      const res = R.applyTake(s.melds, s.hand, o.c, a.use, a.ext, a.des);
      if (res.err) return res.err;
      const arr = R.winArrangement(res.melds, res.hand);
      if (arr) {
        s.melds = res.melds;
        s.hand = res.hand;
        this.ganar(seat, arr, o.c);
        return null;
      }
      if (!res.hand.includes(a.pay)) return 'Elige con qué carta pagas';
      res.hand.splice(res.hand.indexOf(a.pay), 1);
      s.melds = res.melds;
      s.hand = res.hand;
      this.addLog(`${s.name} tomó el ${R.cardName(o.c)}` + (res.desmoche ? ` desmochando el ${R.cardName(a.des.c)}` : '') + ` y pagó con ${R.cardName(a.pay)}`);
      this.ev('toma', { seat, c: o.c, des: res.desmoche ? a.des.c : undefined });
      this.ev('pago', { seat, c: a.pay });
      const next = (seat + 1) % n;
      this.turn = next;
      this.offer = { c: a.pay, src: 'pago', by: seat, to: next, start: next };
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
    this.addLog(`🏆 ¡${this.seats[seat].name} ganó con el ${R.cardName(c)}!` + (premio ? ` Se lleva ${lps(premio)}` : this.apuesta > 1 ? ` (iba ${nombreApuesta(this.apuesta)})` : ''));
    this.ev('gana', { seat, c, premio });
    this.apuesta = 1;
  }

  revisarAusentes() {
    const now = Date.now();
    const ido = (x) => !x.conectado && now - x.desdeAusente > AUSENTE_MS;
    let cambio = false;
    for (const x of this.seats) if (!x.conectado && x.voz) { x.voz = false; cambio = true; }
    if (this.fase === 'cambio') {
      for (const x of this.seats)
        if (!this.passes[x.pid] && ido(x)) {
          this.addLog(`${x.name} no está: se eligió su carta de cambio al azar`);
          this.accion(x.pid, { t: 'cambio', c: x.hand[crypto.randomInt(x.hand.length)] });
          cambio = true;
        }
    }
    if (this.fase === 'juego' && this.offer) {
      const x = this.seats[this.offer.to];
      if (x && ido(x)) {
        this.addLog(`${x.name} no está conectado: pasa automáticamente`);
        this.ev('pasa', { seat: this.offer.to, c: this.offer.c });
        this.advance();
        cambio = true;
      }
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
