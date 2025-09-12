import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __dirname = path.resolve();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "https://cdn.tailwindcss.com", "'unsafe-inline'"],
      "connect-src": ["'self'"],
    }
  }
}));

// CORS (same-origin by default)
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || false }));

// Rate limiting for upload endpoint
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// Serve static frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Root route handler
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'server', 'uploads');
await fs.mkdir(UPLOAD_DIR, { recursive: true });

// Multer config
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '25', 10) * 1024 * 1024; // MB -> bytes
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const matter = (req.body.matterId || 'general').replace(/[^a-zA-Z0-9-_]/g, '_');
    const dir = path.join(UPLOAD_DIR, matter);
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = crypto.randomBytes(16).toString('hex');
    cb(null, `${base}${ext}`);
  }
});

const allowed = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain'
]);

function fileFilter(req, file, cb) {
  if (allowed.has(file.mimetype)) cb(null, true);
  else cb(new Error('Unsupported file type: ' + file.mimetype));
}

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE, files: 10 }, fileFilter });

app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    const { fullName, email, phone, matterId, summary } = req.body;
    if (!fullName || !email) {
      return res.status(400).send('Name and email are required.');
    }

    // Basic server-side sanitation
    const clean = (s) => String(s || '').trim().slice(0, 2000);

    // Write a simple intake JSON alongside files
    const meta = {
      receivedAt: new Date().toISOString(),
      fullName: clean(fullName),
      email: clean(email),
      phone: clean(phone),
      matterId: clean(matterId || 'general'),
      summary: clean(summary),
      files: (req.files || []).map(f => ({ original: f.originalname, savedAs: f.filename, size: f.size, mimetype: f.mimetype }))
    };

    const metaPath = path.join(UPLOAD_DIR, meta.matterId.replace(/[^a-zA-Z0-9-_]/g,'_'), `intake-${Date.now()}.json`);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    // TODO (optional): notify intake team via email or Slack.
    // Example (Nodemailer):
    // import nodemailer from 'nodemailer';
    // const transporter = nodemailer.createTransport({
    //   host: process.env.SMTP_HOST,
    //   port: Number(process.env.SMTP_PORT || 587),
    //   secure: false,
    //   auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    // });
    // await transporter.sendMail({
    //   from: 'no-reply@tranwonglaw.com',
    //   to: process.env.INTAKE_EMAIL,
    //   subject: `New upload from ${meta.fullName}`,
    //   text: `Matter: ${meta.matterId}\nFiles: ${meta.files.length}`
    // });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(400).send(err.message || 'Upload failed');
  }
});

// Fallback 404 for other API routes
app.use('/api/*', (req, res) => res.status(404).send('Not found'));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));