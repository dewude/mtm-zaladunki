async function loadAwizacje(type='aktywni'){
  const res=await fetch('/api/awizacje');
  const data=await res.json();
  const container=document.getElementById('awizacjeContainer')||document.getElementById('lista');
  if(!container) return;
  container.innerHTML='';
  const filtered=data.filter(a=>type==='aktywni'?a.status!=='zakończony':a.status==='zakończony');
  if(filtered.length===0){ container.innerHTML='<p style="text-align:center;">Brak awizacji</p>'; return; }

  let table=`<table><tr>
    <th>ID</th><th>Nazwa</th><th>Zamówienie</th><th>Kierowca</th><th>Telefon</th>
    <th>Auto</th><th>Data wyjazdu</th><th>Palet</th><th>Zeskanowane</th><th>Status</th><th>Opcje</th></tr>`;

  filtered.forEach(a=>{
    table+=`<tr>
      <td>${a.id}</td><td>${a.nazwa_zam}</td><td>${a.nr_zam}</td><td>${a.kierowca}</td>
      <td>${a.telefon}</td><td>${a.numer_auta}</td><td>${a.data_awiz}</td>
      <td>${a.ilosc_palet}</td><td>${a.zeskanowane}</td><td>${a.status}</td>
      <td>
        <button onclick="drukujAwizacje(${a.id})">Drukuj awizację</button>
        <button onclick="drukujQR(${a.id})">Drukuj QR</button>
      </td>
    </tr>`;
  });

  table+='</table>';
  container.innerHTML=table;
}

function toggleForm() {
  const f=document.getElementById('formContainer');
  f.style.display=(f.style.display==='none')?'block':'none';
}

document.getElementById('formAwizacja')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f=e.target;
  const payload={
    nazwa_zam:f.nazwa_zam.value,
    nr_zam:f.nr_zam.value,
    kierowca:f.kierowca.value,
    telefon:f.telefon.value,
    numer_auta:f.numer_auta.value,
    data_awiz:f.data_awiz.value,
    ilosc_palet:f.ilosc_palet.value,
    uwagi:f.uwagi.value
  };
  const res=await fetch('/api/awizacje',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
  const j=await res.json();
  if(j.status==='ok'){ alert('Dodano awizację'); f.reset(); toggleForm(); loadAwizacje('aktywni'); }
  else alert('Błąd: '+(j.error||j.message));
});

function drukujAwizacje(id){ window.open(`/api/drukuj_awizacje/${id}`,'_blank'); }
function drukujQR(id){ alert('Wybierz paletę w panelu pracownika aby wydrukować QR'); }

document.addEventListener('DOMContentLoaded', ()=>{ loadAwizacje('aktywni'); });
