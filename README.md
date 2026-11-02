# Learnova v3.2

## MUST DO after every update: redeploy the Worker
The website and the Worker are separate. If the AI says "Unknown task" or the home screen shows "Update your Cloudflare Worker", the Worker still has old code. Cloudflare → Workers & Pages → your worker → Edit code → select all, delete → paste ALL of `worker/index.js` → press **Deploy**. Then ⚙ Settings → Save & test connection (it now fails loudly if the Worker is outdated).

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

## Notifications not working? (Settings now shows your exact state)
- **“Not allowed yet” / no popup:** Chrome is collapsing the request. Tap the 🔔 in the address bar → Allow, or Chrome ⋮ → Settings → Site settings → Notifications → “Expand all requests”, reload, tap Enable.
- **“Blocked”:** tap ⓘ/🔒 left of the address → Permissions → Notifications → Allow (or Site settings → Notifications → Blocked → this site → Allow).
- **“Allowed” but nothing shows:** phone Settings → Apps → Chrome → Notifications ON; Do Not Disturb OFF.
- **Most reliable:** Settings → “Add daily reminders to my phone calendar” downloads a .ics; open it and tap Add. Works even when Learnova is closed.

## Notifications: how to turn on
Android (Chrome): open the site → ⋮ → Install app / Add to Home screen → open Learnova from the icon → ⚙ Settings → Enable notifications → Allow → Send test notification. If blocked: phone Settings → Apps → Learnova (or Chrome) → Notifications → Allow.
iPhone (iOS 16.4+): Safari → Share → Add to Home Screen → open from the icon → same steps. Reminders (10 AM, 8 PM) only fire while Learnova is open or recently open; a static site cannot wake a closed app.

## Limits (honest)
- AI marking of handwriting and AI-written practice questions can be wrong. Questions are cross-checked by a second solve, which lowers but does not remove errors. Check "You wrote" and important answers yourself.
- Database is now v3 (adds a `chats` store). Existing data is untouched. Backup includes chats; not photos/PDF files or the access code. Import only adds missing items.
- Security notes from v2 still apply (CORS is not authentication; use the access code).


## v3.2 changes and deployment notes
- Add files now opens a chooser for Camera, Gallery / Photos, Links, Text and Select Files. Select Files opens the browser/Android system document picker; supported formats remain PDF, images, DOCX, TXT, Markdown and CSV where the browser exposes them.
- Saved website URLs remain clickable and are preserved as URLs. When selected for note creation, Learnova asks the Cloudflare Worker to read ordinary public HTML/plain-text pages. Retrieved page text is kept in memory for that session and is not saved as a duplicate material. JavaScript-only, sign-in-required, blocked, PDF and other non-HTML links may not be readable.
- The Worker must be redeployed from the updated `worker/index.js` (version 5) before the website-link reader works. Existing `GEMINI_API_KEY`, `APP_ACCESS_CODE` (if used), and `ALLOWED_ORIGINS` settings remain in place.
- Subject workspace layout now keeps the tab navigation in place and scrolls the active section within the available screen height; mobile and desktop use responsive sizing.

## Cross-device account and sync status
This release does **not** add cross-device login or cloud synchronization. The current data store is browser-local IndexedDB; Firebase login by itself would not sync these records. A secure implementation requires a Firebase project configuration, Email/Password Authentication enabled, Firestore database and restrictive per-user security rules, plus a migration/sync design for existing local records and binary attachments. Do not treat the current app as synchronized between devices. Export/import backup remains the supported way to move data until that backend is configured and tested.
