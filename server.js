// Servidor del juego "Diez". Sin dependencias: solo Node.js (18 o más reciente).
// Tiempo real con Server-Sent Events (GET /api/stream) + acciones por POST.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Mesa } = require('./game.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const mesas = new Map(); // code -> Mesa
const clientes = new Map(); // code -> Set<{pid,res}>

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const PID_RE = /^[a-zA-Z0-9]{8,40}$/;
const CODE_ALFA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function nuevoCodigo() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALFA[crypto.randomInt(CODE_ALFA.length)];
    if (!mesas.has(c)) return c;
  }
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function leerBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (ch) => {
      data += ch;
      if (data.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function actualizarConexion(mesa) {
  const set = clientes.get(mesa.code) || new Set();
  const conectados = new Set([...set].map((c) => c.pid));
  for (const s of mesa.seats) {
    const ahora = conectados.has(s.pid);
    if (s.conectado && !ahora) s.desdeAusente = Date.now();
    s.conectado = ahora;
  }
}

function difundir(mesa) {
  mesa.version++;
  mesa.ultimaActividad = Date.now();
  actualizarConexion(mesa);
  const set = clientes.get(mesa.code);
  if (!set) return;
  for (const cli of set) enviar(cli, mesa);
}

function enviar(cli, mesa) {
  try {
    cli.res.write(`event: estado\ndata: ${JSON.stringify(mesa.vista(cli.pid))}\n\n`);
  } catch {}
}

function servirEstatico(req, res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'no' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // rutas desconocidas -> la app (para enlaces tipo /?mesa=ABCD)
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, b2) => {
        if (e2) return json(res, 404, { error: 'No encontrado' });
        res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
        res.end(b2);
      });
    }
    const ext = path.extname(file);
    const headers = { 'Content-Type': TIPOS[ext] || 'application/octet-stream' };
    headers['Cache-Control'] = url === '/sw.js' ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, headers);
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  if (req.method === 'GET' && u.pathname === '/api/stream') {
    const code = String(u.searchParams.get('mesa') || '').toUpperCase();
    const pid = String(u.searchParams.get('pid') || '');
    const mesa = mesas.get(code);
    if (!mesa || !PID_RE.test(pid)) return json(res, 404, { error: 'Mesa no encontrada' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const cli = { pid, res };
    if (!clientes.has(code)) clientes.set(code, new Set());
    clientes.get(code).add(cli);
    difundir(mesa);
    const latido = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 20000);
    req.on('close', () => {
      clearInterval(latido);
      clientes.get(code)?.delete(cli);
      difundir(mesa);
    });
    return;
  }

  if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
    const b = await leerBody(req);
    const pid = String(b.pid || '');
    if (!PID_RE.test(pid)) return json(res, 400, { error: 'Identificador inválido' });

    if (u.pathname === '/api/crear') {
      const code = nuevoCodigo();
      const mesa = new Mesa(code);
      mesas.set(code, mesa);
      mesa.unirse(pid, b.name);
      return json(res, 200, { ok: true, code });
    }

    const code = String(b.code || '').toUpperCase().trim();
    const mesa = mesas.get(code);
    if (!mesa) return json(res, 404, { error: 'No existe una mesa con ese código' });

    if (u.pathname === '/api/unirse') {
      const r = mesa.unirse(pid, b.name);
      difundir(mesa);
      return json(res, 200, { ok: true, code, espectador: !!r.espectador });
    }
    if (u.pathname === '/api/salir') {
      mesa.salir(pid);
      difundir(mesa);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/accion') {
      const err = mesa.accion(pid, b.a);
      if (!err) difundir(mesa);
      return json(res, 200, err ? { ok: false, error: err } : { ok: true });
    }
    return json(res, 404, { error: 'Ruta desconocida' });
  }

  if (req.method === 'GET' && u.pathname === '/salud') return json(res, 200, { ok: true, mesas: mesas.size });

  if (req.method === 'GET') return servirEstatico(req, res);
  json(res, 405, { error: 'Método no permitido' });
});

// Jugadores ausentes y limpieza de mesas abandonadas
setInterval(() => {
  const now = Date.now();
  for (const [code, mesa] of mesas) {
    actualizarConexion(mesa);
    if (mesa.revisarAusentes()) difundir(mesa);
    const nadie = !(clientes.get(code)?.size);
    if (nadie && now - mesa.ultimaActividad > 6 * 3600 * 1000) {
      mesas.delete(code);
      clientes.delete(code);
    }
  }
}, 3000);

server.listen(PORT, () => console.log(`Diez listo en http://localhost:${PORT}`));
module.exports = { server, mesas };
