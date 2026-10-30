# Learnova — AI study companion (v2: security + accuracy update)

## Deploy
**1. Backend (Cloudflare Worker):** Edit code → replace everything with `worker/index.js` → Deploy. Then set:
| Name | Type | Required | Value |
|---|---|---|---|
| `GEMINI_API_KEY` | Secret | yes | your Gemini key (already set; stays only in the Worker) |
| `ALLOWED_ORIGINS` | Variable | **yes** | exact site origin(s), comma-separated, e.g. `https://YOURNAME.github.io` (no path). If you already set the old `ALLOWED_ORIGIN` to your site, it still works. `*` is ignored. |
| `APP_ACCESS_CODE` | Secret | recommended | a private code (e.g. 12+ random characters) |
| `RATE_LIMIT_PER_MIN` | Variable | no | default 30 |

Until `ALLOWED_ORIGINS` is set the Worker refuses every request (on purpose; no domain is hard-coded).

**2. Frontend (GitHub):** upload everything except `worker/` to your repo root. Open the site → ⚙ Settings → Worker URL + the same access code → **Save & test connection**.

## Security — what each layer does and does not do
- **CORS / ALLOWED_ORIGINS is not authentication.** It only tells *browsers* which sites may read replies. Anyone can call the Worker with curl and fake an Origin header. It prevents other websites from using your Worker through a visitor's browser.
- **Access code (`APP_ACCESS_CODE`)** is the real protection for a personal app: without it the Worker returns 401 and never contacts Gemini. Trade-off: one extra setup step and you must enter the code once per browser; if it leaks, change the secret and re-enter it. Optional, but strongly recommended. It is stored only in your browser's IndexedDB and is excluded from backups. A person with access to your unlocked browser could read it.
- **Rate limiting:** failed and successful requests both count. Without a binding it is per Worker instance only (best effort, not a hard cap). For a shared Cloudflare limiter, add the `[[ratelimits]]` binding shown in `wrangler.toml` (free; counted per Cloudflare location; Cloudflare says it is not meant for strict abuse defence).
- Also set a **spending/quota cap on your Gemini key** in Google AI Studio / Cloud; that is the only hard limit.

## Notes, OCR, quiz, cards — behaviour
- Notes: simple English, source-only facts, colour boxes; `[!extra]` boxes (grey, dashed) are clearly labelled explanations that are *not* from your material; unclear/contradictory source text is flagged in "Check your source" boxes. No guarantee of matching any syllabus.
- OCR: uncertain readings are marked `[?]` / `[unclear]`, never treated as verified; materials show "NOT verified" until you tap **Review text**. Creating notes warns you when uncertain or backup-OCR text is included. Delete each `[?]` after confirming it.
- Scanned PDFs: first **40** scanned pages are read (3 pages per Gemini request); the rest are reported as NOT READ and noted in the text. Split the PDF to read more. Pages are processed 3 at a time to keep memory low.
- Typed-PDF tables are rebuilt as `cell | cell` rows when columns are detected; multi-column prose is kept as normal text.
- MCQs: 8 candidates are generated, filtered (evidence quote must exist in your material, exactly 4 distinct options, no "all of the above", no duplicates, explanation required), independently answer-checked by a second Gemini call, then up to 5 are shown. This doubles token use for quizzes. It reduces wrong questions but cannot guarantee zero.
- Flashcards: 16 candidates → up to 12 kept after evidence/duplicate/triviality checks.

## Data safety
- Same IndexedDB (`study-vault-db`, v2); existing data is untouched. New fields are optional, so old notes, materials and mistakes keep working.
- Backup export: text, notes, cards, mistakes, history. **Not included:** original photo/PDF files and the access code.
- Backup import only **adds** items whose id does not already exist; it never overwrites or deletes.

## Known limits
Notifications work only while the app is open. Free Gemini quotas apply. OCR accuracy depends on the photo; always review important pages.
