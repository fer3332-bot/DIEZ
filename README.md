# Diez · juego de cartas en línea

App web instalable (PWA) para jugar **Diez** con 2 a 4 amigos, cada quien desde su celular (Android o iPhone).

- `server.js`: servidor de partidas. Usa solo Node.js, sin librerías externas.
- `game.js`: lógica de la mesa. El servidor guarda el mazo y las manos, así nadie ve las cartas de los demás.
- `public/`: la app (pantallas, reglas, íconos, manifest y service worker).

## Probar en tu computadora

Necesitas Node.js 18 o más reciente.

```
npm start
```

Abre http://localhost:3000

## Publicar gratis en Render

1. Crea una cuenta en https://github.com y un repositorio nuevo, por ejemplo `diez`.
2. En el repositorio toca **Add file → Upload files** y arrastra TODO el contenido de esta carpeta: `server.js`, `game.js`, `package.json`, `README.md` y la carpeta `public`. Luego toca **Commit changes**.
3. Crea una cuenta en https://render.com (puedes entrar con tu cuenta de GitHub).
4. Toca **New → Web Service** y elige tu repositorio `diez`.
5. Configura:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
6. Toca **Deploy**. En 1 o 2 minutos te da un enlace como `https://diez-xxxx.onrender.com`.

Ese enlace es el que compartes con tus amigos.

## Audio entre jugadores: servidor TURN de Cloudflare (gratis)

Sin un servidor TURN el audio solo funciona si todos están en la misma red Wi‑Fi. Cloudflare da 1,000 GB gratis al mes, muchísimo para el audio de una mesa.

1. Crea una cuenta en https://dash.cloudflare.com (no necesitas dominio).
2. En el menú de la izquierda busca **Realtime** → **TURN Server** y toca **Create** (ponle de nombre `diez`).
3. Cloudflare te muestra dos datos: **Turn Token ID** y **API Token**. Cópialos y guárdalos: el API Token no se vuelve a mostrar.
4. En Render, abre tu servicio → **Environment** → **Add Environment Variable** y agrega:
   - `CF_TURN_KEY_ID` = el Turn Token ID
   - `CF_TURN_API_TOKEN` = el API Token
5. Toca **Save Changes**. Render reinicia el servidor solo.
6. Para comprobarlo: en la app entra al audio y toca el botón 🔊. Debe decir **"Servidor TURN: activo ✔"**.

El API Token queda guardado solo en el servidor; los teléfonos reciben credenciales temporales que vencen en 24 horas.

(Alternativa: cualquier otro TURN con usuario y contraseña fijos se configura con `TURN_URL`, `TURN_USER` y `TURN_PASS`.)

## Instalar en el celular

- **Android (Chrome):** abre el enlace, toca el botón "Instalar la app" o el menú ⋮ → "Instalar app".
- **iPhone (Safari):** abre el enlace, toca Compartir → "Agregar a inicio".

## Cómo se arma una partida

1. Uno toca **Crear mesa nueva** y recibe un código de 4 letras.
2. Toca **Invitar** para mandarlo por WhatsApp.
3. Los demás abren el enlace, escriben su nombre y entran.
4. Quien creó la mesa toca **Repartir**.

## Lo nuevo

- **Mesa con animaciones:** las cartas vuelan del mazo, de un jugador a otro y a los juegos bajados.
- **Fotos:** cada jugador toca su círculo en la pantalla de inicio para poner su foto.
- **Micrófono abierto:** botón "Audio" arriba. Se puede silenciar. Un aro verde marca a quien está hablando.
- **Apuestas en lempiras de juego:** quien crea la mesa las activa antes de repartir: apuesta por partida y saldo inicial. Todos ponen la apuesta en el pozo al repartir; si nadie gana, el pozo se queda y "va doble". Quien gana se lleva el pozo. Los saldos pueden quedar en negativo.

## Bueno saber

- En el plan gratis de Render, el servidor se duerme tras 15 minutos sin uso. La primera vez que alguien abre la app después de eso puede tardar hasta un minuto en cargar. Mientras haya gente en una mesa, la app lo mantiene despierto.
- Las mesas se guardan en memoria. Si el servidor se duerme o se reinicia, las mesas abiertas se pierden y hay que crear una nueva.
- El audio solo funciona con la app abierta en pantalla. iPhone y Android lo cortan cuando la app pasa a segundo plano.
- No hay reloj para quien está conectado. Si alguien pierde la señal cuando le toca, a los 5 segundos se cierra y el juego sigue sin él (su apuesta queda en el pozo). Puede volver a entrar con el mismo código para mirar.
- **Me cierro:** cualquier jugador puede cerrarse en una partida; la ve, sigue en la apuesta y las cartas pasan al siguiente.
- **Audio:** el botón 🔊 muestra con cuántos estás conectado y el estado con cada uno.
