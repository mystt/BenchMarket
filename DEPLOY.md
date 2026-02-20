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

## 4. Deploy backend (Render)

The backend must run somewhere so the frontend can call it. **Render** is used here.

### Option A: Blueprint (recommended)

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New** → **Blueprint** → connect your GitHub repo (same repo as frontend).
3. Render will detect `render.yaml` and create the `benchmarket-api` service.
4. **Environment** (Dashboard → your service → Environment): add:
   - `OPENAI_API_KEY` = your OpenAI API key (required for AI)
   - Optional: `DATABASE_URL`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_TOPIC_ID`, etc.
5. Deploy. Render will give you a URL like `https://benchmarket-api.onrender.com`.

### Option B: Manual Web Service

1. **New** → **Web Service** → connect your repo.
2. **Settings:**
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
3. **Environment:** add `OPENAI_API_KEY` and any other vars (see Option A).

### Wire up the frontend

- In **Vercel** → your project → **Settings** → **Environment Variables** → add:
  - `VITE_API_URL` = `https://benchmarket-api.onrender.com`  
    (or your Render URL; no trailing slash, no `/api`).
- **Redeploy** the frontend so the new value is baked into the build.

**CORS:** The backend uses `cors()` with no origin restriction, so the Vercel domain can call it.

---

## 5. Optional: backend on your domain (e.g. api.yourdomain.com)

- **Render:** In the service, open **Settings** → **Custom Domains** and add `api.yourdomain.com`. Point a CNAME at the host Render shows.
- Then set `VITE_API_URL=https://api.yourdomain.com` in Vercel and redeploy.

---

## Checklist

- [ ] Repo on GitHub
- [ ] Vercel project: Root = `frontend`, env `VITE_API_URL` = backend URL
- [ ] Custom domain added in Vercel and DNS set at registrar
- [ ] Backend on Render: Root = `backend`, `OPENAI_API_KEY` set in Environment
- [ ] After backend is live, `VITE_API_URL` in Vercel updated and frontend redeployed

Once this is done, the site is on Vercel at your domain, and the backend is on Render feeding the API.
