Lumina — shared feed for ALL users
==================================

Problem: Admin post sirf usi phone par dikhta tha (localStorage).
Fix: Admin "Publish to all users" → GitHub content.json → har user /api/content se load.

Setup
-----
1. api/ folder on GitHub (api/content.js NEW + other apis)
2. Vercel env: AROLINKS_TOKEN, KEY_SECRET, ADMIN_PIN, SITE_URL,
   GITHUB_TOKEN, GITHUB_REPO=owner/INSTGMAX
3. Redeploy
4. Admin login → add post/story/about → Publish to all users
5. Doosra phone: site refresh → naya content

GitHub token:
  github.com → Settings → Developer settings → Personal access tokens
  Permissions: Contents Read and Write on this repo
