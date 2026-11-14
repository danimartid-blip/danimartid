// Bloqueo con clave de 4 dígitos, por dispositivo. Va al inicio del <body>
// para tapar la pantalla antes de que se pinte algún dato.
//   <script src="js/pin.js" data-app="ictus" data-token="ictus_token_rw"></script>
// La clave se guarda como hash (SHA-256 con sal) en localStorage. Es una traba
// para quien tome el aparato: los datos siguen protegidos por el login de Google.
// "Olvidé mi clave" o 5 intentos fallidos borran la clave y la sesión de Google.
(function () {
  const script = document.currentScript;
  const APP = script.dataset.app;
  const TOKEN_KEY = script.dataset.token;
  const K_HASH = APP + "_pin_hash";
  const K_SAL = APP + "_pin_sal";
  const K_FALLOS = APP + "_pin_fallos";
  const K_ABIERTO = APP + "_pin_abierto"; // sessionStorage: hora de la última actividad
  const MINUTOS_GRACIA = 2; // fuera de la app más de esto, vuelve a pedir la clave
  const MAX_FALLOS = 5;

  const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const borrar = (k) => { try { localStorage.removeItem(k); } catch {} };

  function marcarActividad() {
    try { sessionStorage.setItem(K_ABIERTO, String(Date.now())); } catch {}
  }
  function sigueAbierto() {
    try {
      const t = Number(sessionStorage.getItem(K_ABIERTO));
      return t && Date.now() - t < MINUTOS_GRACIA * 60000;
    } catch { return false; }
  }

  async function hash(pin, sal) {
    const datos = new TextEncoder().encode(sal + ":" + pin);
    const buf = await crypto.subtle.digest("SHA-256", datos);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  const css = `
  .pin-velo { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center;
    background: var(--pin-fondo, #111); color: #fff; font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom); }
  .pin-caja { width: 100%; max-width: 320px; display: grid; justify-items: center; gap: 18px; }
  .pin-caja h2 { margin: 0; font-size: 20px; font-weight: 700; text-align: center; }
  .pin-caja p { margin: 0; font-size: 14px; opacity: .75; text-align: center; min-height: 20px; }
  .pin-caja p.error { color: #ff8a8a; opacity: 1; }
  .pin-puntos { display: flex; gap: 16px; }
  .pin-puntos i { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.7); }
  .pin-puntos i.lleno { background: var(--pin-acento, #fff); border-color: var(--pin-acento, #fff); }
  .pin-puntos.temblor { animation: pinTemblor .35s; }
  @keyframes pinTemblor { 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
  .pin-teclado { display: grid; grid-template-columns: repeat(3, 72px); gap: 14px; }
  .pin-teclado button { height: 72px; border-radius: 50%; border: 0; background: rgba(255,255,255,.12); color: #fff;
    font-size: 26px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .pin-teclado button:active { background: rgba(255,255,255,.28); }
  .pin-teclado button.texto { background: none; font-size: 14px; font-weight: 600; }
  .pin-olvide { background: none; border: 0; color: #fff; opacity: .7; font-size: 13px; text-decoration: underline; cursor: pointer; }
  `;
  const estilo = document.createElement("style");
  estilo.textContent = css;
  document.head.appendChild(estilo);

  const velo = document.createElement("div");
  velo.className = "pin-velo";
  velo.innerHTML = `
    <div class="pin-caja">
      <h2 id="pinTitulo"></h2>
      <div class="pin-puntos" id="pinPuntos"><i></i><i></i><i></i><i></i></div>
      <p id="pinMsg"></p>
      <div class="pin-teclado">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join("")}
        <span></span><button type="button" data-n="0">0</button>
        <button type="button" class="texto" data-borrar aria-label="Borrar">Borrar</button>
      </div>
      <button type="button" class="pin-olvide" id="pinOlvide">Olvidé mi clave</button>
    </div>`;

  const $ = (id) => velo.querySelector("#" + id);
  let escrito = "";
  let modo = "entrar"; // entrar | crear | confirmar
  let primera = "";

  function pintarPuntos() {
    velo.querySelectorAll(".pin-puntos i").forEach((i, k) => i.classList.toggle("lleno", k < escrito.length));
  }
  function mensaje(txt, error) {
    $("pinMsg").textContent = txt || "";
    $("pinMsg").classList.toggle("error", !!error);
  }
  function temblor() {
    const p = $("pinPuntos");
    p.classList.remove("temblor");
    void p.offsetWidth;
    p.classList.add("temblor");
  }
  function poner(m) {
    modo = m;
    escrito = "";
    pintarPuntos();
    $("pinTitulo").textContent = { entrar: "Ingresa tu clave", crear: "Crea una clave de 4 dígitos", confirmar: "Repite la clave" }[m];
    $("pinOlvide").hidden = m !== "entrar";
  }

  function bloquear() {
    if (velo.isConnected) return;
    poner(leer(K_HASH) ? "entrar" : "crear");
    mensaje(modo === "crear" ? "Se pedirá cada vez que abras la app en este aparato." : "");
    document.body.prepend(velo);
    document.documentElement.style.overflow = "hidden";
  }
  function desbloquear() {
    velo.remove();
    document.documentElement.style.overflow = "";
    marcarActividad();
  }

  function olvidarTodo() {
    borrar(K_HASH); borrar(K_SAL); borrar(K_FALLOS);
    if (TOKEN_KEY) borrar(TOKEN_KEY);
    try { sessionStorage.removeItem(K_ABIERTO); } catch {}
    location.replace("login.html");
  }

  async function completo() {
    const pin = escrito;
    if (modo === "crear") {
      primera = pin;
      poner("confirmar");
      mensaje("");
      return;
    }
    if (modo === "confirmar") {
      if (pin !== primera) {
        temblor();
        poner("crear");
        mensaje("No coinciden. Empecemos de nuevo.", true);
        return;
      }
      const sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      guardar(K_SAL, sal);
      guardar(K_HASH, await hash(pin, sal));
      guardar(K_FALLOS, "0");
      desbloquear();
      return;
    }
    if ((await hash(pin, leer(K_SAL) || "")) === leer(K_HASH)) {
      guardar(K_FALLOS, "0");
      desbloquear();
      return;
    }
    const fallos = Number(leer(K_FALLOS) || 0) + 1;
    guardar(K_FALLOS, String(fallos));
    if (fallos >= MAX_FALLOS) return olvidarTodo();
    temblor();
    escrito = "";
    pintarPuntos();
    mensaje(`Clave incorrecta. Te quedan ${MAX_FALLOS - fallos} intentos.`, true);
  }

  function tecla(n) {
    if (escrito.length >= 4) return;
    escrito += n;
    pintarPuntos();
    if (escrito.length === 4) setTimeout(completo, 120);
  }

  velo.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.n !== undefined) tecla(b.dataset.n);
    else if (b.hasAttribute("data-borrar")) { escrito = escrito.slice(0, -1); pintarPuntos(); }
    else if (b.id === "pinOlvide" &&
      confirm("Se borrará la clave y tendrás que volver a conectar tu cuenta de Google. ¿Seguir?")) olvidarTodo();
  });
  document.addEventListener("keydown", (e) => {
    if (!velo.isConnected) return;
    if (/^[0-9]$/.test(e.key)) tecla(e.key);
    else if (e.key === "Backspace") { escrito = escrito.slice(0, -1); pintarPuntos(); }
  });

  // Mientras la app está a la vista se cuenta como actividad; al volver tras
  // más de MINUTOS_GRACIA fuera, se bloquea de nuevo.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { if (!velo.isConnected) marcarActividad(); }
    else if (!sigueAbierto()) bloquear();
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted && !sigueAbierto()) bloquear(); });
  setInterval(() => { if (!velo.isConnected && document.visibilityState === "visible") marcarActividad(); }, 30000);

  // Sin sesión de Google la página se va sola al login: no hay nada que tapar.
  if (TOKEN_KEY && !leer(TOKEN_KEY)) return;
  if (sigueAbierto()) marcarActividad();
  else bloquear();
})();
