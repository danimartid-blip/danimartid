// Shared config for the whole site.
window.APP_CONFIG = {
  // OAuth Web Client ID (Google Cloud project personal-drive-mcp-507305).
  CLIENT_ID: "410252619718-jog7oi0j0cubhfcr8kee8p28kq4g8b3u.apps.googleusercontent.com",
  SPREADSHEET_ID: "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg",
  SCOPES: "https://www.googleapis.com/auth/spreadsheets",
};

/** Unifica las etiquetas que solo difieren en mayúsculas o espacios sobrantes.
 *
 * Por qué existe: por todo el código hay ~25 comparaciones EXACTAS de categoría
 * y subcategoría (`m.categoria === categoria`). Si la planilla tiene "Entel
 * hogar" y "Entel Hogar", para esas comparaciones son dos cosas distintas, y el
 * daño es silencioso: la categoría aparece duplicada en el Dashboard y — esto
 * pasó de verdad — el presupuesto de $24.990 de esa línea se perdió, porque la
 * subcategoría representativa calzaba con la OTRA fila, la que valía $0.
 *
 * Se llama UNA vez al cargar los datos, y a partir de ahí todo el resto del
 * código puede seguir comparando exacto sin tener que acordarse de normalizar.
 * Gana la ortografía más usada; a igualdad de uso, la que parte con mayúscula.
 */
window.Etiquetas = (() => {
  const norm = (s) => (s || "").trim().toLowerCase();
  const empiezaMayus = (s) => (/^[A-ZÁÉÍÓÚÜÑ]/.test(s || "") ? 1 : 0);

  function canonizar(movs = [], presRows = []) {
    const votos = new Map(); // "ambito|normalizado" -> Map(ortografía -> veces)
    const votar = (ambito, valor) => {
      const v = (valor || "").trim();
      if (!v) return;
      const k = `${ambito}|${norm(v)}`;
      if (!votos.has(k)) votos.set(k, new Map());
      const m = votos.get(k);
      m.set(v, (m.get(v) || 0) + 1);
    };

    // Las subcategorías se votan DENTRO de su categoría: "Farmacias" puede
    // escribirse distinto en Salud que en Aseo personal y son cosas distintas.
    for (const m of movs) {
      votar("cat", m.categoria);
      votar(`sub|${norm(m.categoria)}`, m.subcategoria);
      votar("medio", m.medioPago ?? m.medio);
    }
    for (const p of presRows) {
      votar("cat", p.categoria);
      votar(`sub|${norm(p.categoria)}`, p.subcategoria);
    }

    const canon = new Map();
    for (const [k, m] of votos) {
      const mejor = [...m.entries()].sort(
        (a, b) => b[1] - a[1] || empiezaMayus(b[0]) - empiezaMayus(a[0]) || a[0].localeCompare(b[0])
      )[0][0];
      canon.set(k, mejor);
    }
    const dame = (ambito, valor) => {
      const v = (valor || "").trim();
      if (!v) return v;
      return canon.get(`${ambito}|${norm(v)}`) ?? v;
    };

    for (const m of movs) {
      m.categoria = dame("cat", m.categoria);
      m.subcategoria = dame(`sub|${norm(m.categoria)}`, m.subcategoria);
      if (m.medioPago !== undefined) m.medioPago = dame("medio", m.medioPago);
      else if (m.medio !== undefined) m.medio = dame("medio", m.medio);
    }
    for (const p of presRows) {
      p.categoria = dame("cat", p.categoria);
      p.subcategoria = dame(`sub|${norm(p.categoria)}`, p.subcategoria);
    }
    // Los helpers quedan disponibles para canonizar lo que el usuario acaba de
    // tipear ANTES de guardarlo (registro.js) — así la variante no llega nunca
    // a la planilla y el problema no se vuelve a crear.
    return {
      canon,
      dame,
      cat: (v) => dame("cat", v),
      sub: (categoria, v) => dame(`sub|${norm(categoria)}`, v),
      medio: (v) => dame("medio", v),
    };
  }

  return { canonizar, norm };
})();
