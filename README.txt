GMAX Hub — Instagram-style study site
=====================================

Auth (36 hours)
---------------
Get Key → server generates 12-digit code → signed /api/reveal URL
→ AroLinks short link (with ads) → user completes ads → sees code
→ Verify on site → unlock 36 hours.

Code is NEVER returned from Get Key API. Only the short URL is returned.
If AroLinks fails, user sees an error (no free key).

Admin
-----
• PIN = ADMIN_PIN env
• 2 wrong PINs → 2-hour lock
• Site name (default GMAX Hub) editable after login
• Add Post/Story via HTTPS media links
• Custom content + brand name in localStorage on admin device

Vercel env (required)
---------------------
AROLINKS_TOKEN=
KEY_SECRET=
ADMIN_PIN=
SITE_URL=https://your-app.vercel.app
SITE_NAME=GMAX Hub   (optional)

Deploy: upload folder → set env → Deploy.
