// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = path.join(__dirname, "mtm.db");
const db = new sqlite3.Database(DB_PATH);

// --- Simple migration: create table if not exists, add missing columns if needed
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS awizacje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nazwa_zam TEXT,
    nr_zam TEXT,
    numer_auta TEXT,
    kierowca TEXT,
    telefon TEXT,
    data_wyjazdu TEXT,
    ilosc_palet INTEGER DEFAULT 0,
    info TEXT,
    status TEXT DEFAULT 'aktywne',
    data_utworzenia TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS palety (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    awizacja_id INTEGER,
    paleta_nazwa TEXT,
    kod TEXT,
    status TEXT DEFAULT 'nowa',
    data_skanu TEXT
  )`);

  // Ensure columns exist (in case older schema missing fields)
  const ensureColumn = (table, column, definition) => {
    db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
      if (err) return;
      const exists = rows.some(r => r.name === column);
      if (!exists) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    });
  };

  ensureColumn("awizacje", "nazwa_zam", "TEXT");
  ensureColumn("awizacje", "nr_zam", "TEXT");
  ensureColumn("awizacje", "numer_auta", "TEXT");
  ensureColumn("awizacje", "kierowca", "TEXT");
  ensureColumn("awizacje", "telefon", "TEXT");
  ensureColumn("awizacje", "data_wyjazdu", "TEXT");
  ensureColumn("awizacje", "ilosc_palet", "INTEGER DEFAULT 0");
  ensureColumn("awizacje", "info", "TEXT");
  ensureColumn("awizacje", "status", "TEXT DEFAULT 'aktywne'");
  ensureColumn("awizacje", "data_utworzenia", "TEXT DEFAULT (datetime('now'))");
});

// Multer (optional image uploads) - stores in public/uploads/<awid> if used
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const awId = req.body.awizacja_id || req.params.awizacja_id || "misc";
    const dir = path.join(__dirname, "public", "uploads", String(awId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// =============== API ===============

// GET all awizacje
app.get("/api/awizacje", (req, res) => {
  db.all(`SELECT * FROM awizacje ORDER BY status ASC, id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ status: "error", message: err.message });
    res.json(rows || []);
  });
});

// POST add awizacja
app.post("/api/awizacje", (req, res) => {
  const {
    nazwa_zam = "",
    nr_zam = "",
    numer_auta = "",
    kierowca = "",
    telefon = "",
    data_wyjazdu = "",
    ilosc_palet = 0,
    info = ""
  } = req.body;

  db.run(
    `INSERT INTO awizacje (nazwa_zam, nr_zam, numer_auta, kierowca, telefon, data_wyjazdu, ilosc_palet, info, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aktywne')`,
    [nazwa_zam, nr_zam, numer_auta, kierowca, telefon, data_wyjazdu, parseInt(ilosc_palet || 0, 10), info],
    function (err) {
      if (err) return res.status(500).json({ status: "error", message: err.message });
      res.json({ status: "ok", id: this.lastID });
    }
  );
});

// PATCH edit awizacje (partial)
app.patch("/api/awizacje/:id", (req, res) => {
  const id = req.params.id;
  const fields = [];
  const values = [];
  ["nazwa_zam","nr_zam","numer_auta","kierowca","telefon","data_wyjazdu","ilosc_palet","info","status"].forEach(k=>{
    if (k in req.body) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  });
  if (fields.length === 0) return res.status(400).json({ status: "error", message: "Brak pól do edycji" });
  values.push(id);
  db.run(`UPDATE awizacje SET ${fields.join(", ")} WHERE id = ?`, values, function(err){
    if (err) return res.status(500).json({ status: "error", message: err.message });
    res.json({ status: "ok", changes: this.changes });
  });
});

// DELETE awizacja
app.delete("/api/awizacje/:id", (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM awizacje WHERE id = ?", [id], function(err){
    if (err) return res.status(500).json({ status: "error", message: err.message });
    // optionally delete palety for this awizacja
    db.run("DELETE FROM palety WHERE awizacja_id = ?", [id], () => {});
    res.json({ status: "ok" });
  });
});

// POST add paleta
app.post("/api/palety", (req, res) => {
  const { awizacja_id, paleta_nazwa = "" } = req.body;
  if (!awizacja_id) return res.status(400).json({ status: "error", message: "awizacja_id required" });
  const kod = `${paleta_nazwa} | ${Date.now()} | AW${awizacja_id}`;
  db.run("INSERT INTO palety (awizacja_id, paleta_nazwa, kod) VALUES (?, ?, ?)", [awizacja_id, paleta_nazwa, kod], function(err){
    if (err) return res.status(500).json({ status: "error", message: err.message });
    res.json({ status: "ok", id: this.lastID, kod });
  });
});

// GET palety for awizacja
app.get("/api/palety/:awid", (req, res) => {
  const awid = req.params.awid;
  db.all("SELECT * FROM palety WHERE awizacja_id = ? ORDER BY id", [awid], (err, rows) => {
    if (err) return res.status(500).json({ status: "error", message: err.message });
    res.json(rows || []);
  });
});

// Scan paleta by code (used by scanner)
app.get("/api/skan/:kod", (req, res) => {
  const kod = decodeURIComponent(req.params.kod);
  db.get("SELECT * FROM palety WHERE kod = ?", [kod], (err, pal) => {
    if (err) return res.status(500).json({ status: "error", message: err.message });
    if (!pal) return res.json({ status: "error", message: "Nie znaleziono palety." });

    if (pal.status === "zeskanowana") {
      return res.json({ status: "warning", message: "Ta paleta została już zeskanowana.", paleta: pal });
    }

    db.run("UPDATE palety SET status = 'zeskanowana', data_skanu = datetime('now') WHERE id = ?", [pal.id], function(err2){
      if (err2) return res.status(500).json({ status: "error", message: err2.message });
      // return updated paleta + awizacja id
      db.get("SELECT * FROM palety WHERE id = ?", [pal.id], (e, updated) => {
        res.json({ status: "ok", message: `Zeskanowano paletę: ${updated.paleta_nazwa}`, paleta: updated });
      });
    });
  });
});

// PRINT QR for all palety of awizacje (bigger QR + description)
app.get("/api/drukuj_qr/:awid", (req, res) => {
  const awid = req.params.awid;
  db.get("SELECT * FROM awizacje WHERE id = ?", [awid], (err, aw) => {
    if (err || !aw) return res.status(404).send("Nie znaleziono awizacji");
    db.all("SELECT * FROM palety WHERE awizacja_id = ?", [awid], async (err2, palety) => {
      if (err2) return res.status(500).send(err2.message);
      const doc = new PDFDocument({ autoFirstPage: false });
      res.setHeader("Content-Disposition", `attachment; filename=qr_awizacja_${aw.nr_zam || awid}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);

      // title page
      doc.addPage();
      doc.fontSize(20).text(`Awizacja: ${aw.nr_zam || ""}`, { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Nazwa: ${aw.nazwa_zam || ""}`);
      doc.text(`Auto: ${aw.numer_auta || ""} | Kierowca: ${aw.kierowca || ""} | Tel: ${aw.telefon || ""}`);
      doc.text(`Data wyjazdu: ${aw.data_wyjazdu || ""}`);
      doc.text(`Ilość palet (zadeklarowana): ${aw.ilosc_palet || 0}`);
      doc.moveDown();

      for (const p of palety) {
        doc.addPage();
        const text = `Paleta: ${p.paleta_nazwa}\nZamówienie: ${aw.nr_zam || ""}\nNazwa: ${aw.nazwa_zam || ""}\nAuto: ${aw.numer_auta || ""}\nKierowca: ${aw.kierowca || ""}\nData wyjazdu: ${aw.data_wyjazdu || ""}`;
        // bigger QR
        const qrData = await QRCode.toDataURL(text, { width: 400, margin: 2 });
        doc.image(Buffer.from(qrData.split(",")[1], "base64"), { width: 250, align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(text);
      }

      doc.end();
    });
  });
});

// PRINT full awizacja (report)
app.get("/api/drukuj_awizacje/:awid", (req, res) => {
  const awid = req.params.awid;
  db.get("SELECT * FROM awizacje WHERE id = ?", [awid], (err, aw) => {
    if (err || !aw) return res.status(404).send("Nie znaleziono awizacji");
    db.all("SELECT * FROM palety WHERE awizacja_id = ?", [awid], (err2, palety) => {
      if (err2) return res.status(500).send(err2.message);
      const doc = new PDFDocument();
      res.setHeader("Content-Disposition", `attachment; filename=awizacja_${aw.nr_zam || awid}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);
      doc.fontSize(18).text(`Awizacja: ${aw.nr_zam || ""}`, { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Nazwa: ${aw.nazwa_zam || ""}`);
      doc.text(`Auto: ${aw.numer_auta || ""}`);
      doc.text(`Kierowca: ${aw.kierowca || ""} | Tel: ${aw.telefon || ""}`);
      doc.text(`Data wyjazdu: ${aw.data_wyjazdu || ""}`);
      doc.text(`Ilość palet zadeklarowana: ${aw.ilosc_palet || 0}`);
      doc.moveDown();
      doc.text(`Palety:`);
      palety.forEach(p => {
        doc.text(`- ${p.paleta_nazwa} (status: ${p.status || "niezeskanowana"})`);
      });
      doc.end();
    });
  });
});

// endpoint to finish awizacja (set status -> zakończona)
app.patch("/api/awizacje/:id/finish", (req, res) => {
  const id = req.params.id;
  db.run("UPDATE awizacje SET status = 'zakończona' WHERE id = ?", [id], function(err){
    if (err) return res.status(500).json({ status: "error", message: err.message });
    res.json({ status: "ok" });
  });
});

// simple upload endpoint (optional)
app.post("/api/upload/:awizacja_id", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ status: "error", message: "Brak pliku" });
  const relative = `/uploads/${req.params.awizacja_id}/${req.file.filename}`;
  res.json({ status: "ok", file: relative });
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ MTM server running on port ${PORT}`));
