# Deploy to Vercel + custom domain

The app has two parts:

- **Frontend** (React + Vite) → deploy to **Vercel** (great for static/SPA and your custom domain).
- **Backend** (Node + Express) → deploy to **Railway** or **Render** (needs a persistent server for API, streaming, and in-memory state).

---

## 1. Push your code to GitHub

If you haven’t already:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## 2. Deploy frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (e.g. with GitHub).
2. **Add New Project** → **Import** your GitHub repo.
3. **Configure:**
   - **Root Directory:** click **Edit** and set to `frontend`.
   - **Framework Preset:** Vite (should be auto-detected).
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. **Environment variables:** add:
   - `VITE_API_URL` = your backend URL **without** `/api`  
     Example: `https://your-app-name.railway.app` (you’ll set this after deploying the backend in step 3).
5. Click **Deploy**. Your site will be at `https://your-project.vercel.app`.

---

## 3. Connect your domain (Vercel)

1. In the Vercel project → **Settings** → **Domains**.
2. Add your domain (e.g. `yourdomain.com`).
3. Follow Vercel’s instructions to add the DNS records at your registrar (A/CNAME). Vercel will show exactly what to add.
4. After DNS propagates, Vercel will issue SSL and your site will be live at your domain.

You can add both `yourdomain.com` and `www.yourdomain.com`; Vercel will suggest redirecting one to the other.

---

## 4. Deploy backend (Railway or Render)

The backend must run somewhere so the frontend can call it. Example: **Railway**.

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → select the same repo.
3. **Settings** for the new service:
   - **Root Directory:** `backend`
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run start` (or `node dist/index.js`)
   - **Watch Paths:** `backend/**` (so only backend changes trigger redeploys)
4. **Variables** (Railway **Variables** tab): add the same env vars you use locally, especially:
   - `OPENAI_API_KEY` (required for AI)
   - `PORT` – leave unset so Railway sets it (often 3000 or from `PORT`).
   - Optional: `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_TOPIC_ID`, etc.
5. Deploy. Railway will give you a URL like `https://your-service.railway.app`.
6. **CORS:** The backend already uses `cors()` with no origin restriction, so the Vercel domain can call it. If you lock CORS later, allow your Vercel/domain origin.

**Set the frontend env:**

- In Vercel, set **Environment Variable**  
  `VITE_API_URL` = `https://your-service.railway.app`  
  (no trailing slash, no `/api`).
- Redeploy the frontend so the new value is baked into the build.

---

## 5. Optional: backend on your domain (e.g. api.yourdomain.com)

- **Railway:** In the service, open **Settings** → **Networking** → **Custom Domain** and add `api.yourdomain.com`. Point a CNAME at the host Railway shows.
- Then set `VITE_API_URL=https://api.yourdomain.com` in Vercel and redeploy.

---

## Checklist

- [ ] Repo on GitHub
- [ ] Vercel project: Root = `frontend`, env `VITE_API_URL` = backend URL
- [ ] Custom domain added in Vercel and DNS set at registrar
- [ ] Backend on Railway (or Render): Root = `backend`, `OPENAI_API_KEY` and any other env set
- [ ] After backend is live, `VITE_API_URL` in Vercel updated and frontend redeployed

Once this is done, the site is on Vercel at your domain, and the backend is on Railway (or your chosen host) feeding the API.
