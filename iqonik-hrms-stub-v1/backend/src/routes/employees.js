const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Upload folder
const uploadDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Upload Docs (PDF/PNG)
router.post(
  "/:id/docs",
  upload.single("document"),
  async (req, res) => {
    const { id } = req.params;
    const { doc_type } = req.body;
    const filePath = req.file.path.replace(/\\/g, "/");

    await db.query(
      `INSERT INTO employee_docs(employee_id, doc_type, file_path, file_type)
       VALUES($1, $2, $3, $4)`,
      [id, doc_type, filePath, path.extname(req.file.originalname).slice(1)]
    );

    res.json({ success: true, path: filePath });
  }
);
