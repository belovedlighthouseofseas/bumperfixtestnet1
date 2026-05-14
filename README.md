# bumperfixtestnet1

Local-first command center for the Bumper Fix site.

## Workflow

```
Edit files locally  →  GitHub Desktop (commit + push)  →  GitHub  →  Vercel auto-deploy
```

1. Edit any HTML / API file in this folder.
2. Open **GitHub Desktop** — review the diff, write a commit message, click **Commit to main**, then **Push origin**.
3. Vercel picks up the push to `main` and deploys automatically.

## Structure

- `*.html` — public pages (home, services, pricing, contact, admin, 13 location pages)
- `api/` — Vercel serverless functions (Twilio SMS + verification, Supabase bookings, admin auth)
- `logo.png` — site logo
- `package.json` — Node dependencies (`twilio`, `@supabase/supabase-js`)
- `vercel.json` — Vercel routing + security headers
- `.env.example` — template of required environment variables
- `.gitignore` — files excluded from git

## First-time setup

1. Copy `.env.example` to `.env` and fill in real keys (Twilio, Supabase, admin password, owner phone).
2. Run `npm install` if you want to test API functions locally.
3. In the Vercel dashboard, connect this GitHub repo as a project and add the same env vars under **Project Settings → Environment Variables**.

## Required environment variables

Set these in `.env` locally **and** in Vercel:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_PHONE_NUMBER`
- `OWNER_PHONE`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `ADMIN_PASSWORD`

## Local preview

This is a static site with serverless functions, so opening the HTML directly works for layout checks, but `api/*` endpoints will only work when deployed (or via `vercel dev`).
