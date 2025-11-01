async function loadAwizacje() {
  const res = await fetch("/api/awizacje");
  const arr = await res.json();
  const container = document.getElementById("listaAwizacji") || document.getElementById("lista");
  if (!container) return;
  container.innerHTML = "";
  arr.forEach(a => {
    const div = document.createElement("div");
    div.innerHTML = `<strong>${a.nr_zam}</strong> (${a.nazwa_zam}) - ${a.numer_auta}<br>
    Palet: ${a.ilosc_palet || 0} | Zeskanowane: ${a.zeskanowane || 0} | Status: ${a.status}<br>
    <button onclick="drukuj(${a.id})">Drukuj QR</button>`;
    container.appendChild(div);
  });
}

document.getElementById('formAwizacja')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    nr_zam: f.nr_zam.value,
    nazwa_zam: f.nazwa_zam.value,
    numer_auta: f.numer_auta.value,
    kierowca: f.kierowca.value,
    telefon: f.telefon.value,
    data_awiz: f.data.value,
    godzina_awiz: f.godzina.value,
    ilosc_palet: f.ilosc_palet.value
  };
  const res = await fetch("/api/awizacje", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await res.json();
  if (j.status === "ok") { alert("Dodano awizację"); f.reset(); loadAwizacje(); }
});

async function drukuj(id) { window.open(`/api/drukuj_qr/${id}`, "_blank"); }

document.addEventListener("DOMContentLoaded", loadAwizacje);