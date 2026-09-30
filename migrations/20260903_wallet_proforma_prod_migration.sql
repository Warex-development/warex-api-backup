-- ==============================================================================
-- WAREXHUB PRODUCTION MIGRATION SCRIPT
-- Feature: Member Wallet System + Proforma & Negotiation Flow
-- Generated: 2026-09-03
-- Execution: Run this script directly on the production PostgreSQL / Supabase DB.
-- All statements are safe & idempotent (IF NOT EXISTS / DO NOTHING).
-- ==============================================================================

BEGIN;

-- 1. Create WALLETS Table
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  is_valid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);

-- 2. Create WALLET_TRANSACTIONS Table
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'credit_listing', 'debit_purchase', 'reversal_hidden_listing', 'reversal_deleted_listing', 'recredit_unhidden_listing', 'deal_refund'
  amount NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL,
  related_listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  related_deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON public.wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_listing_id ON public.wallet_transactions(related_listing_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_deal_id ON public.wallet_transactions(related_deal_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON public.wallet_transactions(created_at DESC);

-- 3. Add Columns to DEALS Table for Wallet Discount & Proforma
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS wallet_discount NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS special_discount NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12, 2);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS proforma_url TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS proforma_date TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS proforma_edit_count INT DEFAULT 0;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS proforma_locked BOOLEAN DEFAULT false;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS proforma_data JSONB;

-- 4. Create Wallets for all existing Active Members (if not existing)
INSERT INTO public.wallets (user_id, balance, is_valid)
SELECT id, 0.00, true
FROM public.users
WHERE role = 'member'
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- ==============================================================================
-- Migration complete.
-- After running this SQL in production, run the backfill script:
--   node scripts/backfill-wallets.js
-- to award NPR 500 for existing approved listings.
-- ==============================================================================
