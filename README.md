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

## Instalar en el celular

- **Android (Chrome):** abre el enlace, toca el botón "Instalar la app" o el menú ⋮ → "Instalar app".
- **iPhone (Safari):** abre el enlace, toca Compartir → "Agregar a inicio".

## Cómo se arma una partida

1. Uno toca **Crear mesa nueva** y recibe un código de 4 letras.
2. Toca **Invitar** para mandarlo por WhatsApp.
3. Los demás abren el enlace, escriben su nombre y entran.
4. Quien creó la mesa toca **Repartir**.

## Bueno saber

- En el plan gratis de Render, el servidor se duerme tras 15 minutos sin uso. La primera vez que alguien abre la app después de eso puede tardar hasta un minuto en cargar. Mientras haya gente en una mesa, la app lo mantiene despierto.
- Las mesas se guardan en memoria. Si el servidor se duerme o se reinicia, las mesas abiertas se pierden y hay que crear una nueva.
- Si alguien pierde la señal, después de 25 segundos pasa automáticamente para no trabar el juego. Puede volver a entrar con el mismo código y recupera sus cartas.
