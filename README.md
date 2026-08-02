# NVOCC Freight CRM + Customer Portal

A shipment-management system for an NVOCC / freight forwarder, with a
customer-facing portal. Staff and customers log in; customers see only their
own shipments; every item can be printed as a barcode label.

Built with **zero external dependencies** — only Node.js's built-in web server,
SQLite database, and crypto (for password hashing). Nothing to `npm install`.

## Features
- **Logins & roles** — staff accounts (see everything) and customer accounts (see only their own). Customers can self-register; staff can create accounts.
- **New shipment intake** — shipper (FROM) + consignee (TO) with contact & ID, tracking details, and a scrollable barrels/boxes list. Barrels priced flat; boxes/other priced by volume (L×W×H → ft³ or CBM). Live totals.
- **Past shipments & status** — everyone sees their shipment history with a status pill (Draft → Booked → Shipped → Delivered). Staff set the status.
- **Barcode labels** — one Code128 label per physical piece, with consignee & destination. Printable as a 4×6 thermal label or an A4/Letter sheet (Print → Save as PDF).
- **Clients directory, default rates, currency** — for staff.

## Requirements
- **Node.js 22.5+** (built-in SQLite ships from 22.5). Check: `node --version`

## Run locally
```bash
node server.js
```
Open http://localhost:3000. First run prints a seeded staff login (default
`admin` / `admin123` — change it in Settings). Data is stored in `nvocc.db`.

Environment variables: `PORT`, `NVOCC_DB` (database file path),
`ADMIN_USER`, `ADMIN_PASS` (initial staff account).

## Deploy online (so customers can log in from anywhere)
This repo is deploy-ready with a `Dockerfile` and `render.yaml`.

**Render (recommended, easiest):**
1. Push this folder to a GitHub repo.
2. On https://render.com → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Deploy. Render gives you a URL like `https://nvocc-crm.onrender.com`.
4. Your admin password is auto-generated — see it under the service's **Environment** tab. Change it in Settings after first login.

The `starter` plan includes the persistent disk that keeps your database
between deploys. (The `free` plan has no disk, so data resets on redeploy —
fine for trying it out.)

**Any Docker host** works too:
```bash
docker build -t nvocc-crm .
docker run -p 3000:3000 -v $PWD/data:/data nvocc-crm
```

## Roles at a glance
| | Staff | Customer |
|---|---|---|
| See all shipments | ✅ | own only |
| Create shipment | ✅ | ✅ (own) |
| Set status / tracking | ✅ | view only |
| Clients directory, rates | ✅ | — |
| Manage accounts | ✅ | — |
| Print barcode labels | ✅ | ✅ (own) |

## Files
```
server.js    – HTTP server + REST API + auth
db.js        – schema, migrations, admin seed
auth.js      – sessions + scrypt password hashing
pricing.js   – authoritative pricing
public/      – the web app (index.html) + barcode.js (Code128)
Dockerfile, render.yaml – deployment
```
