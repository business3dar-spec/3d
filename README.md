# 3D Viewer SaaS — Deployment Guide

A complete beginner's guide to deploying on Railway.

---

## FOLDER STRUCTURE

```
saas-3d-viewer/
├── index.js              ← Main server (Express)
├── package.json
├── .env.example          ← Copy to .env with your values
├── .gitignore
│
├── db/
│   ├── index.js          ← Database connection
│   └── schema.sql        ← Tables (runs automatically on startup)
│
├── bot/
│   └── index.js          ← Telegram bot
│
├── public/
│   ├── index.html        ← Landing page
│   ├── viewer.html       ← 3D viewer page (public)
│   ├── dashboard.html    ← Company dashboard (upload products)
│   ├── blocked.html      ← Shown when company isn't approved
│   └── 404.html
│
└── uploads/
    ├── images/           ← Product thumbnails
    └── models/           ← .glb / .gltf files
```

---

## STEP 1 — Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send: `/newbot`
3. Give it a name (e.g. "My 3D Viewer Bot")
4. Give it a username (e.g. "my3dviewer_bot")
5. BotFather gives you a **token** — save it!
6. To get YOUR admin user ID: message **@userinfobot** on Telegram

---

## STEP 2 — Deploy on Railway (Free Tier)

### A. Create a Railway account
Go to https://railway.app and sign up (free)

### B. Create a new project
1. Click **New Project**
2. Click **Deploy from GitHub repo** (or **Empty Project** to deploy via CLI)

### C. Add a PostgreSQL database
1. In your project, click **+ New Service**
2. Choose **Database → PostgreSQL**
3. Click on the database → go to **Variables** tab
4. Copy the `DATABASE_URL` value

### D. Create the web service
1. Click **+ New Service → GitHub Repo**
2. Connect your GitHub and select your repo
3. Railway auto-detects Node.js

### E. Set environment variables
In your web service → **Variables** tab, add:

```
DATABASE_URL       = (paste from PostgreSQL service)
TELEGRAM_BOT_TOKEN = (from BotFather)
BASE_URL           = https://your-app-name.railway.app
ADMIN_USER_ID      = (your Telegram user ID number)
SESSION_SECRET     = any-long-random-string-here-abc123xyz
```

### F. Set the start command
In **Settings → Deploy**:
```
Start Command: node index.js
```

### G. Deploy!
Railway will build and deploy automatically.
The database tables are created automatically on first startup.

---

## STEP 3 — Update the Telegram Bot link

In `public/index.html`, find this line:
```html
<a href="https://t.me/YOUR_BOT_USERNAME" ...>
```
Replace `YOUR_BOT_USERNAME` with your actual bot username (without @).

---

## HOW IT WORKS (for you as admin)

1. A company messages your bot with `/register Company Name`
2. You receive a Telegram notification
3. You reply with `/approve 1` (where 1 is the company ID)
4. The company gets notified and receives their dashboard link
5. They upload .glb products via the dashboard
6. Their public 3D viewer page is live at: `your-app.railway.app/view/1`

### Bot commands (admin only):
- `/pending` — see all waiting approvals
- `/approve <id>` — approve a company
- `/reject <id>` — reject a company
- `/list` — see all companies

### Bot commands (companies):
- `/register Company Name` — sign up
- `/status` — check approval status

---

## ADDING MORE PRODUCTS TO RAILWAY

Railway's free tier stores files in the container — they reset on redeploy.
For production with many files, consider:
- **Cloudflare R2** (free 10GB) — swap the upload path to upload to R2 and serve from there
- **AWS S3** — industry standard

For MVP/testing, local storage is fine.

---

## FUTURE: Chapa Payment Integration

To add payments later:
1. Add a `chapa_payment_id` column to the `companies` table
2. Create a `/pay` endpoint that calls Chapa's API
3. On Chapa webhook success → set `payment_status = 'approved'` automatically
4. Remove manual Telegram approval for paying customers

The database schema is already structured to support this.
