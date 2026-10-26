import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString,
});

export function generateBusinessIdCode(name, id) {
  const words = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const acronymSource =
    words.length >= 3
      ? words.map((word) => word[0]).join("")
      : words.join("");
  const acronym = `${acronymSource.replace(/[^A-Z0-9]/g, "")}XXX`.slice(0, 3);

  return `${acronym}_${String(id).padStart(3, "0")}`;
}

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS last_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS username VARCHAR(120),
      ADD COLUMN IF NOT EXISTS business_name VARCHAR(160),
      ADD COLUMN IF NOT EXISTS profile_image TEXT,
      ADD COLUMN IF NOT EXISTS banner_image TEXT,
      ADD COLUMN IF NOT EXISTS password_otp_hash TEXT,
      ADD COLUMN IF NOT EXISTS password_otp_expires_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS password_otp_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS password_reset_hash TEXT,
      ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'owner',
      ADD COLUMN IF NOT EXISTS permissions JSONB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      business_id_code VARCHAR(20),
      status CHAR(1) NOT NULL DEFAULT 'A',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE businesses
      ADD COLUMN IF NOT EXISTS business_id_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS logo_image TEXT,
      ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 3;
  `);

  const businessCodeRows = await pool.query(`
    SELECT id, name
    FROM businesses
    WHERE business_id_code IS NULL OR TRIM(business_id_code) = '';
  `);

  for (const business of businessCodeRows.rows) {
    await pool.query(
      "UPDATE businesses SET business_id_code = $1, updated_at = NOW() WHERE id = $2",
      [generateBusinessIdCode(business.name, business.id), business.id],
    );
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS businesses_business_id_code_unique
    ON businesses (business_id_code);
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
  `);

  await pool.query(`
    INSERT INTO businesses (name, status)
    SELECT DISTINCT TRIM(business_name), 'A'
    FROM users
    WHERE business_name IS NOT NULL
      AND TRIM(business_name) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM businesses
        WHERE LOWER(businesses.name) = LOWER(TRIM(users.business_name))
      );
  `);

  await pool.query(`
    INSERT INTO businesses (name, status)
    SELECT 'CowFlo', 'A'
    WHERE NOT EXISTS (
      SELECT 1 FROM businesses WHERE LOWER(name) = LOWER('CowFlo')
    );
  `);

  const missingBusinessCodeRows = await pool.query(`
    SELECT id, name
    FROM businesses
    WHERE business_id_code IS NULL OR TRIM(business_id_code) = '';
  `);

  for (const business of missingBusinessCodeRows.rows) {
    await pool.query(
      "UPDATE businesses SET business_id_code = $1, updated_at = NOW() WHERE id = $2",
      [generateBusinessIdCode(business.name, business.id), business.id],
    );
  }

  await pool.query(`
    UPDATE users
    SET business_name = 'CowFlo'
    WHERE business_name IS NULL OR TRIM(business_name) = '';
  `);

  await pool.query(`
    UPDATE users
    SET business_id = businesses.id
    FROM businesses
    WHERE users.business_id IS NULL
      AND LOWER(businesses.name) = LOWER(TRIM(users.business_name));
  `);

  await pool.query(`
    UPDATE users
    SET business_id = businesses.id
    FROM businesses
    WHERE users.business_id IS NULL
      AND LOWER(businesses.name) = LOWER('CowFlo');
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
    ON users (LOWER(username))
    WHERE username IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id INTEGER REFERENCES businesses(id),
      name VARCHAR(160) NOT NULL,
      details TEXT,
      pos_code VARCHAR(80) NOT NULL,
      is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Branches used to have a "username"; it is now free-text "details".
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'username'
      ) THEN
        ALTER TABLE branches RENAME COLUMN username TO details;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE branches
      ALTER COLUMN details TYPE TEXT,
      ALTER COLUMN details DROP NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
  `);

  await pool.query(`
    UPDATE branches
    SET business_id = users.business_id
    FROM users
    WHERE branches.business_id IS NULL
      AND branches.user_id = users.id;
  `);

  await pool.query(`
    ALTER TABLE branches
      ALTER COLUMN business_id SET NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS branches_user_sort_idx
    ON branches (user_id, sort_order, id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS branches_business_sort_idx
    ON branches (business_id, sort_order, id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      stocks INTEGER NOT NULL DEFAULT 0,
      price NUMERIC(12, 2) NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      image_data TEXT,
      image_mime VARCHAR(80),
      image_name VARCHAR(255),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS image_data TEXT,
      ADD COLUMN IF NOT EXISTS image_mime VARCHAR(80),
      ADD COLUMN IF NOT EXISTS image_name VARCHAR(255);
  `);

  await pool.query(`
    WITH ranked_items AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY sort_order ASC, id ASC) AS next_sort_order
      FROM inventory_items
    )
    UPDATE inventory_items
    SET sort_order = ranked_items.next_sort_order
    FROM ranked_items
    WHERE inventory_items.id = ranked_items.id;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_skus (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(120) NOT NULL,
      sku_number INTEGER NOT NULL,
      branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (business_id, sku_number)
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_skus_business_name_unique
    ON inventory_skus (business_id, LOWER(sku));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_categories (
      id SERIAL PRIMARY KEY,
      category_name VARCHAR(120) NOT NULL,
      sku_id INTEGER NOT NULL REFERENCES inventory_skus(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_categories_sku_name_unique
    ON inventory_categories (sku_id, LOWER(category_name));
  `);

  // SKU numbers come from a per-business counter, so a deleted SKU's number is never handed out again.
  // 0 means none issued yet, so the first SKU is number 1 (shown as "001").
  await pool.query(`
    ALTER TABLE businesses
      ADD COLUMN IF NOT EXISTS last_sku_number INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    UPDATE businesses
    SET last_sku_number = sku_max.max_number
    FROM (
      SELECT business_id, MAX(sku_number) AS max_number
      FROM inventory_skus
      GROUP BY business_id
    ) sku_max
    WHERE businesses.id = sku_max.business_id
      AND businesses.last_sku_number < sku_max.max_number;
  `);

  await pool.query(`
    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS sku_id INTEGER REFERENCES inventory_skus(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES inventory_categories(id) ON DELETE SET NULL;
  `);

  // Versions the image URL, so browsers cache an item's image until the image itself changes.
  await pool.query(`
    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMP WITH TIME ZONE;
  `);

  await pool.query(`
    UPDATE inventory_items
    SET image_updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE image_data IS NOT NULL AND image_updated_at IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_item_branches (
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      assigned_stocks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (inventory_item_id, branch_id)
    );
  `);

  await pool.query(`
    ALTER TABLE inventory_item_branches
      ADD COLUMN IF NOT EXISTS assigned_stocks INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS inventory_items_business_idx
    ON inventory_items (business_id, sort_order, id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS inventory_item_branches_branch_idx
    ON inventory_item_branches (branch_id, inventory_item_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_stock_history (
      id SERIAL PRIMARY KEY,
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      action VARCHAR(20) NOT NULL,
      quantity INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS inventory_stock_history_item_idx
    ON inventory_stock_history (inventory_item_id, created_at DESC, id DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_price_history (
      id SERIAL PRIMARY KEY,
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      old_price NUMERIC(12, 2),
      new_price NUMERIC(12, 2) NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS inventory_price_history_item_idx
    ON inventory_price_history (inventory_item_id, created_at DESC, id DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_sales (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      receipt_code VARCHAR(40) UNIQUE NOT NULL,
      total_items INTEGER NOT NULL,
      total_amount NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
      inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
      item_code VARCHAR(40) NOT NULL,
      item_name VARCHAR(160) NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price NUMERIC(12, 2) NOT NULL,
      total_price NUMERIC(12, 2) NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pos_sales_branch_created_idx
    ON pos_sales (branch_id, created_at DESC, id DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_refunds (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      sale_id INTEGER REFERENCES pos_sales(id) ON DELETE SET NULL,
      refund_code VARCHAR(40) UNIQUE NOT NULL,
      total_items INTEGER NOT NULL,
      total_amount NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_refund_items (
      id SERIAL PRIMARY KEY,
      refund_id INTEGER NOT NULL REFERENCES pos_refunds(id) ON DELETE CASCADE,
      sale_item_id INTEGER REFERENCES pos_sale_items(id) ON DELETE SET NULL,
      inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
      item_code VARCHAR(40) NOT NULL,
      item_name VARCHAR(160) NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price NUMERIC(12, 2) NOT NULL,
      total_price NUMERIC(12, 2) NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pos_refunds_branch_created_idx
    ON pos_refunds (branch_id, created_at DESC, id DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pos_refund_items_sale_item_idx
    ON pos_refund_items (sale_item_id);
  `);
}
