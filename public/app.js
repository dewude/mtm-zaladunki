async function loadAwizacje(status) {
  document.getElementById("addForm").classList.add("hidden");
  const list = document.getElementById("awizacjeList");
  list.innerHTML = `<h2>${status === 'aktywne' ? 'Aktywne Awizacje' : 'Zakończone Awizacje'}</h2>`;

  const res = await fetch(`/api/awizacje/${status}`);
  const data = await res.json();

  data.forEach(a => {
    const div = document.createElement("div");
    div.className = "awizacja";
    div.innerHTML = `
      <h3>${a.nazwa} (${a.numer})</h3>
      <p>Palet: ${a.ilosc_palet} | Data wyjazdu: ${a.data_wyjazdu}</p>
      <button onclick="drukujQR(${a.id})">🧾 Drukuj QR</button>
      <button onclick="drukujAwizacje(${a.id})">🖨️ Drukuj Awizację</button>
      <button onclick="editAwizacja(${a.id})">✏️ Edytuj</button>
      <button onclick="usunAwizacje(${a.id})">🗑️ Usuń</button>
      <button onclick="zakonczAwizacje(${a.id})">✅ Zakończ</button>
    `;
    list.appendChild(div);
  });
}

function showSection(id) {
  document.getElementById("addForm").classList.toggle("hidden");
}

document.getElementById("awizacjaForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  await fetch("/api/awizacje", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  form.reset();
  alert("Awizacja dodana!");
});

async function drukujQR(id) {
  const res = await fetch(`/api/qr/${id}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

async function drukujAwizacje(id) {
  const res = await fetch(`/api/awizacje/${id}/pdf`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

async function usunAwizacje(id) {
  if (confirm("Na pewno chcesz usunąć awizację?")) {
    await fetch(`/api/awizacje/${id}`, { method: "DELETE" });
    alert("Usunięto awizację");
    loadAwizacje("aktywne");
  }
}
