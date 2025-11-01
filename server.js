const express = require("express");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const QRCode = require("qrcode");
const multer = require("multer");
const cors = require("cors");
const PDFDocument = require("pdfkit");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const dbFile = "./mtm.db";
const db = new sqlite3.Database(dbFile);

// Inicjalizacja tabel
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS awizacje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nr_zam TEXT,
    data_wyjazdu TEXT,
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
});

// Uploady zdjęć (opcjonalne)
const upload = multer({ dest: "uploads/" });

// ================== STRONY ==================

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/app_worker.html", (req, res) => res.sendFile(path.join(__dirname, "public", "app_worker.html")));
app.get("/skaner.html", (req, res) => res.sendFile(path.join(__dirname, "public", "skaner.html")));

// ================== API ==================

// lista awizacji
app.get("/api/awizacje", (req, res) => {
  db.all("SELECT * FROM awizacje ORDER BY id DESC", (err, rows) => {
    if (err) return res.json({ status: "error", message: err.message });
    res.json(rows);
  });
});

// dodaj awizację
app.post("/api/awizacje", (req, res) => {
  const { nr_zam, data_wyjazdu, info } = req.body;
  db.run(
    "INSERT INTO awizacje (nr_zam, data_wyjazdu, info) VALUES (?, ?, ?)",
    [nr_zam, data_wyjazdu, info],
    function (err) {
      if (err) return res.json({ status: "error", message: err.message });
      res.json({ status: "ok", id: this.lastID });
    }
  );
});

// usuń awizację
app.delete("/api/awizacje/:id", (req, res) => {
  db.run("DELETE FROM awizacje WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.json({ status: "error", message: err.message });
    res.json({ status: "ok" });
  });
});

// dodaj paletę
app.post("/api/palety", async (req, res) => {
  const { awizacja_id, paleta_nazwa } = req.body;
  const kod = `${paleta_nazwa}-${awizacja_id}-${Date.now()}`;
  db.run(
    "INSERT INTO palety (awizacja_id, paleta_nazwa, kod) VALUES (?, ?, ?)",
    [awizacja_id, paleta_nazwa, kod],
    async function (err) {
      if (err) return res.json({ status: "error", message: err.message });
      res.json({ status: "ok", kod });
    }
  );
});

// lista palet
app.get("/api/palety/:awid", (req, res) => {
  db.all("SELECT * FROM palety WHERE awizacja_id = ?", [req.params.awid], (err, rows) => {
    if (err) return res.json({ status: "error", message: err.message });
    res.json(rows);
  });
});

// SKANOWANIE PALET
app.get("/api/skan/:kod", (req, res) => {
  const kod = decodeURIComponent(req.params.kod);
  db.get("SELECT * FROM palety WHERE kod = ?", [kod], (err, paleta) => {
    if (err) return res.json({ status: "error", message: err.message });
    if (!paleta) return res.json({ status: "error", message: "Nie znaleziono palety." });

    if (paleta.status === "zeskanowana") {
      return res.json({ status: "warning", message: "Ta paleta została już zeskanowana." });
    }

    db.run("UPDATE palety SET status = ?, data_skanu = datetime('now') WHERE kod = ?", ["zeskanowana", kod], (err2) => {
      if (err2) return res.json({ status: "error", message: err2.message });
      res.json({ status: "ok", message: "Zeskanowano paletę: " + paleta.paleta_nazwa, paleta });
    });
  });
});

// DRUKUJ QR DLA WSZYSTKICH PALET
app.get("/api/drukuj_qr/:awid", async (req, res) => {
  const awid = req.params.awid;
  db.get("SELECT * FROM awizacje WHERE id = ?", [awid], (err, aw) => {
    if (err || !aw) return res.status(404).send("Nie znaleziono awizacji");
    db.all("SELECT * FROM palety WHERE awizacja_id = ?", [awid], async (err2, palety) => {
      if (err2) return res.status(500).send(err2.message);

      const doc = new PDFDocument();
      res.setHeader("Content-Disposition", `attachment; filename=qr_awizacja_${aw.nr_zam}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);

      doc.fontSize(20).text(`Awizacja: ${aw.nr_zam}`, { align: "center" });
      doc.moveDown();
      for (const p of palety) {
        const text = `Paleta: ${p.paleta_nazwa}\nZamówienie: ${aw.nr_zam}\nData wyjazdu: ${aw.data_wyjazdu}`;
        const qr = await QRCode.toDataURL(text, { width: 300 });
        doc.image(Buffer.from(qr.split(",")[1], "base64"), { width: 150 });
        doc.text(text);
        doc.moveDown();
      }
      doc.end();
    });
  });
});

// DRUKUJ CAŁĄ AWIZACJĘ
app.get("/api/drukuj_awizacje/:awid", async (req, res) => {
  const awid = req.params.awid;
  db.get("SELECT * FROM awizacje WHERE id = ?", [awid], (err, aw) => {
    if (err || !aw) return res.status(404).send("Nie znaleziono awizacji");
    db.all("SELECT * FROM palety WHERE awizacja_id = ?", [awid], async (err2, palety) => {
      const doc = new PDFDocument();
      res.setHeader("Content-Disposition", `attachment; filename=awizacja_${aw.nr_zam}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);
      doc.fontSize(18).text(`Awizacja: ${aw.nr_zam}`, { align: "center" });
      doc.text(`Data wyjazdu: ${aw.data_wyjazdu}`);
      doc.text(`Informacje: ${aw.info || "brak"}`);
      doc.moveDown();

      for (const p of palety) {
        doc.text(`Paleta: ${p.paleta_nazwa} (${p.status || "niezeskanowana"})`);
      }

      doc.end();
    });
  });
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ MTM system działa na porcie " + PORT));
