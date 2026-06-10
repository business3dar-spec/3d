-- ============================================
-- SaaS 3D Product Viewer - Database Schema
-- ============================================

-- Companies table (one row per paying customer)
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telegram_chat_id TEXT,                    -- filled when they message the bot
  payment_status TEXT DEFAULT 'pending',    -- pending | approved | rejected
  plan TEXT DEFAULT 'starter',              -- starter | pro | enterprise (future)
  subdomain TEXT UNIQUE,                    -- e.g. "acme" → acme.yourdomain.com (future)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products table (3D models uploaded by companies)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,                           -- path to poster/thumbnail image
  model_url TEXT NOT NULL,                  -- path to .glb / .gltf file
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plan limits (how many products per plan)
CREATE TABLE IF NOT EXISTS plan_limits (
  plan TEXT PRIMARY KEY,
  max_products INTEGER NOT NULL
);

INSERT INTO plan_limits (plan, max_products) VALUES
  ('starter', 5),
  ('pro', 25),
  ('enterprise', 999)
ON CONFLICT DO NOTHING;
