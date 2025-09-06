// src/utils/buildEmployeeIndex.js
import fs from "fs";
import path from "path";

const DOCS_DIR = path.join(process.cwd(), "docs");
const CARDS_DIR = path.join(process.cwd(), "cards");

function ensureIndexForEmployee(empId) {
  const empDocs = path.join(DOCS_DIR, empId);
  const empCards = path.join(CARDS_DIR, empId);

  const index = {
    employee_id: empId,
    docs: [],
    cards: []
  };

  if (fs.existsSync(empDocs)) {
    index.docs = fs.readdirSync(empDocs).map(f => `/docs/${empId}/${f}`);
  }

  if (fs.existsSync(empCards)) {
    index.cards = fs.readdirSync(empCards).map(f => `/cards/${empId}/${f}`);
  }

  // Save inside docs/employeeId/index.json
  const outPath = path.join(empDocs, "index.json");
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2));
  console.log(`✅ Index built for ${empId}`);
}

function buildAll() {
  if (!fs.existsSync(DOCS_DIR)) return;
  const employees = fs.readdirSync(DOCS_DIR);
  for (const empId of employees) {
    ensureIndexForEmployee(empId);
  }
}

buildAll();
