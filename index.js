// index.js - Main Server
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const { startBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Ensure upload folders exist ───────────────────────────────────────────
['uploads/images', 'uploads/models'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));  // serve uploaded files
app.set('view engine', 'html');

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }  // set true if using HTTPS only
}));

// ── File upload config ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isModel = file.fieldname === 'model';
    cb(null, isModel ? 'uploads/models' : 'uploads/images');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },  // 50MB max
  fileFilter: (req, file, cb) => {
    const allowedModels = ['.glb', '.gltf'];
    const allowedImages = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'model' && !allowedModels.includes(ext)) {
      return cb(new Error('Only .glb and .gltf model files allowed'));
    }
    if (file.fieldname === 'image' && !allowedImages.includes(ext)) {
      return cb(new Error('Only JPG, PNG, WEBP images allowed'));
    }
    cb(null, true);
  }
});

// ── Initialize DB tables ──────────────────────────────────────────────────
async function initDb() {
  const schema = fs.readFileSync('./db/schema.sql', 'utf8');
  await db.query(schema);
  console.log('✅ Database tables ready');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// ── Home page ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Public 3D viewer page (blocked if not approved) ──────────────────────
app.get('/view/:companyId', async (req, res) => {
  const { companyId } = req.params;

  const companyResult = await db.query(
    'SELECT * FROM companies WHERE id = $1',
    [companyId]
  );

  if (companyResult.rows.length === 0) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }

  const company = companyResult.rows[0];

  if (company.payment_status !== 'approved') {
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  const productsResult = await db.query(
    'SELECT * FROM products WHERE company_id = $1 AND is_active = true ORDER BY created_at DESC',
    [companyId]
  );

  // Serve the viewer HTML (inject data via script tag)
  const viewerHtml = fs.readFileSync(path.join(__dirname, 'public', 'viewer.html'), 'utf8')
    .replace('__COMPANY_DATA__', JSON.stringify(company))
    .replace('__PRODUCTS_DATA__', JSON.stringify(productsResult.rows));

  res.send(viewerHtml);
});

// ── Dashboard page ────────────────────────────────────────────────────────
app.get('/dashboard/:companyId', async (req, res) => {
  const result = await db.query(
    'SELECT * FROM companies WHERE id = $1',
    [req.params.companyId]
  );

  if (result.rows.length === 0) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }

  const company = result.rows[0];
  if (company.payment_status !== 'approved') {
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ═══════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/company/:id - get company info + products
app.get('/api/company/:id', async (req, res) => {
  try {
    const company = await db.query('SELECT id, name, plan, payment_status FROM companies WHERE id = $1', [req.params.id]);
    if (company.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const products = await db.query(
      'SELECT * FROM products WHERE company_id = $1 AND is_active = true ORDER BY created_at DESC',
      [req.params.id]
    );

    const limits = await db.query('SELECT max_products FROM plan_limits WHERE plan = $1', [company.rows[0].plan]);

    res.json({
      company: company.rows[0],
      products: products.rows,
      maxProducts: limits.rows[0]?.max_products || 5
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/products - upload a new product
app.post('/api/products', upload.fields([{ name: 'model', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const { company_id, name, description } = req.body;

    if (!company_id || !name) {
      return res.status(400).json({ error: 'company_id and name are required' });
    }

    // Check company is approved
    const companyResult = await db.query(
      'SELECT * FROM companies WHERE id = $1 AND payment_status = $2',
      [company_id, 'approved']
    );
    if (companyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Company not approved' });
    }

    // Check product limit
    const company = companyResult.rows[0];
    const limitResult = await db.query('SELECT max_products FROM plan_limits WHERE plan = $1', [company.plan]);
    const maxProducts = limitResult.rows[0]?.max_products || 5;
    const countResult = await db.query('SELECT COUNT(*) FROM products WHERE company_id = $1', [company_id]);
    if (parseInt(countResult.rows[0].count) >= maxProducts) {
      return res.status(400).json({ error: `Plan limit reached (${maxProducts} products). Upgrade to add more.` });
    }

    if (!req.files?.model) {
      return res.status(400).json({ error: 'A .glb or .gltf model file is required' });
    }

    const modelUrl = `/uploads/models/${req.files.model[0].filename}`;
    const imageUrl = req.files?.image ? `/uploads/images/${req.files.image[0].filename}` : null;

    const result = await db.query(
      `INSERT INTO products (company_id, name, description, image_url, model_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [company_id, name, description || '', imageUrl, modelUrl]
    );

    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// DELETE /api/products/:id - delete a product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { company_id } = req.body;
    await db.query(
      'UPDATE products SET is_active = false WHERE id = $1 AND company_id = $2',
      [req.params.id, company_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── Start server ──────────────────────────────────────────────────────────
initDb()
  .then(() => {
    startBot();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  });
