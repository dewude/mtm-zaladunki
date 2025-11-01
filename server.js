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

// Multer for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const awizacjaId = req.body.awizacja_id || req.params.awizacja_id;
    const folder = path.join(UPLOADS_DIR, String(awizacjaId));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage });

// --- SQLite init ---
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

  db.run(`INSERT INTO awizacje 
    (numer_auta, kierowca, telefon, nazwa_zam, nr_zam, data_awiz, godzina_awiz, ilosc_palet, status, uwagi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'w trakcie', ?)`,
    [numer_auta, kierowca, telefon, nazwa_zam, nr_zam, data_awiz, godzina_awiz, palCount, uwagi],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const awId = this.lastID;
      const folder = path.join(UPLOADS_DIR, String(awId));
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

      // Generuj QR i wpisz palety do DB
      const promises = [];
      for (let i = 1; i <= palCount; i++) {
        const kod = `${nazwa_zam} ${nr_zam} Paleta ${i}`;
        const filename = `QR_Paleta_${i}.png`;
        const filepath = path.join(folder, filename);
        promises.push(QRCode.toFile(filepath, kod, { width: 400, margin: 2 }).then(() => {
          db.run(`INSERT INTO palety (awizacja_id, kod_qr) VALUES (?, ?)`, [awId, kod]);
        }));
      }

      Promise.all(promises).then(() => res.json({ status: "ok", id: awId }))
        .catch(e => res.status(500).json({ error: e.message }));
    });
});

// Pobierz wszystkie awizacje
app.get("/api/awizacje", (req, res) => {
  db.all(`SELECT * FROM awizacje ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Pobierz palety dla awizacji
app.get("/api/palety/:awizacja_id", (req, res) => {
  const awId = req.params.awizacja_id;
  db.all(`SELECT * FROM palety WHERE awizacja_id=? ORDER BY id`, [awId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Dodaj paletę ręcznie
app.post("/api/palety", async (req, res) => {
  const { awizacja_id, paleta_nazwa } = req.body;
  db.get(`SELECT nr_zam, nazwa_zam FROM awizacje WHERE id=?`, [awizacja_id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Awizacja nie znaleziona" });

    const kod = `${row.nazwa_zam} ${row.nr_zam} ${paleta_nazwa}`;
    const folder = path.join(UPLOADS_DIR, String(awizacja_id));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const filename = `QR_${Date.now()}.png`;
    const filepath = path.join(folder, filename);

    await QRCode.toFile(filepath, kod, { width: 400, margin: 2 });
    db.run(`INSERT INTO palety (awizacja_id, kod_qr) VALUES (?, ?)`, [awizacja_id, kod], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ status: "ok", qr: `/uploads/${awizacja_id}/${filename}` });
    });
  });
});

// Upload zdjęcia
app.post("/api/upload/:awizacja_id", upload.single("file"), (req, res) => {
  const awId = req.params.awizacja_id;
  const filePath = req.file ? `/uploads/${awId}/${req.file.filename}` : null;
  if (!filePath) return res.status(400).json({ error: "Brak pliku" });

  const kod_palety = req.body.kod_palety;
  if (kod_palety) {
    db.run(`UPDATE palety SET zdjecie=? WHERE awizacja_id=? AND kod_qr=?`, [filePath, awId, kod_palety], err => { if (err) console.error(err); });
  }

  res.json({ status: "ok", file: filePath });
});

// Scan palety
app.post("/api/scan", (req, res) => {
  const { qr } = req.body;
  if (!qr) return res.status(400).json({ error: "Brak qr" });

  db.get(`SELECT * FROM palety WHERE kod_qr=?`, [qr], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Paleta nie znaleziona" });

    if(row.status==='zeskanowana') return res.json({ status:"ok", message:"Już zeskanowana" });

    db.run(`UPDATE palety SET status='zeskanowana' WHERE id=?`, [row.id], err2 => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.run(`UPDATE awizacje SET zeskanowane=zeskanowane+1 WHERE id=?`, [row.awizacja_id], err3 => {
        if (err3) console.error(err3);

        db.get(`SELECT ilosc_palet, zeskanowane FROM awizacje WHERE id=?`, [row.awizacja_id], (err4, arow) => {
          if(!err4 && arow && arow.zeskanowane>=arow.ilosc_palet){
            db.run(`UPDATE awizacje SET status='zakończony' WHERE id=?`, [row.awizacja_id]);
          }
          res.json({ status:"ok", awizacja_id:row.awizacja_id });
        });
      });
    });
  });
});

// Drukuj QR palety
app.get("/api/drukuj_qr/:awizacja_id", (req,res)=>{
  const awId=req.params.awizacja_id;
  const paleta=req.query.paleta; // opcjonalnie druk jednej palety
  const folder=path.join(UPLOADS_DIR,String(awId));
  if(!fs.existsSync(folder)) return res.status(404).send("Brak folderu awizacji");

  let files=fs.readdirSync(folder).filter(f=>f.endsWith(".png"));
  if(paleta) files=files.filter(f=>f.includes(paleta));

  const doc=new PDFDocument({autoFirstPage:false});
  res.setHeader("Content-disposition",`attachment; filename=palety_${awId}.pdf`);
  res.setHeader("Content-type","application/pdf");
  doc.pipe(res);

  files.forEach(file=>{
    doc.addPage();
    doc.fontSize(14).text(file.replace(".png",""),{align:"center"});
    const imgPath=path.join(folder,file);
    try{ doc.image(imgPath,{fit:[300,300],align:"center"}); }catch(e){console.error(e);}
  });
  doc.end();
});

// Drukuj awizacje
app.get("/api/drukuj_awizacje/:awizacja_id",(req,res)=>{
  const awId=req.params.awizacja_id;
  db.get(`SELECT * FROM awizacje WHERE id=?`,[awId],(err,row)=>{
    if(err||!row) return res.status(404).send("Awizacja nie znaleziona");

    db.all(`SELECT * FROM palety WHERE awizacja_id=?`,[awId],(err2,pal_*
