import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { createCanvas, loadImage } from 'canvas';

export async function generateCardsForEmployee(empId, name, email) {
  const outDir = path.join('cards', empId);
  fs.mkdirSync(outDir, { recursive: true });

  // ====== ID CARD ======
  await generateIdCard(empId, name, email, outDir);

  // ====== BUSINESS CARD ======
  await generateBusinessCard(empId, name, email, outDir);

  return { ok: true, outDir };
}

/* ================= ID CARD ================= */
async function generateIdCard(empId, name, email, outDir) {
  const width = 400, height = 250;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Header bar
  ctx.fillStyle = '#212326';
  ctx.fillRect(0, 0, width, 50);
  ctx.fillStyle = '#f2d4ba';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('IQONIK ID CARD', 120, 30);

  // Employee details
  ctx.fillStyle = '#000000';
  ctx.font = '16px Arial';
  ctx.fillText(`Employee ID: ${empId}`, 20, 80);
  ctx.fillText(`Name: ${name}`, 20, 110);
  ctx.fillText(`Email: ${email}`, 20, 140);

  // Save PNG
  const idPng = path.join(outDir, `idcard_${empId}.png`);
  fs.writeFileSync(idPng, canvas.toBuffer('image/png'));

  // Save PDF
  const idPdf = path.join(outDir, `idcard_${empId}.pdf`);
  const doc = new PDFDocument({ size: [width, height] });
  doc.pipe(fs.createWriteStream(idPdf));
  doc.image(canvas.toBuffer('image/png'), 0, 0, { width, height });
  doc.end();
}

/* ================= BUSINESS CARD ================= */
async function generateBusinessCard(empId, name, email, outDir) {
  const width = 400, height = 200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#f2d4ba';
  ctx.fillRect(0, 0, width, height);

  // Text
  ctx.fillStyle = '#212326';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('IQONIK BUSINESS CARD', 60, 40);

  ctx.font = '16px Arial';
  ctx.fillText(name, 20, 100);
  ctx.fillText(email, 20, 130);
  ctx.fillText(`Employee ID: ${empId}`, 20, 160);

  // Save PNG
  const bcPng = path.join(outDir, `businesscard_${empId}.png`);
  fs.writeFileSync(bcPng, canvas.toBuffer('image/png'));

  // Save PDF
  const bcPdf = path.join(outDir, `businesscard_${empId}.pdf`);
  const doc = new PDFDocument({ size: [width, height] });
  doc.pipe(fs.createWriteStream(bcPdf));
  doc.image(canvas.toBuffer('image/png'), 0, 0, { width, height });
  doc.end();
}
