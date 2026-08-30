Lumina — Instagram-style study site (updated)
==============================================

Auth (36 hours)
---------------
Get Key → server generates 12-digit code → opens:
  https://auth.pwasmultiverse.workers.dev/generate?code=XXXXXXXXXXXX
via AroLinks short link (token only in Vercel env).
User copies code → Verify on site → unlock 36 hours.

Admin
-----
• PIN = ADMIN_PIN env (server only)
• Add Post / Story using HTTPS media links only (no file upload)
• Long-press / right-click save blocked on images & videos
• Custom posts/stories save in browser localStorage on the admin device
  (all visitors still see default seed content; for shared live feed
   for every student you need a database later)

Vercel env
----------
AROLINKS_TOKEN=
KEY_SECRET=
ADMIN_PIN=
SITE_URL=https://your-app.vercel.app

Deploy: upload folder to Vercel → set env → Deploy.
