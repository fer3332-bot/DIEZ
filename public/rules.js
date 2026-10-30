/* Reglas del juego "Diez" — compartidas entre servidor y app.
   Cartas como texto de 2 letras: rango (A23456789TJQK) + palo (s=♠ h=♥ d=♦ c=♣). */
(function (root) {
  const RANKS = 'A23456789TJQK';
  const SUITS = 'shdc';
  const SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const CODE_RE = /^[A2-9TJQK][shdc]$/;

  const rv = (c) => RANKS.indexOf(c[0]) + 1; // A=1 ... K=13
  const rankLabel = (c) => (c[0] === 'T' ? '10' : c[0]);
  const cardName = (c) => rankLabel(c) + SYM[c[1]];

  function newDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    return d;
  }

  // Tercia/grupo: 3 o 4 cartas del mismo valor, palos distintos.
  // Corrida: 3+ cartas consecutivas del mismo palo. El As solo va abajo (A-2-3), K es la mayor.
  function isMeld(cards) {
    if (!Array.isArray(cards) || cards.length < 3) return false;
    if (new Set(cards).size !== cards.length) return false;
    const r = cards.map(rv);
    if (r.every((x) => x === r[0])) {
      return cards.length <= 4 && new Set(cards.map((c) => c[1])).size === cards.length;
    }
    const suit = cards[0][1];
    if (!cards.every((c) => c[1] === suit)) return false;
    const s = [...r].sort((a, b) => a - b);
    return s.every((x, i) => i === 0 || x === s[i - 1] + 1);
  }

  function sortMeld(m) {
    return [...m].sort((a, b) => rv(a) - rv(b) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]));
  }

  function sortHand(h, mode) {
    return [...h].sort((a, b) =>
      mode === 'numero'
        ? rv(a) - rv(b) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1])
        : SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]) || rv(a) - rv(b)
    );
  }

  function subsets(arr, minSize) {
    const out = [];
    const n = arr.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const s = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(arr[i]);
      if (s.length >= minSize) out.push(s);
    }
    return out;
  }

  /* Formas de usar un juego expuesto al ganar: completo, o desmochado (se sacan cartas
     y lo que queda sigue siendo juego válido). Las cartas sacadas quedan libres. */
  function variantes(m) {
    const out = [{ nucleos: [m.slice()], libres: [] }];
    const r = m.map(rv);
    if (r.every((x) => x === r[0])) {
      if (m.length === 4) for (const c of m) out.push({ nucleos: [m.filter((x) => x !== c)], libres: [c] });
      return out;
    }
    const sm = sortMeld(m);
    const n = sm.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 3; j <= n; j++) {
        if (i === 0 && j === n) continue;
        out.push({ nucleos: [sm.slice(i, j)], libres: [...sm.slice(0, i), ...sm.slice(j)] });
      }
    // una corrida larga partida en dos juegos
    for (let k = 3; k <= n - 3; k++) out.push({ nucleos: [sm.slice(0, k), sm.slice(k)], libres: [] });
    return out;
  }

  /* ¿Se puede ganar? Las 10 cartas (juegos expuestos + mano) deben quedar TODAS en
     combinaciones válidas. Los juegos expuestos pueden recibir cartas de la mano y también
     se pueden desmochar (sacarles cartas) si siguen siendo válidos. Devuelve los juegos o null. */
  function winArrangement(melds, hand) {
    const total = melds.reduce((a, m) => a + m.length, 0) + hand.length;
    if (total !== 10) return null;
    function solve(us) {
      if (!us.length) return [];
      const [first, ...rest] = us;
      for (const pick of subsets(rest, 0)) {
        const cards = first.concat(...pick);
        if (!isMeld(cards)) continue;
        const remaining = rest.filter((u) => !pick.includes(u));
        const r = solve(remaining);
        if (r) return [sortMeld(cards), ...r];
      }
      return null;
    }
    const opciones = melds.map(variantes);
    const idx = melds.map(() => 0);
    for (;;) {
      const nucleos = [], libres = [];
      opciones.forEach((ops, k) => { const v = ops[idx[k]]; nucleos.push(...v.nucleos.map((x) => x.slice())); libres.push(...v.libres); });
      const res = solve([...nucleos, ...[...libres, ...hand].map((c) => [c])]);
      if (res) return res;
      let k = 0;
      while (k < idx.length && ++idx[k] >= opciones[k].length) { idx[k] = 0; k++; }
      if (k >= idx.length) return null;
    }
  }

  /* Tomar la carta c: o se forma un juego nuevo con cartas de la mano (use, mínimo 2),
     o se agrega a uno de mis juegos expuestos (ext), opcionalmente con más cartas de la mano. */
  // ¿Se puede sacar la carta d del juego m y que el juego siga siendo válido?
  function removible(m, d) {
    if (!Array.isArray(m) || !m.includes(d)) return false;
    return isMeld(m.filter((x) => x !== d));
  }

  /* Desmoche: des = {m: índice de MI juego expuesto, c: carta que saco de ese juego}.
     Esa carta + al menos 1 de mi mano + la carta de afuera forman un juego NUEVO que se expone. */
  function applyTake(melds, hand, c, use, ext, des) {
    use = Array.isArray(use) ? use : [];
    const nm = melds.map((m) => m.slice());
    const h = hand.slice();
    if (new Set(use).size !== use.length || !use.every((x) => h.includes(x)))
      return { err: 'Cartas inválidas' };
    if (des && typeof des === 'object') {
      const i = Number(des.m);
      const m = nm[i];
      if (!m || !m.includes(des.c)) return { err: 'Esa carta no está en tus juegos' };
      if (!removible(m, des.c)) return { err: 'Si sacas el ' + cardName(des.c) + ' ese juego deja de ser válido' };
      if (use.length < 1) return { err: 'Para desmochar elige también al menos 1 carta de tu mano' };
      const nuevo = [...use, c, des.c];
      if (!isMeld(nuevo)) return { err: 'Esas cartas no forman juego con ' + cardName(c) };
      nm[i] = sortMeld(m.filter((x) => x !== des.c));
      nm.push(sortMeld(nuevo));
      use.forEach((x) => h.splice(h.indexOf(x), 1));
      return { melds: nm, hand: h, desmoche: true };
    }
    if (ext !== null && ext !== undefined && ext !== '') {
      const i = Number(ext);
      const m = nm[i];
      if (!m) return { err: 'Ese juego no existe' };
      const cards = [...m, c, ...use];
      if (!isMeld(cards)) return { err: cardName(c) + ' no encaja en ese juego' };
      nm[i] = sortMeld(cards);
    } else {
      if (use.length < 2) return { err: 'Elige al menos 2 cartas de tu mano' };
      if (!isMeld([...use, c])) return { err: 'Esas cartas no forman juego con ' + cardName(c) };
      nm.push(sortMeld([...use, c]));
    }
    use.forEach((x) => h.splice(h.indexOf(x), 1));
    return { melds: nm, hand: h };
  }

  // ¿Me sirve la carta c? (alguna forma válida de tomarla)
  function canUse(melds, hand, c) {
    for (let i = 0; i < melds.length; i++) if (isMeld([...melds[i], c])) return true;
    const n = hand.length;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        if (isMeld([hand[a], hand[b], c])) return true;
        for (let d = b + 1; d < n; d++) if (isMeld([hand[a], hand[b], hand[d], c])) return true;
      }
    // agregar a un juego expuesto junto con cartas de la mano (ej. 6-7-8 + 9 de la mano + 10)
    for (let i = 0; i < melds.length; i++)
      for (let a = 0; a < n; a++) {
        if (isMeld([...melds[i], c, hand[a]])) return true;
        for (let b = a + 1; b < n; b++) if (isMeld([...melds[i], c, hand[a], hand[b]])) return true;
      }
    return opcionesDesmoche(melds, hand, c).length > 0;
  }

  // Cartas de mis juegos que se pueden desmochar para usar con c
  function opcionesDesmoche(melds, hand, c) {
    const out = [];
    const n = hand.length;
    melds.forEach((m, i) => {
      for (const d of m) {
        if (!removible(m, d)) continue;
        let sirve = false;
        for (let a = 0; a < n && !sirve; a++) {
          if (isMeld([c, d, hand[a]])) sirve = true;
          for (let b = a + 1; b < n && !sirve; b++) if (isMeld([c, d, hand[a], hand[b]])) sirve = true;
        }
        if (sirve) out.push({ m: i, c: d });
      }
    });
    return out;
  }

  // Al pagar NO se puede soltar:
  //  · una carta que encaja en uno de MIS juegos expuestos;
  //  · una carta que haría ganar a un jugador TENDIDO (todo expuesto esperando la carta 10).
  // Si no queda otra opción, primero se permite la que hace ganar al tendido; si tampoco, cualquiera.
  function encajaEnJuegos(melds, c) {
    return melds.findIndex((m) => isMeld([...m, c]));
  }
  function haceGanar(tendidos, c) {
    return (tendidos || []).findIndex((t) => winArrangement(t.melds || t, [c]));
  }
  function cartasPagables(melds, hand, tendidos) {
    const noMia = hand.filter((c) => encajaEnJuegos(melds, c) < 0);
    const libres = noMia.filter((c) => haceGanar(tendidos, c) < 0);
    if (libres.length) return libres;
    if (noMia.length) return noMia;
    return hand.slice();
  }
  function errorPago(melds, hand, c, tendidos) {
    if (!hand.includes(c)) return 'Esa carta no está en tu mano';
    if (cartasPagables(melds, hand, tendidos).includes(c)) return null;
    const i = encajaEnJuegos(melds, c);
    if (i >= 0) return `No puedes pagar con el ${cardName(c)}: encaja en tu juego ${melds[i].map(cardName).join(' ')}`;
    const t = tendidos[haceGanar(tendidos, c)];
    return `No puedes pagar con el ${cardName(c)}: haría ganar a ${t.name || 'un jugador tendido'}. Elige otra carta`;
  }

  const api = { encajaEnJuegos, haceGanar, cartasPagables, errorPago, RANKS, SUITS, SYM, CODE_RE, rv, rankLabel, cardName, newDeck, isMeld, sortMeld, sortHand, winArrangement, applyTake, canUse, removible, opcionesDesmoche };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Reglas = api;
})(typeof self !== 'undefined' ? self : this);
