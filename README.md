# Learnova — final version

## Update steps
1. **Cloudflare (needed for AI, Sync and link reading):** Workers & Pages → your Worker → *Edit code* → delete everything → paste ALL of `worker/index.js` → **Deploy**.
2. **GitHub:** upload the changed site files (see the list in the reply): `index.html`, `app.js`, `styles.css`, `README.md`. Replacing files with the same name is enough. Then refresh the site twice.
3. **Settings → Connection:** Worker URL + access code → *Save & test connection*.

## Turn on Sync between laptop and phone (one-time, free)
1. Cloudflare dashboard → *Storage & databases* → **KV** → *Create a namespace* (e.g. `learnova-sync`).
2. Your Worker → *Settings* → *Bindings* → *Add* → **KV namespace** → variable name **`LEARNOVA_KV`** → pick that namespace → Deploy.
3. Make sure the Worker has the secret **`APP_ACCESS_CODE`** (Sync refuses to run without it).
4. On every device: Settings → Connection → the **same Worker URL and access code** → Save & test. The top bar shows "☁ Synced".

How it works: all data is gzip-compressed and **encrypted in your browser (AES-GCM, key derived from your access code)** before it is uploaded, so Cloudflare only ever stores unreadable bytes. The Worker never decrypts or merges. Newest edit of each item wins, deletions are propagated, and the AI chat is merged message by message. Original photo/PDF files are NOT synced (only the text read from them). Free KV has a daily write limit; Learnova batches uploads (about 12 seconds after you stop editing) to stay far below it.
If you ever change the access code, use *Settings → Sync → Reset cloud copy* (it re-uploads this device's data under the new code).

## Links
Add → **Links** saves the address as a normal clickable link (opens the original site in a new tab). Nothing is copied. When you tick a link in *Create notes*, the Worker reads that page at that moment, the text is used only for that note, and it is not stored. Pages that need a login, are paywalled, are PDFs/files, or build their content with JavaScript cannot be read: Learnova says so and you can use Select Files or Text instead.

## Add chooser
Camera · Gallery / Photos · Links · Text · Select Files. Select Files never forces the camera and accepts PDF, Word (.docx), text/Markdown/CSV and PNG/JPG/WebP images. If the in-app camera is blocked, a "phone camera app" fallback appears.

## Layout
Home, Subjects, AI and Settings are separate pages (bottom bar on phones, side rail on laptops). Each page fits the screen; only long lists scroll inside their own box. Subject screens keep their header and tabs fixed.

## Privacy & security
Nothing is public. The Worker only answers your site (`ALLOWED_ORIGINS`), requires your access code, rate-limits requests, and refuses to fetch private/internal web addresses. CORS is not authentication; the access code is.

## Known limits
- Link reading runs inside a free-plan Worker (10 ms CPU limit); very large pages may fail and are capped at about 1 MB of HTML.
- Sync uses clocks of your devices to decide "newest edit"; keep device time automatic.
- The AI can be wrong. Check important answers and marked work yourself.
