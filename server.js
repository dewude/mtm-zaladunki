const express = require("express");
const cors = require("cors");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

if (!fs.existsSync("./public")) fs.mkdirSync("./public");
if (!fs.existsSync("./db")) fs.mkdirSync("./db");

const db = new sqlite3.Database("./db/mtm.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS awizacje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nazwa TEXT,
    numer TEXT,
    data_wyjazdu TEXT,
    informacje TEXT,
    kierowca TEXT,
    ilosc_palety INTEGER DEFAULT 0,
    zakonczone INTEGER DEFAULT 0,
    data_utworzenia TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS palety (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    awizacja_id INTEGER,
    numer TEXT,
    zeskanowana INTEGER DEFAULT 0,
    FOREIGN KEY(awizacja_id) REFERENCES awizacje(id)
  )`);
});

app.get("/api/awizacje", (req, res) => {
  db.all("SELECT * FROM awizacje", (err, rows) => res.json(rows));
});

app.post("/api/awizacje", (req, res) => {
  const { nazwa, numer, data_wyjazdu, informacje, kierowca, ilosc_palety } = req.body;
  const data_utworzenia = new Date().toLocaleString("pl-PL");
  db.run(
    `INSERT INTO awizacje (nazwa, numer, data_wyjazdu, informacje, kierowca, ilosc_palety, data_utworzenia)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nazwa, numer, data_wyjazdu, informacje, kierowca, ilosc_palety, data_utworzenia],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const awizacja_id = this.lastID;
      for (let i = 1; i <= ilosc_palety; i++) {
        db.run(`INSERT INTO palety (awizacja_id, numer) VALUES (?, ?)`, [awizacja_id, `Paleta ${i}`]);
      }
      res.json({ success: true });
    }
  );
});

app.delete("/api/awizacje/:id", (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM palety WHERE awizacja_id = ?`, [id]);
  db.run(`DELETE FROM awizacje WHERE id = ?`, [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get("/api/palety/:id", (req, res) => {
  db.all("SELECT * FROM palety WHERE awizacja_id = ?", [req.params.id], (err, rows) => res.json(rows));
});

app.post("/api/skan/:id", (req, res) => {
  db.get("SELECT * FROM palety WHERE id = ?", [req.params.id], (err, paleta) => {
    if (!paleta) return res.json({ error: "Nie znaleziono palety" });
    if (paleta.zeskanowana) return res.json({ error: "Ta paleta już została zeskanowana" });

    db.run("UPDATE palety SET zeskanowana = 1 WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: `Zeskanowano ${paleta.numer}` });
  });
});

app.get("/api/drukuj_qr/:id", async (req, res) => {
  db.get("SELECT * FROM awizacje WHERE id = ?", [req.params.id], async (err, awizacja) => {
    if (!awizacja) return res.status(404).send("Brak awizacji");

    db.all("SELECT * FROM palety WHERE awizacja_id = ?", [req.params.id], async (err, palety) => {
      const doc = new PDFDocument({ margin: 40 });
      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);

      for (const p of palety) {
        const opis = `${awizacja.nazwa} ${awizacja.numer}\n${p.numer}`;
        const qr = await QRCode.toDataURL(opis);
        doc.fontSize(16).text(opis, { align: "center" });
        doc.image(qr, { fit: [250, 250], align: "center", valign: "center" });
        doc.addPage();
      }
      doc.end();
    });
  });
});

app.get("/api/drukuj_awizacje/:id", (req, res) => {
  db.get("SELECT * FROM awizacje WHERE id = ?", [req.params.id], (err, awizacja) => {
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);
    doc.font("Helvetica-Bold").fontSize(18).text("Awizacja", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica").fontSize(14).text(`Nazwa: ${awizacja.nazwa}`);
    doc.text(`Numer: ${awizacja.numer}`);
    doc.text(`Data wyjazdu: ${awizacja.data_wyjazdu}`);
    doc.text(`Kierowca: ${awizacja.kierowca}`);
    doc.text(`Ilość palet: ${awizacja.ilosc_palety}`);
    doc.text(`Informacje: ${awizacja.informacje}`);
    doc.text(`Data utworzenia: ${awizacja.data_utworzenia}`);
    doc.moveDown().fontSize(12).text("Sygnatura: ________________________");
    doc.end();
  });
});

app.listen(PORT, () => console.log(`Server działa na porcie ${PORT}`));
