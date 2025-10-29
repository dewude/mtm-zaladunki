// script.js - wspólne funkcje
async function loadAwizacje() {
  const res = await fetch("/api/awizacje");
  const arr = await res.json();
  const container = document.getElementById("listaAwizacji") || document.getElementById("lista");
  if (!container) return;
  container.innerHTML = "";
  arr.forEach(a => {
    const div = document.createElement("div");
    div.innerHTML = `
      <strong>${a.nr_zam}</strong> (${a.nazwa_zam}) - ${a.numer_auta} <br>
      Palet: ${a.ilosc_palet} | Zeskanowane: ${a.zeskanowane} | Status: ${a.status} <br>
      <button onclick="openWorker(${a.id})">Otwórz (Pracownik)</button>
      <button onclick="drukuj(${a.id})">Drukuj QR</button>
      <button onclick="dodajPalete(${a.id})">Dodaj paletę</button>
    `;
    container.appendChild(div);
  });
}

document.getElementById('formAwizacja')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    numer_auta: f.numer_auta.value,
    kierowca: f.kierowca.value,
    telefon: f.telefon.value,
    nazwa_zam: f.nazwa_zam.value,
    nr_zam: f.nr_zam.value,
    data_awiz: f.data.value || '',
    godzina_awiz: f.godzina.value || '',
    ilosc_palet: f.ilosc_palet.value || 1
  };
  const res = await fetch("/api/awizacje", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await res.json();
  if (j.status === "ok") {
    alert("Dodano awizację");
    f.reset();
    loadAwizacje();
  } else {
    alert("Błąd: " + (j.error || j.message));
  }
});

async function drukuj(awId) {
  window.open(`/api/drukuj_qr/${awId}`, "_blank");
}

function openWorker(id) {
  // Przekieruj do worker view (możesz przekazać id param)
  window.location.href = "/app_worker.html";
}

async function dodajPalete(awId) {
  const name = prompt("Nazwa palety (np. Paleta 7):");
  if (!name) return;
  const res = await fetch("/api/palety", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ awizacja_id: awId, paleta_nazwa: name })});
  const j = await res.json();
  if (j.status === "ok") {
    alert("Dodano paletę.");
    loadAwizacje();
  } else {
    alert("Błąd: " + (j.error || j.msg));
  }
}

// autoload on pages that show lists
document.addEventListener("DOMContentLoaded", () => {
  loadAwizacje();
  setInterval(loadAwizacje, 5000);
});
