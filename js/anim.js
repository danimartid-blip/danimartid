/** Animación de conteo para los números grandes: suben de 0 hasta su valor en
 * menos de un segundo al cargar/recargar la vista. Es puro adorno — si el
 * sistema pide menos movimiento (prefers-reduced-motion) se escribe el valor
 * final de una y listo. */
(function () {
  const DURACION = 850;
  const menosMovimiento = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  /** el: elemento; valor: número final; formato: cómo se escribe (ej. fmtCLP). */
  function numero(el, valor, formato) {
    if (!el) return;
    if (el._animRaf) cancelAnimationFrame(el._animRaf); // re-render en medio: la anterior se descarta
    if (menosMovimiento || !Number.isFinite(valor)) {
      el.textContent = formato(valor);
      return;
    }
    const inicio = performance.now();
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / DURACION);
      const suave = 1 - Math.pow(1 - t, 3); // ease-out: arranca rápido y frena al final
      if (t < 1) {
        el.textContent = formato(valor * suave);
        el._animRaf = requestAnimationFrame(paso);
      } else {
        el._animRaf = null;
        el.textContent = formato(valor); // el valor exacto siempre lo escribe el último paso
      }
    };
    el._animRaf = requestAnimationFrame(paso);
  }

  /** Barras de progreso: se pintan en 0 y en el siguiente frame se sueltan a su
   * ancho real, para que la transición CSS las haga crecer. */
  function barras(scope) {
    if (!scope) return;
    const fills = scope.querySelectorAll(".bar-fill[data-w]");
    if (!fills.length) return;
    const soltar = () => fills.forEach((f) => (f.style.width = `${f.dataset.w}%`));
    if (menosMovimiento) soltar();
    else requestAnimationFrame(() => requestAnimationFrame(soltar));
  }

  window.Anim = { numero, barras };
})();
