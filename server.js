const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "database.db");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const awId = req.body.awizacja_id || req.params.awizacja_id;
    const folder = path.join(UPLOADS_DIR, String(awId));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- DB init ---
const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS awizacje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numer_auta TEXT,
    kierowca TEXT,
    telefon TEXT,
    nazwa_zam TEXT,
    nr_zam TEXT,
    data_awiz TEXT,
    godzina_awiz TEXT,
    ilosc_palet INTEGER,
    zeskanowane INTEGER DEFAULT 0,
    status TEXT DEFAULT 'oczekuje',
    uwagi TEXT DEFAULT ''
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS palety (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    awizacja_id INTEGER,
    kod_qr TEXT,
    status TEXT DEFAULT 'oczekuje',
    zdjecie TEXT,
    FOREIGN KEY(awizacja_id) REFERENCES awizacje(id)
  )`);
});

// --- API ---
// Dodaj awizację
app.post("/api/awizacje", (req, res) => {
  const { numer_auta, kierowca, telefon, nazwa_zam, nr_zam, data_awiz, godzina_awiz, ilosc_palet, uwagi } = req.body;
  const palCount = parseInt(ilosc_palet || 1, 10);
  db.run(`INSERT INTO awizacje (numer_auta,kierowca,telefon,nazwa_zam,nr_zam,data_awiz,godzina_awiz,ilosc_palet,uwagi,status)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [numer_auta,kierowca,telefon,nazwa_zam,nr_zam,data_awiz,godzina_awiz,palCount,uwagi || '','w trakcie'], function(err){
    if(err) return res.status(500).json({error: err.message});
    const awId = this.lastID;
    const folder = path.join(UPLOADS_DIR,String(awId));
    if(!fs.existsSync(folder)) fs.mkdirSync(folder,{recursive:true});

    const promises = [];
    for(let i=1;i<=palCount;i++){
      const kod = `${nazwa_zam} ${nr_zam} Paleta ${i}`;
      const filename = `QR_Paleta_${i}.png`;
      const filepath = path.join(folder, filename);
      promises.push(
        QRCode.toFile(filepath, kod, { margin: 2, width: 400 }).then(()=>{
          db.run(`INSERT INTO palety (awizacja_id,kod_qr,status) VALUES (?,?,?)`,[awId,kod,'oczekuje']);
        })
      );
    }
    Promise.all(promises).then(()=>res.json({status:'ok',id:awId})).catch(err=>res.status(500).json({error:err.message}));
  });
});

// Pobierz awizacje
app.get("/api/awizacje",(req,res)=>{
  db.all(`SELECT * FROM awizacje ORDER BY id DESC`,[],(err,rows)=>{
    if(err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Pobierz palety
app.get("/api/palety/:awizacja_id",(req,res)=>{
  db.all(`SELECT * FROM palety WHERE awizacja_id=? ORDER BY id`,[req.params.awizacja_id],(err,rows)=>{
    if(err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Dodaj paletę
app.post("/api/palety",(req,res)=>{
  const { awizacja_id, paleta_nazwa } = req.body;
  db.get(`SELECT nr_zam,nazwa_zam FROM awizacje WHERE id=?`,[awizacja_id], async (err,row)=>{
    if(err) return res.status(500).json({error: err.message});
    if(!row) return res.status(404).json({error:"Awizacja nie znaleziona"});
    const kod = `${row.nazwa_zam} ${row.nr_zam} ${paleta_nazwa}`;
    const folder = path.join(UPLOADS_DIR,String(awizacja_id));
    if(!fs.existsSync(folder)) fs.mkdirSync(folder,{recursive:true});
    const filename = `QR_${Date.now()}.png`;
    await QRCode.toFile(path.join(folder,filename), kod, {margin:2, width:400});
    db.run(`INSERT INTO palety (awizacja_id,kod_qr,status) VALUES (?,?,?)`,[awizacja_id,kod,'oczekuje'], function(err2){
      if(err2) return res.status(500).json({error: err2.message});
      res.json({status:'ok',qr:`/uploads/${awizacja_id}/${filename}`});
    });
  });
});

// Upload zdjęcia
app.post("/api/upload/:awizacja_id",upload.single("file"),(req,res)=>{
  const awId = req.params.awizacja_id;
  const filePath = req.file? `/uploads/${awId}/${req.file.filename}` : null;
  if(!filePath) return res.status(400).json({error:"Brak pliku"});
  const kod_palety = req.body.kod_palety;
  if(kod_palety){
    db.run(`UPDATE palety SET zdjecie=? WHERE awizacja_id=? AND kod_qr=?`,[filePath,awId,kod_palety],(err)=>{if(err)console.error(err);});
  }
  res.json({status:'ok',file:filePath});
});

// Skanowanie
app.post("/api/scan",(req,res)=>{
  const { qr } = req.body;
  if(!qr) return res.status(400).json({error:"Brak qr"});
  db.get(`SELECT * FROM palety WHERE kod_qr=?`,[qr],(err,row)=>{
    if(err) return res.status(500).json({error:err.message});
    if(!row) return res.status(404).json({error:"Paleta nie znaleziona"});
    if(row.status==='zeskanowana') return res.json({status:'ok',awizacja_id:row.awizacja_id}); // nie zwiększamy
    db.run(`UPDATE palety SET status='zeskanowana' WHERE id=?`,[row.id],function(){
      db.run(`UPDATE awizacje SET zeskanowane = zeskanowane + 1 WHERE id=?`,[row.awizacja_id],function(){
        db.get(`SELECT ilosc_palet,zeskanowane FROM awizacje WHERE id=?`,[row.awizacja_id],(err2,arow)=>{
          if(!err2 && arow && arow.zeskanowane>=arow.ilosc_palet){
            db.run(`UPDATE awizacje SET status='zakończony' WHERE id=?`,[row.awizacja_id]);
          }
          res.json({status:'ok',awizacja_id:row.awizacja_id});
        });
      });
    });
  });
});

// Drukuj QR pojedynczej palety
app.get("/api/drukuj_qr/:awizacja_id/:paleta_id",(req,res)=>{
  const { awizacja_id, paleta_id } = req.params;
  db.get(`SELECT * FROM awizacje WHERE id=?`,[awizacja_id],(err,row)=>{
    if(err || !row) return res.status(404).send("Awizacja nie znaleziona");
    db.get(`SELECT * FROM palety WHERE id=?`,[paleta_id],(err2,pal)=>{
      if(err2 || !pal) return res.status(404).send("Paleta nie znaleziona");
      const doc = new PDFDocument({size:'A4'});
      res.setHeader("Content-disposition",`attachment; filename=QR_${paleta_id}.pdf`);
      res.setHeader("Content-type","application/pdf");
      doc.pipe(res);
      doc.fontSize(18).text(`${row.nazwa_zam} ${row.nr_zam} - ${pal.kod_qr}`,{align:'center'});
      const imgPath = path.join(UPLOADS_DIR,String(awizacja_id),`QR_Paleta_${pal.id}.png`);
      if(fs.existsSync(imgPath)) doc.image(imgPath,{fit:[400,400],align:'center'});
      doc.end();
    });
  });
});

// Drukuj wszystkie QR palet
app.get("/api/drukuj_qr/:awizacja_id",(req,res)=>{
  const awId = req.params.awizacja_id;
  db.get(`SELECT * FROM awizacje WHERE id=?`,[awId],(err,row)=>{
    if(err || !row) return res.status(404).send("Awizacja nie znaleziona");
    db.all(`SELECT * FROM palety WHERE awizacja_id=?`,[awId],(err2,palety)=>{
      if(err2) return res.status(500).send(err2.message);
      const doc = new PDFDocument({autoFirstPage:false});
      res.setHeader("Content-disposition",`attachment; filename=palety_${awId}.pdf`);
      res.setHeader("Content-type","application/pdf");
      doc.pipe(res);
      palety.forEach((p,i)=>{
        doc.addPage();
        doc.fontSize(14).text(`${row.nazwa_zam} ${row.nr_zam} - ${p.kod_qr}`,{align:'center'});
        const imgPath = path.join(UPLOADS_DIR,String(awId),`QR_Paleta_${i+1}.png`);
        if(fs.existsSync(imgPath)) doc.image(imgPath,{fit:[400,400],align:'center'});
      });
      doc.end();
    });
  });
});

// Drukuj pełną awizację
app.get("/api/drukuj_awizacje/:awizacja_id",(req,res)=>{
  const awId = req.params.awizacja_id;
  db.get(`SELECT * FROM awizacje WHERE id=?`,[awId],(err,row)=>{
    if(err || !row) return res.status(404).send("Awizacja nie znaleziona");
    db.all(`SELECT * FROM palety WHERE awizacja_id=?`,[awId],(err2,palety)=>{
      if(err2) return res.status(500).send(err2.message);
      const doc = new PDFDocument();
      res.setHeader("Content-disposition",`attachment; filename=awizacja_${awId}.pdf`);
      res.setHeader("Content-type","application/pdf");
      doc.pipe(res);
      doc.fontSize(18).text(`Awizacja: ${row.nazwa_zam} ${row.nr_zam}`,{align:"center"});
      doc.fontSize(14).text(`Numer auta: ${row.numer_auta}`);
      doc.text(`Kierowca: ${row.kierowca}`);
      doc.text(`Telefon: ${row.telefon}`);
      doc.text(`Data wyjazdu: ${row.data_awiz} ${row.godzina_awiz || ''}`);
      doc.text(`Ilość palet: ${row.ilosc_palet}`);
      doc.text(`Uwagi: ${row.uwagi || ''}`);
      doc.moveDown();
      doc.text("Palety:",{underline:true});
      palety.forEach(p=>doc.text(`- ${p.kod_qr} [${p.status}]`));
      doc.end();
    });
  });
});

app.get("/uploads/:awizacja_id/:filename",(req,res)=>{
  const file = path.join(UPLOADS_DIR,String(req.params.awizacja_id),req.params.filename);
  if(!fs.existsSync(file)) return res.status(404).send("Not found");
  res.sendFile(file);
});

app.get("/api/ping",(req,res)=>res.json({ok:true}));

app.listen(PORT,()=>console.log(`Server started on http://localhost:${PORT}`));
