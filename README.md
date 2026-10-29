# Study Vault — mobile-first starter

This is a real starter web app, not just a screenshot. It includes subject folders, Quick Note Box, local IndexedDB storage, file/image/text extraction, in-app camera capture, AI notes through a secure Cloudflare Worker, quick MCQs, a mistakes notebook, PWA shell, and backup export/import.

## Important limits in this starter
- **No API key in the browser.** Gemini calls go through `worker/index.js`; store the key as a Cloudflare Worker secret.
- **₹0-only approach:** use Gemini API's free tier and Cloudflare Workers Free. The worker does not have a paid fallback. If Gemini quota is exhausted, it returns an error instead of switching to paid usage. Check your model's current quota in AI Studio.
- **Storage is local to this browser/device.** Browser/site data can be deleted or evicted; export backups. This starter's JSON backup currently exports records and extracted text but **not original binary file blobs**, so re-upload important files after restoring. Full binary archive backup is not implemented yet.
- **Notifications:** 10 AM and 8 PM reminders are checked while the app is open. Static GitHub Pages alone cannot guarantee scheduled alerts while the app is closed.
- **OCR:** images are processed on-device with Tesseract.js when the OCR library is available. This is English OCR. Diagram/math recognition can be imperfect. Scanned PDF pages are not automatically OCRed in this starter; upload those pages as images. The app warns/excludes unreadable source material instead of pretending it used it.
- **DOCX and web links:** this starter saves links but does not fetch page contents, and DOCX text extraction is not implemented. Save as PDF/TXT or paste text into a TXT file.
- **PIN/biometric lock, full source page citations, robust binary backup, and reliable push notifications while closed are not implemented in this first build.
- AI source text is sent to Google Gemini through your worker. The library itself is not uploaded to a cloud library.

## 1. Publish the frontend on GitHub Pages
1. Download and unzip `Study-Vault-GitHub-Starter.zip`.
2. Create a GitHub account if needed, then click **New repository**. Name it `study-vault`. Public is simplest for free GitHub Pages; do not put secrets in this repository.
3. Upload the files/folders in the unzipped `study-vault` folder to the repository root. Make sure `index.html` is at the root, not nested inside another folder.
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**. Choose branch `main` and folder `/(root)`, then Save.
6. Wait for GitHub Pages to publish. Your URL will look like `https://YOUR-GITHUB-NAME.github.io/study-vault/`.
7. Open that URL in Chrome on Android. Use Chrome menu **⋮ → Add to Home screen** or **Install app**. Use the HTTPS GitHub Pages URL; do not open the HTML as a local file.

## 2. Create a Gemini API key (free tier)
1. Open https://aistudio.google.com/app/apikey and sign in with your Google account.
2. Choose **Create API key** and create/select a project.
3. Copy the key once and keep it private. Do not paste it into `app.js`, HTML, GitHub, screenshots, or chat.
4. Check current free-tier model availability and limits at https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/rate-limits. Free quotas change; this project uses `gemini-3.5-flash-lite`. If that model is not enabled on your account, update `MODEL` in `worker/index.js` to a model that currently shows a free tier in AI Studio.
5. Google states free-tier content may be used to improve products under applicable terms. Do not send sensitive material.

## 3. Deploy the secure AI endpoint on Cloudflare Workers Free
This keeps the API key off GitHub and the browser.

1. Create/sign in at https://dash.cloudflare.com/.
2. Open **Workers & Pages** → **Create** → **Worker** (wording may vary) → deploy a basic Worker.
3. Open the Worker and choose **Edit code**. Replace the code with all contents of `worker/index.js`, then Save/Deploy.
4. In the Worker settings, find **Variables and Secrets** (or Settings → Variables). Add a secret:
   - Name: `GEMINI_API_KEY`
   - Value: your Google AI Studio API key
   Save it as a **Secret**, not a plain variable.
5. Add a plain-text variable named `ALLOWED_ORIGIN`. Set it to the exact GitHub Pages origin, for example `https://YOUR-GITHUB-NAME.github.io` (no trailing slash). If you use a custom domain, use that exact origin. This limits browser access to your site; it is not a replacement for authentication.
6. In `worker/index.js`, the model constant is `gemini-3.5-flash-lite`. Keep the free-tier model you verified in AI Studio.
7. Copy the Worker URL, usually `https://study-vault-ai.YOUR-SUBDOMAIN.workers.dev`.
8. In Study Vault, tap ⚙ → paste the Worker URL into **AI Worker URL** → **Save settings**.
9. Open a subject, add readable text/PDF/image material, select source(s), and tap **Create Notes**. For MCQs, open **MCQ practice** → **Generate 5 MCQs**.

### Cost safety
- Do not enable paid billing in Google AI Studio/Cloud for this project. The app and worker contain no paid fallback, but your Google account/project billing configuration is controlled by Google, not this code.
- Keep an eye on usage in AI Studio. Free-tier limits may change and requests may fail after quota is reached.
- Cloudflare Workers Free has its own usage limits; check https://developers.cloudflare.com/workers/platform/limits/.

## 4. Notifications at 10 AM and 8 PM
1. Open the published site in Chrome Android and install it to the home screen.
2. Open Study Vault → ⚙ → **Enable notifications** → allow notifications in Chrome/Android.
3. This starter checks for reminders at **10:00 AM** and **8:00 PM** while Study Vault is open. Android battery restrictions and browser behaviour may affect delivery.
4. If you need alerts while the app is fully closed, that requires web push subscriptions and a server-side push scheduler; this starter does not promise closed-app alerts.

## 5. Testing checklist
- Add two subjects and several tasks.
- Upload a TXT and a photo of a clear English paragraph. Check extraction status.
- Select the material and create short revision notes.
- Create an editable copy; confirm the AI original remains.
- Generate MCQs and check that wrong answers appear in Mistakes Notebook.
- Export a backup before clearing browser data.
- Test on the actual Android phone; desktop behaviour is not proof of Android storage/camera/notification behaviour.

## Troubleshooting
- **AI Worker URL missing:** enter the deployed `workers.dev` URL in Settings.
- **CORS error:** make `ALLOWED_ORIGIN` match the origin of your GitHub Pages site exactly, including `https://`, and redeploy.
- **Gemini 429/quota:** wait for the free quota reset; the app has no paid fallback.
- **OCR not available:** internet is needed to load Tesseract.js the first time; retry while online.
- **No notifications:** grant Chrome notification permission, keep the app open around the reminder time, and check Android notification/battery settings.
