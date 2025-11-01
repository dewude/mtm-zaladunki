const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const db = new sqlite3.Database("db.sqlite");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS awizacje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nr_zam TEXT,
    nazwa_zam TEXT,
    numer_auta TEXT,
    kierowca TEXT,
    telefon TEXT,
    data_awiz TEXT,
    godzina_awiz TEXT,
    ilosc_palet INTEGER DEFAULT 0,
    zeskanowane INTEGER DEFAULT 0,
    status TEXT DEFAULT 'Oczekuje'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS palety (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    awizacja_id INTEGER,
    paleta_nazwa TEXT,
    zeskanowana INTEGER DEFAULT 0
  )`);
});

app.get("/api/awizacje", (req, res) => {
  db.all(
    "SELECT a.*, COUNT(p.id) AS ilosc_palet, SUM(p.zeskanowana) AS zeskanowane FROM awizacje a LEFT JOIN palety p ON a.id = p.awizacja_id GROUP BY a.id",
    [],
    (err, rows) => res.json(rows || [])
  );
});

app.post("/api/awizacje", (req, res) => {
  const a = req.body;
  db.run(
    `INSERT INTO awizacje (nr_zam, nazwa_zam, numer_auta, kierowca, telefon, data_awiz, godzina_awiz, ilosc_palet)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.nr_zam, a.nazwa_zam, a.numer_auta, a.kierowca, a.telefon, a.data_awiz, a.godzina_awiz, a.ilosc_palet],
    function (err) {
      if (err) return res.json({ status: "error", error: err.message });
      res.json({ status: "ok", id: this.lastID });
    }
  );
});

app.post("/api/palety", (req, res) => {
  const { awizacja_id, paleta_nazwa } = req.body;
  db.run(
    "INSERT INTO palety (awizacja_id, paleta_nazwa) VALUES (?, ?)",
    [awizacja_id, paleta_nazwa],
    function (err) {
      if (err) return res.json({ status: "error", error: err.message });
      res.json({ status: "ok", id: this.lastID });
    }
  );
});

app.get("/api/palety/:awId", (req, res) => {
  db.all("SELECT * FROM palety WHERE awizacja_id=?", [req.params.awId], (err, rows) =>
    res.json(rows || [])
  );
});

app.get("/api/drukuj_qr/:awId", async (req, res) => {
  const awId = req.params.awId;
  db.all("SELECT * FROM palety WHERE awizacja_id=?", [awId], async (err, palety) => {
    if (!palety || palety.length === 0) return res.send("Brak palet.");

    const doc = new PDFDocument({ margin: 20 });
    const filePath = `tmp_qr_${awId}.pdf`;
    doc.pipe(fs.createWriteStream(filePath));

    for (const p of palety) {
      const qr = await QRCode.toDataURL(`https://mtm-zaladunki.onrender.com/api/skanuj/${p.id}`);
      doc.fontSize(14).text(p.paleta_nazwa);
      doc.image(Buffer.from(qr.split(",")[1], "base64"), { width: 120 });
      doc.moveDown(1.5);
    }
    doc.end();

    doc.on("finish", () => res.download(filePath, () => fs.unlinkSync(filePath)));
  });
});

app.get("/api/skanuj/:paletaId", (req, res) => {
  const { paletaId } = req.params;
  db.run("UPDATE palety SET zeskanowana=1 WHERE id=?", [paletaId], (err) => {
    if (err) return res.send("Błąd skanowania.");
    db.get(
      "SELECT awizacja_id, (SELECT COUNT(*) FROM palety WHERE awizacja_id=a.awizacja_id AND zeskanowana=1) AS done, (SELECT COUNT(*) FROM palety WHERE awizacja_id=a.awizacja_id) AS total FROM palety a WHERE a.id=?",
      [paletaId],
      (e, r) => {
        const status = r.done >= r.total ? "Zakończona" : "W trakcie";
        db.run("UPDATE awizacje SET status=? WHERE id=?", [status, r.awizacja_id]);
        res.send(`<h2>Skan OK ✅</h2><p>Paleta ${paletaId} została zeskanowana.</p><p>Status: ${status}</p>`);
      }
    );
  });
});

app.listen(10000, () => console.log("✅ Server działa na http://localhost:10000"));