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

  /* ¿Se puede ganar? Las 10 cartas (juegos expuestos + mano) deben quedar
     TODAS en combinaciones válidas. Los juegos expuestos no se separan, pero
     pueden recibir cartas de la mano al ganar. Devuelve el arreglo de juegos o null. */
  function winArrangement(melds, hand) {
    const total = melds.reduce((a, m) => a + m.length, 0) + hand.length;
    if (total !== 10) return null;
    const units = [...melds.map((m) => m.slice()), ...hand.map((c) => [c])];
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
    return solve(units);
  }

  /* Tomar la carta c: o se forma un juego nuevo con cartas de la mano (use, mínimo 2),
     o se agrega a uno de mis juegos expuestos (ext), opcionalmente con más cartas de la mano. */
  function applyTake(melds, hand, c, use, ext) {
    use = Array.isArray(use) ? use : [];
    const nm = melds.map((m) => m.slice());
    const h = hand.slice();
    if (new Set(use).size !== use.length || !use.every((x) => h.includes(x)))
      return { err: 'Cartas inválidas' };
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
    return false;
  }

  const api = { RANKS, SUITS, SYM, CODE_RE, rv, rankLabel, cardName, newDeck, isMeld, sortMeld, sortHand, winArrangement, applyTake, canUse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Reglas = api;
})(typeof self !== 'undefined' ? self : this);
