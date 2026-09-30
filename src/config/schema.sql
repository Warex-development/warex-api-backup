-- ============================================================
-- WareXhub Complete Database Schema
-- Last updated: 2026-05-17 (updated listings quantity and is_hidden)
-- ============================================================

-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  company_name TEXT,
  vat_number VARCHAR(100) UNIQUE,
  pan_number VARCHAR(100) UNIQUE,
  country TEXT,
  industry VARCHAR(100),
  industry_other VARCHAR(255),
  mobile TEXT,
  code VARCHAR(50) UNIQUE,
  party_code VARCHAR(50),
  avatar VARCHAR(10),
  role TEXT DEFAULT 'member',
  status VARCHAR(50) DEFAULT 'pending',
  mode VARCHAR(50) DEFAULT 'member',
  plan VARCHAR(50) DEFAULT 'Standard',
  plan_cycle VARCHAR(50) DEFAULT 'monthly',
  plan_expiry TIMESTAMPTZ,
  plan_status VARCHAR(50),
  plan_price NUMERIC(12,2),
  upgraded_at TIMESTAMP,
  address TEXT,
  agreed_nda BOOLEAN DEFAULT false,
  agreed_terms BOOLEAN DEFAULT false,
  temp_password VARCHAR(255),
  vat_document_path VARCHAR(500),
  rejection_reason TEXT,
  approved_by UUID,
  approved_on TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add missing columns to existing users table (safe migrations)
ALTER TABLE users ADD COLUMN IF NOT EXISTS industry_other VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vat_document_path VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_on TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_status VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_price NUMERIC(12,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_mode VARCHAR(20) DEFAULT 'buyer';

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_vat_number ON users(vat_number);
CREATE INDEX IF NOT EXISTS idx_users_pan_number ON users(pan_number);
CREATE INDEX IF NOT EXISTS idx_users_code ON users(code);

-- ─── CATEGORIES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  icon VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

-- ─── PRODUCTS (legacy — kept for backward compat) ─────────────
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2),
  category_id UUID REFERENCES categories(id),
  created_by UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  oem VARCHAR(255),
  make VARCHAR(255),
  manufacturer VARCHAR(255),
  condition VARCHAR(100),
  year INTEGER,
  bid_price DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'pending',
  eta VARCHAR(100),
  availability VARCHAR(100),
  image_color VARCHAR(100),
  application VARCHAR(255),
  submitted_date TIMESTAMP,
  approved_date TIMESTAMP,
  seller_id UUID,
  approved_by UUID,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);

-- ─── LISTINGS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id VARCHAR(50) UNIQUE NOT NULL,

  -- Core item fields
  name VARCHAR(255) NOT NULL,
  item_name VARCHAR(255),
  description TEXT,
  oem VARCHAR(255),
  oem_part_no VARCHAR(255),
  make VARCHAR(255),
  manufacturer VARCHAR(255),
  condition VARCHAR(100),
  year INTEGER,
  year_of_purchase INTEGER,
  eta VARCHAR(100),
  availability VARCHAR(100),
  application TEXT[],

  -- Images & media
  images TEXT[],
  image_url TEXT,
  document_url VARCHAR(500),

  -- Pricing
  seller_bid_price DECIMAL(12, 2),
  bid_price DECIMAL(12, 2),
  buyer_visible_min DECIMAL(12, 2),
  buyer_visible_max DECIMAL(12, 2),
  admin_counter_price DECIMAL(12, 2),
  pricing_status VARCHAR(50) DEFAULT 'initial',

  -- Remarks
  remarks TEXT,

  -- Approval workflow
  status VARCHAR(50) DEFAULT 'pending',
  rejection_reason TEXT,
  approved_by UUID REFERENCES users(id),
  approved_on TIMESTAMP,
  approved_at TIMESTAMP,

  -- Relationships
  category_id UUID REFERENCES categories(id),
  seller_id UUID REFERENCES users(id),

  -- Quantity & Visibility V2
  quantity INTEGER DEFAULT 1,
  is_hidden BOOLEAN DEFAULT false,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add missing listing columns (safe migrations)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS item_name VARCHAR(255);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS oem_part_no VARCHAR(255);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS year_of_purchase INTEGER;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS bid_price DECIMAL(12,2);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS document_url VARCHAR(500);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS warranty_months INTEGER DEFAULT 0;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS update_status VARCHAR(50) DEFAULT 'none';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS pending_updates JSONB;

CREATE INDEX IF NOT EXISTS idx_listings_request_id ON listings(request_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_seller_id ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_category_id ON listings(category_id);

-- ─── BUYER REQUESTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id VARCHAR(50) UNIQUE NOT NULL,
  buyer_id UUID REFERENCES users(id),
  listing_id UUID REFERENCES listings(id),
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  oem VARCHAR(255),
  make VARCHAR(255),
  manufacturer VARCHAR(255),
  condition_preference VARCHAR(100),
  quantity INTEGER,
  budget_min DECIMAL(12, 2),
  budget_max DECIMAL(12, 2),
  urgency VARCHAR(50),
  category_id UUID REFERENCES categories(id),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE buyer_requests ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES listings(id);

CREATE INDEX IF NOT EXISTS idx_buyer_requests_buyer_id ON buyer_requests(buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_requests_status ON buyer_requests(status);

-- ─── NOTIFICATIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'system',
  link VARCHAR(255),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- ─── DEALS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id VARCHAR(50) UNIQUE,
  quote_id UUID,
  listing_id UUID REFERENCES listings(id),
  buyer_id UUID REFERENCES users(id),
  seller_id UUID REFERENCES users(id),
  buyer_request_id UUID REFERENCES buyer_requests(id),
  request_id UUID,
  final_price DECIMAL(12, 2),
  deal_value DECIMAL(12, 2),
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2),
  warex_revenue DECIMAL(12, 2),
  seller_payout DECIMAL(12, 2),
  revenue_model VARCHAR(50),
  quantity INTEGER DEFAULT 1,
  unit_price NUMERIC DEFAULT 0,
  stage VARCHAR(50) DEFAULT 'initiated',
  status VARCHAR(50) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS seller_payout DECIMAL(12,2);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS revenue_model VARCHAR(50);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS unit_price NUMERIC DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS seller_nda_doc VARCHAR(500);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS buyer_nda_doc VARCHAR(500);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS nda_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS wallet_discount NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS special_discount NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS proforma_url VARCHAR(500);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS proforma_date TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS proforma_edit_count INTEGER DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS proforma_locked BOOLEAN DEFAULT false;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS proforma_data JSONB;

CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_buyer_id ON deals(buyer_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller_id ON deals(seller_id);

-- ─── COMMISSIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  seller_id UUID REFERENCES users(id),
  buyer_id UUID REFERENCES users(id),
  deal_value DECIMAL(12, 2) NOT NULL,
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2) NOT NULL,
  total_revenue DECIMAL(12, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commissions_created_at ON commissions(created_at);

-- ─── MEMBERSHIP REQUESTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  plan_type VARCHAR(100),
  plan_price NUMERIC(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  admin_note TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS plan_price NUMERIC(12,2);
ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- ─── GUEST LEADS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  message TEXT,
  listing_id UUID,
  status VARCHAR(50) DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_leads_status ON guest_leads(status);
CREATE INDEX IF NOT EXISTS idx_guest_leads_created_at ON guest_leads(created_at);

-- ─── REVENUE LOG ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type VARCHAR(100),
  reference_id UUID,
  amount NUMERIC(12,2),
  currency VARCHAR(10) DEFAULT 'NPR',
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- ─── INDUSTRIES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS industries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  icon VARCHAR(255),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_industries_name ON industries(name);

-- ─── CONTACT MESSAGES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at);

-- ─── WAREXPEDIA DOCUMENTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warexpedia_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  file_url text NOT NULL,
  thumbnail_url text,
  file_type text NOT NULL,
  file_size_kb INTEGER,
  contributor_name VARCHAR(150) NOT NULL,
  contributor_company VARCHAR(200),
  contributor_email VARCHAR(200) NOT NULL,
  contributor_phone VARCHAR(30),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  extracted_text TEXT,
  views INTEGER DEFAULT 0,
  downloads INTEGER DEFAULT 0,
  helpful_yes INTEGER DEFAULT 0,
  helpful_no INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'published',
  verification_status VARCHAR(30) DEFAULT 'not_verified',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_created ON warexpedia_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wp_status ON warexpedia_documents(status);

-- ─── WALLETS & LEDGER ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  is_valid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL,
  related_listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  related_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_listing_id ON wallet_transactions(related_listing_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_deal_id ON wallet_transactions(related_deal_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transactions(created_at DESC);

-- ─── PLATFORM BANK ACCOUNTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name VARCHAR(200) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  branch VARCHAR(100) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safe migration for deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bank_details JSONB;

-- Insert default company bank account if empty
INSERT INTO bank_accounts (bank_name, account_name, account_number, branch, is_default, is_active)
SELECT 'Nepal Investment Mega Bank', 'Future Techniques P. Ltd.', '00401040250962', 'Pulchowk', true, true
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts);

-- ─── PLATFORM SETTINGS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


