const $ = (id) => document.getElementById(id);

function nextPage() {
  const params = new URLSearchParams(location.search);
  return params.get("next") || "registro.html";
}

async function init() {
  // Already logged in (e.g. opened login.html directly by mistake) — skip straight through.
  if (window.SheetsAuth.isLoggedIn()) {
    location.replace(nextPage());
    return;
  }

  $("loginBtn").addEventListener("click", async () => {
    $("loginBtn").disabled = true;
    $("loginBtn").textContent = "Conectando…";
    try {
      await window.SheetsAuth.getAccessToken();
      $("statusText").textContent = "Listo ✓";
      location.replace(nextPage());
    } catch (err) {
      console.error(err);
      $("statusText").textContent = "No se pudo conectar. Intenta de nuevo.";
      $("loginBtn").disabled = false;
      $("loginBtn").textContent = "Conectar con Google";
    }
  });
}

init();
