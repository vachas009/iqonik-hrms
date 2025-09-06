const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const PDFDocument = require("pdfkit");
const { createCanvas, loadImage } = require("canvas");

// Card output directory
const outputDir = path.join(__dirname, "assets", "cards");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Default placeholder photo
const placeholderPath = path.join(__dirname, "assets", "default-photo.png");

// --- Connect to PostgreSQL ---
async function connectDb() {
  const client = new Client({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.DB,
  });
  await client.connect();
  return client;
}

// --- Generate Employee ID like IQ0001 ---
async function generateEmpId(client, empId) {
  const res = await client.query("SELECT emp_code FROM employees WHERE id=$1", [empId]);
  if (res.rows[0] && res.rows[0].emp_code) {
    return res.rows[0].emp_code; // already assigned
  }

  const latest = await client.query("SELECT emp_code FROM employees ORDER BY emp_code DESC LIMIT 1");
  let newCode = "IQ0001";
  if (latest.rows.length > 0 && latest.rows[0].emp_code) {
    const num = parseInt(latest.rows[0].emp_code.replace("IQ", "")) + 1;
    newCode = "IQ" + String(num).padStart(4, "0");
  }

  await client.query("UPDATE employees SET emp_code=$1 WHERE id=$2", [newCode, empId]);
  return newCode;
}

// --- Generate ID Card PDF & PNG ---
async function generateIdCard(emp, empCode, photoPath) {
  const pdfPath = path.join(outputDir, `${empCode}_IDCard.pdf`);
  const pngPath = path.join(outputDir, `${empCode}_IDCard.png`);

  // PDF
  const doc = new PDFDocument({ size: "A7", layout: "portrait" });
  doc.pipe(fs.createWriteStream(pdfPath));

  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#000000");
  doc.fillColor("#FFD700").fontSize(18).text("IQONIK", 20, 20);

  if (fs.existsSync(photoPath)) {
    doc.image(photoPath, 20, 50, { width: 60, height: 60 });
  }

  doc.fillColor("#FFFFFF").fontSize(12).text(`Name: ${emp.name}`, 100, 60);
  doc.text(`Emp ID: ${empCode}`, 100, 80);
  doc.text(`Role: Employee`, 100, 100);

  doc.fillColor("#FFD700").fontSize(8).text("IQONIK TECHMART PVT LTD", 20, 140);
  doc.end();

  // PNG
  const canvas = createCanvas(350, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 350, 200);

  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 22px Arial";
  ctx.fillText("IQONIK", 20, 30);

  const img = await loadImage(fs.existsSync(photoPath) ? photoPath : placeholderPath);
  ctx.drawImage(img, 250, 50, 80, 80);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "16px Arial";
  ctx.fillText(`Name: ${emp.name}`, 20, 90);
  ctx.fillText(`Emp ID: ${empCode}`, 20, 120);

  fs.writeFileSync(pngPath, canvas.toBuffer("image/png"));
}

// --- Generate Business Card ---
async function generateBusinessCard(emp, empCode, photoPath) {
  const pdfPath = path.join(outputDir, `${empCode}_BusinessCard.pdf`);
  const pngPath = path.join(outputDir, `${empCode}_BusinessCard.png`);

  const doc = new PDFDocument({ size: "A7", layout: "landscape" });
  doc.pipe(fs.createWriteStream(pdfPath));

  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#FFD700");

  if (fs.existsSync(photoPath)) {
    doc.image(photoPath, 250, 20, { width: 60, height: 60 });
  }

  doc.fillColor("#000000").fontSize(16).text(emp.name, 20, 20);
  doc.fontSize(10).text(`Email: ${emp.email}`, 20, 50);
  doc.text("IQONIK TECHMART PVT LTD", 20, 70);
  doc.text("12-13-677/85, Kimthee Colony,", 20, 90);
  doc.text("Tarnaka, Hyderabad, Telangana – 500017", 20, 105);

  doc.end();

  // PNG
  const canvas = createCanvas(350, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#FFD700";
  ctx.fillRect(0, 0, 350, 200);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 20px Arial";
  ctx.fillText(emp.name, 20, 40);

  ctx.font = "14px Arial";
  ctx.fillText("IQONIK TECHMART PVT LTD", 20, 80);
  ctx.fillText(`Email: ${emp.email}`, 20, 110);

  const img = await loadImage(fs.existsSync(photoPath) ? photoPath : placeholderPath);
  ctx.drawImage(img, 250, 60, 70, 70);

  fs.writeFileSync(pngPath, canvas.toBuffer("image/png"));
}

// --- Main Runner ---
(async () => {
  const client = await connectDb();
  const res = await client.query("SELECT id, name, email, photo_path FROM employees");

  for (let emp of res.rows) {
    const empCode = await generateEmpId(client, emp.id);
    const photoPath = emp.photo_path ? path.join(__dirname, "assets", "photos", emp.photo_path) : placeholderPath;

    await generateIdCard(emp, empCode, photoPath);
    await generateBusinessCard(emp, empCode, photoPath);

    console.log(`✅ Cards generated for ${emp.name} (${empCode})`);
  }

  await client.end();
  console.log("🎉 All Employee Cards generated in assets/cards/");
})();
