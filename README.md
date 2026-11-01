# Learnova v3

## Deploy (same as before)
1. **Cloudflare:** Edit code → paste all of `worker/index.js` → Deploy. Keep secret `GEMINI_API_KEY`, variable `ALLOWED_ORIGINS` (your site origin, e.g. `https://YOURNAME.github.io`, no path) and, recommended, secret `APP_ACCESS_CODE`.
2. **GitHub:** upload everything except `worker/` to your repo root. Refresh the site twice once.
3. ⚙ Settings → Worker URL (+ access code) → **Save & test connection**.

## What is new in v3
- **Learnova AI** (home screen card): one tutor for all subjects. Pick which subject's material it may use (or General).
  - Ask doubts (with or without a photo).
  - Say e.g. "give me 3 questions on mean, median and SD": it writes NEW questions (not copied from your notes), double-checks numeric answers with a second independent solve, and hides the answers ("Show answers" button).
  - Solve on paper → 📷 → send: it reads your working, marks each question, shows what went wrong and the correct working, and gives a verdict. Unreadable answers are not marked. Results feed your quiz average and "My study verdict".
- Phone-first card layout; subject screens are full-screen; chat input stays pinned at the bottom.
- Pages are named automatically from their content; Rename any time.
- Notes: one best style. Pick pages from ONE dropdown with "Include all". A few unreadable words are silently dropped; only if many are unreadable you are told and the note carries one warning.
- Camera: flash + "✓ Photo clicked" badge + counter + thumbnails that turn ✓ when read.
- Search pages and notes, backup reminder after 14 days, test-notification button.

## Notifications: how to turn on
Android (Chrome): open the site → ⋮ → Install app / Add to Home screen → open Learnova from the icon → ⚙ Settings → Enable notifications → Allow → Send test notification. If blocked: phone Settings → Apps → Learnova (or Chrome) → Notifications → Allow.
iPhone (iOS 16.4+): Safari → Share → Add to Home Screen → open from the icon → same steps. Reminders (10 AM, 8 PM) only fire while Learnova is open or recently open; a static site cannot wake a closed app.

## Limits (honest)
- AI marking of handwriting and AI-written practice questions can be wrong. Questions are cross-checked by a second solve, which lowers but does not remove errors. Check "You wrote" and important answers yourself.
- Database is now v3 (adds a `chats` store). Existing data is untouched. Backup includes chats; not photos/PDF files or the access code. Import only adds missing items.
- Security notes from v2 still apply (CORS is not authentication; use the access code).
