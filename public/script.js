async function loadAwizacje() {
  const res = await fetch("/api/awizacje");
  const arr = await res.json();
  const container = document.getElementById("listaAwizacji");
  const zakonczone = document.getElementById("listaZakonczone");
  if(!container || !zakonczone) return;
  container.innerHTML=""; zakonczone.innerHTML="";
  arr.forEach(a=>{
    const div = document.createElement("div");
    div.innerHTML = `
      <strong>${a.nazwa_zam} ${a.nr_zam}</strong> (${a.numer_auta})<br>
      Data: ${a.data_awiz} | Palet: ${a.ilosc_palet} | Zeskanowane: ${a.zeskanowane} <br>
      <button onclick="drukujQR(${a.id})">Drukuj QR</button>
      <button onclick="drukujAwizacje(${a.id})">Drukuj awizację</button>
    `;
    if(a.status==='zakończony') zakonczone.appendChild(div);
    else container.appendChild(div);
  });
}

document.getElementById('formAwizacja')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const f = e.target;
  const payload = {
    numer_auta: f.numer_auta.value,
    kierowca: f.kierowca.value,
    telefon: f.telefon.value,
    nazwa_zam: f.nazwa_zam.value,
    nr_zam: f.nr_zam.value,
    data_awiz: f.data.value,
    ilosc_palet: f.ilosc_palet.value,
    uwagi: f.uwagi.value
  };
  const res = await fetch("/api/awizacje",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
  const j = await res.json();
  if(j.status==="ok"){ alert("Dodano awizację"); f.reset(); loadAwizacje();}
});

async function drukujQR(awId){
  window.open(`/api/drukuj_qr/${awId}`,"_blank");
}
async function drukujAwizacje(awId){
  window.open(`/api/drukuj_awizacje/${awId}`,"_blank");
}

document.addEventListener("DOMContentLoaded",()=>{ loadAwizacje(); });
