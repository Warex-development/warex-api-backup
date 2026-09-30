# 🚀 WareX API (Vercel Serverless Backup)

This repository (`warex-api-backup`) is the **Vercel Serverless Backup** deployment for the WareX backend API.  
The primary backend remains on Render (`https://api.warexhub.com`). Both deployments share the same Supabase database, Supabase Storage, and Resend email services.

---

## 🏗️ Architecture & Serverless Adaptation

1. **Serverless Entrypoint:** `api/index.js` routes all incoming requests to Express via `vercel.json` rewrites (`/(.*) -> /api`).
2. **Cold Start Optimization:** Database schema validation and industry seeding (`schema.sql` and `seedDefaultIndustries`) are skipped when running on Vercel (`process.env.VERCEL`), eliminating cold-start latency.
3. **Database Connection Pool:** `src/config/database.js` sets `max: 2` with short idle timeouts on Vercel to prevent connection exhaustion on Supabase.
4. **Platform Execution Limits:** Function execution timeout is configured to `maxDuration: 60` seconds in `vercel.json` for Vercel Pro.
5. **Request Body Size Limit:** Vercel enforces a platform-level **4.5 MB** limit on request payloads. Uploads > 4 MB are intercepted on the frontend to avoid platform drops.
6. **Rate Limiting:** In-memory rate limiting (`express-rate-limit`) resets across lambda instances. For enterprise DDoS protection, use **Vercel Firewall / WAF Rate Limiting Rules** in the Vercel Dashboard.

---

## 🌿 Branching Strategy

| Branch | Deployment Tier | Purpose | Custom Domain (Recommended) |
| :--- | :--- | :--- | :--- |
| `main` | Production | Live backup for Render Production | `api-backup.warexhub.com` |
| `uat` | Preview / Staging | Backup for UAT testing | `api-backup-uat.warexhub.com` |
| `dev` | Preview / Dev | Active development & testing | Automatic Vercel preview URL |

---

## ⚙️ Vercel Project Setup Guide

### 1. Create Project in Vercel
1. Log in to [Vercel Dashboard](https://vercel.com).
2. Click **"Add New..."** → **"Project"**.
3. Import the repository: `Warex-development/warex-api-backup`.
4. **Framework Preset:** Select `Other`.
5. **Root Directory:** `./` (Leave as root).
6. **Production Branch:** Ensure it is set to `main`.

### 2. Disable Vercel Authentication on Preview Deployments (CRITICAL)
By default, Vercel enables **Deployment Protection (Vercel Authentication)** on Preview deployments (`dev` and `uat`). This protection causes automated API requests from your frontend to fail with `401 Unauthorized`.
* **Fix:**
  1. In Vercel Project Settings, navigate to **Deployment Protection**.
  2. Locate **Vercel Authentication**.
  3. Turn it **OFF** or configure it to bypass API routes so your frontend test environments can communicate with the backup API.

### 3. Custom Domain & DNS Configuration
1. Go to Project **Settings → Domains**.
2. Add your custom domain: `api-backup.warexhub.com` (assigned to `main` branch).
3. Optionally add `api-backup-uat.warexhub.com` (assigned to `uat` branch).
4. **DNS Setup in Cloudflare / Domain Registrar:**
   * Add a `CNAME` record pointing to the **EXACT CNAME value shown in your Vercel Dashboard** (do not use generic values; use the specific target provided by Vercel for your account).
   * **CLOUDFLARE PROXY MUST BE OFF:** Ensure Cloudflare Proxy status is set to **DNS Only** (Grey Cloud icon). Cloudflare proxying in front of Vercel custom domains can cause SSL certificate renewal failures and duplicate header conflicts.

---

## 🔐 Environment Variables Reference

Add the following environment variables in Vercel Project Settings (**Settings → Environment Variables**):

### Production Environment (`main` branch):
* `DATABASE_URL` (Use Supabase **Transaction Pooler** on port `6543`, e.g., `postgresql://postgres.[ref]:[pass]@aws-1-[region].pooler.supabase.com:6543/postgres`)
* `JWT_SECRET` (Must be **IDENTICAL** to Render production)
* `NODE_ENV=production`
* `FRONTEND_URL=https://warexhub.com`
* `ALLOWED_ORIGINS=https://warexhub.com,https://admin.warexhub.com`
* `RESEND_API_KEY` (Must be identical to Render)
* `FROM_EMAIL=noreply@warexhub.com`
* `ADMIN_EMAIL=admin@warexhub.com`
* `SUPABASE_URL` (Must be identical to Render)
* `SUPABASE_ANON_KEY` (Must be identical to Render)
* `SUPABASE_SERVICE_KEY` (Must be identical to Render)
* `SUPABASE_BUCKET_LISTINGS=listing-images`
* `SUPABASE_BUCKET_AVATARS=avatars`
* `SUPABASE_BUCKET_DOCS=vat-documents`
* `SUPABASE_BUCKET_AGREEMENTS=deal-agreements`

### Preview Environment (`uat` / `dev` branches):
* Configure respective UAT/Dev values. **NEVER use the Production database in Preview environments.**

### ⚠️ Sync Checklist for Credentials
Whenever any secret is rotated or updated on Render (such as `JWT_SECRET`, database password, or API keys), **it must also be immediately updated in Vercel Settings**. Desynchronized secrets will prevent seamless authentication failover.

---

## 🔄 Syncing Changes from Primary `warex-api`

When new features, controllers, or bugfixes are committed to the primary `warex-api` repository, run the sync utility to bring them into this backup repository without overwriting Vercel configurations:

```bash
# From warex-api-vercel directory:
node scripts/sync-upstream.js
# Or on Windows:
scripts\sync-upstream.bat
```

### Protected Files that are NOT Overwritten:
* `server.js` (Contains Vercel serverless exports; script will alert you if upstream differences exist)
* `src/config/database.js` (Contains Vercel pool tuning; script will alert you if upstream differences exist)
* `api/index.js`
* `vercel.json`
* `.vercelignore`
* `README.md`

After running the sync, test locally on the `dev` branch, commit, and push:
```bash
git add .
git commit -m "Sync upstream features from warex-api"
git push origin dev
```

---

## ⚡ Frontend Integration Note
In `warex-web`, the fallback URL is provided via:
```env
VITE_API_BACKUP_URL=https://api-backup.warexhub.com
```
* **IMPORTANT:** `VITE_API_BACKUP_URL` is baked into the frontend bundle at **build-time**. Whenever you set or update this variable in your hosting platform, you **must trigger a frontend redeployment** for the change to take effect.
