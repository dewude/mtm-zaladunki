function showForm(){ document.getElementById('formContainer').style.display='block'; }

function toggleSection(section){
  document.getElementById('activeSection').style.display='none';
  document.getElementById('doneSection').style.display='none';
  if(section==='active') document.getElementById('activeSection').style.display='block';
  if(section==='done') document.getElementById('doneSection').style.display='block';
  loadAwizacje(section);
}

async function loadAwizacje(status){
  const res = await fetch('/api/awizacje');
  const arr = await res.json();
  const container = status==='active' ? document.getElementById('activeAwizacje') : document.getElementById('doneAwizacje');
  container.innerHTML='';
  arr.forEach(a=>{
    if(status==='active' && a.status!=='w trakcie') return;
    if(status==='done' && a.status!=='zakończony') return;
    const div=document.createElement('div');
    div.className='awizacja';
    div.innerHTML=`
      <strong>${a.nazwa_zam} ${a.nr_zam}</strong><br>
      Data wyjazdu: ${a.data_awiz} ${a.godzina_awiz || ''} | Ilość palet: ${a.ilosc_palet} | Zeskanowane: ${a.zeskanowane}<br>
      Uwagi: ${a.uwagi || ''}<br>
      <button onclick="drukujAwizacje(${a.id})">Drukuj Awizację</button>
      <button onclick="drukujQR(${a.id})">Drukuj QR wszystkich palet</button>
      <button onclick="editAwizacja(${a.id})">Edytuj</button>
      <button onclick="deleteAwizacja(${a.id})">Usuń</button>
      <button onclick="loadWorker(${a.id})">Panel Pracownika</button>
    `;
    container.appendChild(div);
  });
}

document.getElementById('formAwizacja')?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  const f=e.target;
  const payload={
    nazwa_zam:f.nazwa_zam.value,
    nr_zam:f.nr_zam.value,
    numer_auta:f.numer_auta.value,
    kierowca:f.kierowca.value,
    telefon:f.telefon.value,
    data_awiz:f.data_awiz.value,
    godzina_awiz:f.godzina_awiz.value,
    ilosc_palet:f.ilosc_palet.value,
    uwagi:f.uwagi.value
  };
  const res=await fetch('/api/awizacje',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await res.json();
  if(j.status==='ok'){ alert('Dodano awizację'); f.reset(); loadAwizacje('active'); }
});

function drukujAwizacje(id){ window.open(`/api/drukuj_awizacje/${id}`,'_blank'); }
function drukujQR(id){ window.open(`/api/drukuj_qr/${id}`,'_blank'); }
function editAwizacja(id){ alert('Funkcja edycji dostępna w panelu admina'); }
function deleteAwizacja(id){ if(confirm('Na pewno usunąć?')) alert('Funkcja usuwania dostępna w panelu admina'); }
function loadWorker(id){ window.location.href='/app_worker.html'; }

document.addEventListener('DOMContentLoaded',()=>toggleSection('active'));
