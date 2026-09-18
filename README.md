# NexChat

NexChat is a responsive private messaging application built with Node.js, Express, Socket.IO, Multer, and JSON files. It has no external database dependency.

## Run locally

1. Open a terminal in the project folder:

   ```bash
   cd nexchat
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000` on the computer. Express listens on `0.0.0.0`, so the same app can be reached from another device on the same Wi-Fi at `http://YOUR-PC-IP:3000`.

The server automatically creates `data/`, `uploads/avatars/`, `uploads/messages/`, and `uploads/covers/` when it starts. If `data/users.json` is empty, it creates Ahmed, Mohamed, Sara, and Youssef as demo accounts. Demo passwords are `password`.

## Use the application

Create an account from **Create account**, or use one of the demo users. After signing in, select **＋** beside Messages, enter another member's NexChat ID, and choose **Message**. The conversation is private and duplicate-safe.

Messages are sent through Socket.IO and persisted in `data/messages.json`; both participants see text and image messages without refreshing. Typing indicators, presence, delivery/read indicators, theme changes, and uploads are also handled through the app's API and Socket.IO events.

## Project files

- `server.js`: Express routes, JSON persistence, validation, uploads, sessions, and Socket.IO.
- `public/index.html`: splash, authentication, application shell, and modal roots.
- `public/style.css`: responsive dark/light visual system and mobile drawer behavior.
- `public/app.js`: browser state, API calls, real-time events, conversations, profile/settings modals, and image messages.
- `data/*.json`: local storage files; they are safe to delete for a clean demo reset.
- `uploads/`: generated image files.

This is intentionally a local JSON demo. Passwords are kept in the user record for simplicity, while authentication logic is isolated in `server.js` so a password hashing layer can be added later.

## Deploy to a server with GitHub storage

By default all data lives in local `data/` and `uploads/`. To make a GitHub repo the durable storage backend (recommended for servers without persistent disk, like free Render/Railway/Fly tiers), set these environment variables before starting:

- `GITHUB_STORAGE_REPO` — the storage repo, e.g. `yourname/nexchat-data`
- `GITHUB_TOKEN` — a fine-grained PAT with `Contents: Read and write` on that repo
- `GITHUB_STORAGE_BRANCH` — optional, default `main`

1. Create a private repo named `nexchat-data` on GitHub (any name works).
2. Create a fine-grained PAT scoped to that repo (Settings → Developer settings → Fine-grained tokens).
3. Run: `GITHUB_STORAGE_REPO=yourname/nexchat-data GITHUB_TOKEN=ghp_... npm start`

On boot the server clones/pulls the repo into `storage/`, serves reads from that local clone, and commits + pushes every change after ~1.5s (users, conversations, messages, and uploads are all synced). If the server crashes before a push, the change is committed and pushed on the next boot. Without the variables, it behaves exactly like the local demo.

Any Node host works: a VPS, Railway, Render, or Fly. Most set `PORT` automatically (the server already reads `process.env.PORT || 3000`).

## Google login with Supabase Auth

"Continue with Google" uses Supabase Auth's Google OAuth (PKCE). It is only shown when the server has the **Supabase** variables configured. Every protected route already goes through `requireUser` server-side; Google users receive the same signed NexChat session cookie (30 days, persists across refreshes), and can edit their NexChat name, username, bio, avatar, and color exactly like password accounts.

### 1. Google Cloud Console

1. Go to https://console.cloud.google.com and create/select a project.
2. **APIs & Services → OAuth consent screen** → configure (External, app name "NexChat", support email). Add the test users who will sign in while the app is in "Testing" mode.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type **Web application**.
4. Under **Authorized redirect URIs** add (use your own site domain):
   - `https://hookhq.vercel.app/auth/callback`
5. Copy the **Client ID** and **Client secret**.

### 2. Supabase

1. Create a project at https://supabase.com (Postgres) → **Authentication → Providers → Google**.
2. Enable it and paste the **Google Client ID** and **Client secret** from step 1.
3. Under **Authentication → URL Configuration → Redirect URLs** add the same callback URL, with a wildcard so Supabase can append OAuth params:
   - `https://hookhq.vercel.app/auth/callback`
   - `https://hookhq.vercel.app/**`
4. Copy **Project URL** (e.g. `https://abcdefgh.supabase.co`) and the **anon public** key from **Settings → API**.

### 3. Set environment variables

Add these to the hosting environment (Vercel → project → Settings → Environment Variables, Production):

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=<anon public key>
```

The Supabase **anon key is public by design**; it is handed to the browser only to build the OAuth redirect. All secret handling stays server-side: the server validates the OAuth code with Supabase, links the verified Google email to the NexChat account, and issues the normal `nexchat_session` cookie. No Google/Supabase tokens are stored in NexChat.

### Behavior notes

- **New Google user** → NexChat account is auto-created; initial **name & avatar come from Google** (username is derived from the email and made unique). Profile is fully editable afterwards.
- **Existing user** → matched by verified email, then by exact email-as-username, then by email local-part. The account is linked (email + Google ID stored) and the user lands in their own conversations.
- **No duplicates** → registration rejects an email that already owns an account; Google sign-in always resolves to one account per email.
- **Logout** clears the NexChat session (and marks you offline instantly), like password accounts.
- Not configured? The Google button stays hidden and nothing changes for email/password login.
