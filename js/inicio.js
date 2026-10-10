/** La app instalada siempre abre en el Dashboard.
 *
 * Por qué hace falta además del start_url del manifiesto: el celular guarda el
 * manifiesto con que se instaló el ícono y lo refresca cuando quiere, no al
 * tiro. Un ícono viejo seguía abriendo en Registrar aunque el sitio ya dijera
 * otra cosa. Esto no depende de nada guardado en el celular: si la app instalada
 * arranca "en frío" en cualquier página que no sea el Dashboard, la manda ahí.
 *
 * "En frío" = la primera página que carga en esta sesión de la app
 * (sessionStorage vive mientras la app esté abierta). Por eso este archivo va en
 * TODAS las páginas: tiene que dejar la marca aunque la app abra bien en el
 * Dashboard, o el primer toque a "Registrar" se leería como un arranque nuevo y
 * te devolvería al Dashboard.
 *
 * Fuera de la app instalada (una pestaña del navegador) no hace nada: ahí
 * respeta la dirección que tipeaste. */
(function () {
  const destinoDeArranque = ({ instalada, primera, archivo }) =>
    instalada && primera && archivo && archivo !== "index.html" && archivo !== "login.html" ? "index.html" : null;

  window.inicioDestino = destinoDeArranque; // expuesto para poder probarlo

  try {
    const instalada =
      ["standalone", "fullscreen", "minimal-ui"].some((m) => matchMedia(`(display-mode: ${m})`).matches) ||
      navigator.standalone === true; // Safari de iOS
    const primera = !sessionStorage.getItem("finanzas_sesion");
    sessionStorage.setItem("finanzas_sesion", "1");
    const archivo = location.pathname.split("/").pop();
    const destino = destinoDeArranque({ instalada, primera, archivo });
    if (destino) location.replace(destino);
  } catch (_) {
    // Sin sessionStorage (navegación privada, políticas): no se redirige. Es
    // preferible abrir donde se pidió que quedar en un bucle de redirecciones.
  }
})();
