# Deploying CowFlo (free hosting)

This guide puts CowFlo online for free using three services:

| Part | Folder | Hosted on | Free account |
|---|---|---|---|
| Database (PostgreSQL) | — | **Neon** | https://neon.com |
| Backend API (Node.js) | `backend/` | **Render** | https://render.com |
| Login / dashboard website | `frontend/` | **InfinityFree** | https://infinityfree.com |
| POS website | `cowflow_pos/` | **InfinityFree** | https://infinityfree.com |

```
 Browser ──► InfinityFree (login site + POS site, static files)
    │
    └──── API calls ──► Render (backend, Node.js) ──► Neon (PostgreSQL)
```

Follow the parts **in order**. Each part gives you a value (a URL or password) that a later part needs.
Keep a notepad open and fill in this table as you go:

| Value | Where you get it | Your value |
|---|---|---|
| Neon connection string | Part 2 | |
| JWT secret | Part 3, step 3.1 | |
| Production signup pass | Part 3, step 3.1 | |
| Backend URL | Part 4 | `https://__________.onrender.com` |
| Login site URL | Part 5 | `https://__________` |
| POS site URL | Part 5 | `https://__________` |

---

## Part 0 – What you need on your PC

These are already installed on this PC:

- **Node.js** (check: open PowerShell, run `node -v`, you should see `v24.x` or similar)
- **Git** (check: `git --version`)
- **GitHub account** with the repo `https://github.com/RMPintoy/CowFlo`

Optional but recommended:

- **FileZilla Client** (for uploading many files to InfinityFree): https://filezilla-project.org — install the *Client*, not the Server.

---

## Part 1 – Push the latest code to GitHub

Render downloads the backend code from GitHub, so GitHub must have the latest version.

1. Open PowerShell in the project folder:
   ```powershell
   cd C:\Users\Desktop24\Documents\GitHub\CowFlo
   ```
2. See what changed:
   ```powershell
   git status
   ```
   You should see the new `.htaccess` files (`frontend/public/.htaccess`, `cowflow_pos/public/.htaccess`) and this `DEPLOYMENT.md`.
3. **Make sure no secrets are being committed.** `backend/.env` must **not** appear in the list (it is in `.gitignore`, so it shouldn't).
4. Commit and push:
   ```powershell
   git add frontend/public/.htaccess cowflow_pos/public/.htaccess DEPLOYMENT.md
   git commit -m "Add Apache rewrite rules and deployment guide"
   git push origin main
   ```
5. Open https://github.com/RMPintoy/CowFlo in your browser and confirm the files are there.

> The repo can stay **private**. Render can read private repos once you connect your GitHub account.

---

## Part 2 – Create the database on Neon

1. Go to https://neon.com and click **Sign up**. Choose **Continue with GitHub** (easiest) or email. No credit card is needed.
2. After signing in you'll be asked to create a project:
   - **Project name:** `CowFlo`
   - **Postgres version:** leave the default (16 or 17 both work)
   - **Cloud provider:** AWS
   - **Region:** pick the one closest to your shops. For the Philippines / Southeast Asia choose **Asia Pacific (Singapore)**.
   - Click **Create project**.
3. On the project dashboard click the **Connect** button (top right).
4. In the connection popup:
   - **Branch:** `production` (or `main`, the default)
   - **Database:** `neondb` (default — that's fine, you don't need to rename it)
   - **Role:** the default owner role
   - **Connection pooling:** turn it **ON** (the host will contain `-pooler`)
   - Select the **Connection string** view.
5. Click **Show password**, then **Copy**. It looks like:
   ```
   postgresql://neondb_owner:AbC123xyz@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   Paste it into your notepad as **Neon connection string**.
   - It must end with `?sslmode=require` (sometimes also `&channel_binding=require` — that's fine, keep it).
   - **Treat this like a password.** Anyone with it can read and change your data.

You do **not** need to create any tables. The backend creates all tables automatically the first time it starts.

---

## Part 3 – Prepare production secrets

### 3.1 Generate a JWT secret and a new signup pass

The JWT secret signs every login token. If someone knows it, they can log in as anyone, so it must be long and random.

1. In PowerShell run:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
2. Copy the long line it prints → notepad as **JWT secret**.
3. Choose a **production signup pass**. This is what the owner types on the `/signup` page. Use something only you know, e.g. `CowFlo-Owner-2026!` — **not** `admin`. Write it in the notepad.

### 3.2 (Optional) Gmail for "Forgot password" emails

Skip this if you don't need password-reset emails yet; everything else works without it.

1. Use the Gmail account that should send the emails. Turn on **2-Step Verification** (Google Account → Security).
2. Go to https://myaccount.google.com/apppasswords, create an app password named `CowFlo`.
3. Google shows a 16-character password. Write it down — you'll use it as `SMTP_PASS` in Part 4.

---

## Part 4 – Deploy the backend on Render

### 4.1 Create the account

1. Go to https://render.com → **Get Started** → **GitHub**. Approve the permissions.
2. If asked to install the Render GitHub app, choose **Only select repositories** → select **CowFlo** → **Install**.

### 4.2 Create the web service

1. In the Render dashboard click **+ New** → **Web Service**.
2. Under **Git Provider** pick **RMPintoy / CowFlo** and click **Connect**.
3. Fill in the form **exactly**:

   | Field | Value |
   |---|---|
   | **Name** | `cowflo-api` (this becomes `https://cowflo-api.onrender.com`; if taken, Render adds random letters) |
   | **Language** | `Node` |
   | **Branch** | `main` |
   | **Region** | **Singapore** (same region as Neon — keeps it fast) |
   | **Root Directory** | `backend` ← important, the backend is in a subfolder |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | **Free** |

4. Scroll to **Environment Variables** and click **+ Add Environment Variable** for each row:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your **Neon connection string** |
   | `JWT_SECRET` | your **JWT secret** |
   | `cow_flow_sign_up_pass` | your **production signup pass** |
   | `CORS_ORIGIN` | `http://localhost:3000` for now — you'll replace it in Part 7 |
   | `NODE_VERSION` | `20` |

   Only if you did step 3.2 (Gmail), also add:

   | Key | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | `yourname@gmail.com` |
   | `SMTP_PASS` | the 16-character app password (no spaces) |
   | `MAIL_FROM` | `CowFlo <yourname@gmail.com>` |

   Do **not** add `PORT` — Render sets it automatically and the backend already reads it.

5. Open **Advanced** and make sure **Health Check Path** is **empty**.
   (`/api/health` queries the database; Render calling it every few seconds would keep Neon awake and use up its free compute hours.)
6. Click **Deploy Web Service**.

### 4.3 Watch the first deploy

1. Render opens the **Logs** tab. Wait 2–5 minutes. Success looks like:
   ```
   ==> Running 'npm start'
   > cowflo-backend@1.0.0 start
   > node src/server.js
   CowFlo API listening on port 10000
   ==> Your service is live 🎉
   ```
2. If you see `Failed to start server` instead, jump to **Troubleshooting** at the bottom.
3. Copy your service URL from the top of the page (e.g. `https://cowflo-api.onrender.com`) → notepad as **Backend URL**.

### 4.4 Test the backend

Open in your browser:

```
https://cowflo-api.onrender.com/api/health
```

You should see something like:

```json
{"status":"ok","database":"CowFlo","time":"2026-10-23T12:34:56.789Z"}
```

That means Render is running **and** it reached Neon. In Neon's dashboard → **Tables** you'll now see `users`, `businesses`, `branches`, `inventory_items`, `pos_sales`, etc.

---

## Part 5 – Create the two websites on InfinityFree

You'll make **two hosting accounts**: one for the login site, one for the POS. (The free plan allows several accounts; keeping them separate keeps each site's files in its own `htdocs` folder.)

### 5.1 Sign up

1. Go to https://infinityfree.com → **Register**. Confirm your email.
2. Log in to the **Client Area**.

### 5.2 Create the login site

1. Click **Create Account** (hosting account).
2. **Domain type:** *Subdomain*. Type a name, e.g. `cowflo`, and pick an extension such as `.infinityfreeapp.com` → `cowflo.infinityfreeapp.com`.
   (If you own a real domain, you can use it here instead.)
3. Leave the plan as **Free**, finish the wizard, and wait until the account shows **Active** (can take a few minutes).

### 5.3 Create the POS site

Repeat 5.2 with a different name, e.g. `cowflopos` → `cowflopos.infinityfreeapp.com`.

### 5.4 Turn on HTTPS for both

1. In the Client Area open each hosting account → **SSL Certificates** (or **Free SSL**).
2. If the subdomain doesn't already show an active certificate, request one for the domain and follow the steps until it's **Issued / Active**. Then **install** it on the hosting account if asked.
3. Wait until `https://cowflo.infinityfreeapp.com` opens without a security warning. Do the same for the POS site.

Write both `https://…` addresses in your notepad as **Login site URL** and **POS site URL**.

### 5.5 Find the FTP details (for uploading later)

In each hosting account open **FTP Details**. Note:

- **FTP Hostname:** usually `ftpupload.net`
- **FTP Username:** like `if0_12345678`
- **FTP Password:** click *Show* (this is the hosting account password)
- **Port:** `21`

---

## Part 6 – Build the websites on your PC

The websites need to know your backend URL **at build time**. It's baked into the files.

1. Open PowerShell in the project folder:
   ```powershell
   cd C:\Users\Desktop24\Documents\GitHub\CowFlo
   ```
2. Set the backend URL (replace with **your** Backend URL — keep the `/api` at the end, no trailing slash):
   ```powershell
   $env:VITE_API_BASE_URL = "https://cowflo-api.onrender.com/api"
   ```
3. Build the login site:
   ```powershell
   cd frontend
   npm install
   npm run build
   cd ..
   ```
   Wait for `✓ built in …`. The output is in `frontend\dist\`.
4. Build the POS:
   ```powershell
   cd cowflow_pos
   npm install
   npm run build
   cd ..
   ```
   The output is in `cowflow_pos\dist\`.
5. Clear the variable so it doesn't affect local development:
   ```powershell
   Remove-Item Env:VITE_API_BASE_URL
   ```
6. Check the output. Each `dist` folder should contain:

   | `frontend\dist\` | `cowflow_pos\dist\` |
   |---|---|
   | `index.html` | `index.html` |
   | `assets\` (folder) | `assets\` (folder) |
   | `cowflo-logo.png` | `.htaccess` |
   | `.htaccess` | |

   `.htaccess` is a hidden file. In File Explorer turn on **View → Show → Hidden items** to see it.

> **Did it pick up the URL?** Open `frontend\dist\assets\index-xxxx.js` in Notepad, press Ctrl+F, and search for `onrender.com`. If it's found, the build is correct. If not, redo step 2 in the **same** PowerShell window before building.

---

## Part 7 – Allow the websites to talk to the backend (CORS)

The backend only accepts requests from websites you list.

1. Render dashboard → **cowflo-api** → **Environment**.
2. Edit `CORS_ORIGIN` and set it to both site URLs, **comma-separated, no spaces, no trailing slash**:
   ```
   https://cowflo.infinityfreeapp.com,https://cowflopos.infinityfreeapp.com
   ```
3. Click **Save, rebuild, and deploy** (or **Save Changes** and then **Manual Deploy → Deploy latest commit**). Wait for "Your service is live".

---

## Part 8 – Upload the websites to InfinityFree

Upload the **contents** of each `dist` folder (not the `dist` folder itself) into that site's `htdocs` folder.

### Option A – FileZilla (recommended)

1. Open FileZilla. At the top fill in **Host** `ftpupload.net`, **Username** / **Password** from the **login site's** FTP details, **Port** `21`. Click **Quickconnect**.
   - If asked about an unknown certificate, tick **Always trust** and click **OK**.
2. In FileZilla: **Server → Force showing hidden files** (so `.htaccess` uploads too).
3. Right panel (server): double-click **`htdocs`**.
4. Delete InfinityFree's default files in `htdocs` (e.g. `index2.html`) if there are any.
5. Left panel (your PC): go to `C:\Users\Desktop24\Documents\GitHub\CowFlo\frontend\dist`.
6. Select **everything inside** `dist` (Ctrl+A in the left file list), right-click → **Upload**.
7. Wait until **Queued files** is 0 and **Failed transfers** is 0.
8. Disconnect, then connect with the **POS site's** FTP details and repeat steps 3–7 using `cowflow_pos\dist`.

When done, the server should look like:

```
htdocs/
  .htaccess
  index.html
  assets/
    index-xxxx.js
    index-xxxx.css
  cowflo-logo.png      (login site only)
```

### Option B – Online File Manager

1. Client Area → hosting account → **File Manager** → open `htdocs`.
2. Upload `index.html`, `.htaccess`, and (login site) `cowflo-logo.png`.
3. Create a folder `assets`, open it, and upload everything from `dist\assets\`.
4. Repeat for the POS site.

---

## Part 9 – First-time setup and testing

> The first request after the backend has been idle can take **30–60 seconds** (Render's free tier sleeps after ~15 minutes). If a page seems stuck, wait a minute and try again.

### 9.1 Wake the backend

Open `https://cowflo-api.onrender.com/api/health` and wait until you see `"status":"ok"`.

### 9.2 Create the owner account

The backend automatically creates a business named **CowFlo** with business code **`COW_001`** the first time it starts. Because that name already exists, sign up like this:

1. Open `https://cowflo.infinityfreeapp.com/signup`.
2. Fill in first name, last name, **username**, email, **password** (at least 8 characters), confirm password.
3. **Business Name:** `CowFlo`
4. **Business Code** (the field that says *only to join an existing business*): `COW_001`
5. **Signup pass:** your **production signup pass** (from Part 3).
6. Submit.

Signing up with a business code makes you a **member**, so promote yourself to **owner**:

1. Neon dashboard → your project → **SQL Editor**.
2. Run (replace `yourusername` with the username you just chose):
   ```sql
   UPDATE users
   SET role = 'owner', permissions = NULL
   WHERE username = 'yourusername';
   ```
3. It should say `UPDATE 1`. Check with:
   ```sql
   SELECT id, username, role, business_id FROM users;
   ```

*(Alternative: sign up with a different business name such as `CowFlo Farms` and no business code — you'll be owner immediately, and the empty "CowFlo" business just sits unused.)*

### 9.3 Test everything

- [ ] `https://cowflo.infinityfreeapp.com/login` → log in with your username and password.
- [ ] Refresh the page while on an inner page — it must **not** show a 404 (that's what `.htaccess` fixes).
- [ ] Create your **3 branches**. Give each one its own **Code for POS** (e.g. `MAIN01`, `BR2-01`, `BR3-01`). Each branch's cashier uses this code to sign in to the POS.
- [ ] Add a few inventory items and assign stock to each branch.
- [ ] Note your **Business Code**: dashboard → profile/settings → *Business* section (it's `COW_001` if you joined CowFlo).
- [ ] Open `https://cowflopos.infinityfreeapp.com`. The POS does **not** use username/password. Sign in with the **Business Code** + that branch's **POS code**. Make a test sale, then a test refund.
- [ ] Back on the dashboard, check that stock went down and the sale shows up.
- [ ] (If you set up Gmail) try **Forgot password** and confirm the email arrives.

**Congratulations — CowFlo is live.** 🎉

---

## Part 10 – Updating the app later

### Backend changes (anything in `backend/`)

```powershell
git add backend
git commit -m "Describe your change"
git push origin main
```

Render redeploys automatically (Auto-Deploy is on by default). Watch the **Logs** tab until it's live.

### Website changes (`frontend/` or `cowflow_pos/`)

1. Rebuild with the backend URL set (Part 6, steps 1–5).
2. Upload the new `dist` contents again (Part 8). Overwrite when asked.
3. In FileZilla you may delete old `assets/index-xxxx.js` / `.css` files that are no longer referenced by `index.html` to save space.
4. In the browser press **Ctrl+F5** to bypass the cache.

Also commit and push the source changes to GitHub so nothing is lost.

---

## Part 11 – Backups

Neon's free plan only keeps **6 hours** of history. Make your own backup regularly (e.g. weekly). PostgreSQL 16 is installed on this PC, so you can use `pg_dump`:

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" --dbname="PASTE_NEON_CONNECTION_STRING_HERE" --format=custom --file="C:\Users\Desktop24\Documents\CowFlo-backup-$stamp.dump"
```

If Neon is on Postgres 17, `pg_dump` 16 will refuse with a version error. Install PostgreSQL 17 tools (`winget install PostgreSQL.PostgreSQL.17`) and use `...\PostgreSQL\17\bin\pg_dump.exe` instead.

To restore a backup into a (new, empty) database:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" --dbname="TARGET_CONNECTION_STRING" --no-owner "C:\Users\Desktop24\Documents\CowFlo-backup-2026-10-23.dump"
```

Store backups somewhere other than this PC too (USB drive, Google Drive).

---

## Free tier limits to keep in mind

| Service | Limit | What it means for CowFlo |
|---|---|---|
| **Render Free** | Sleeps after ~15 min idle; 750 instance hours/month | First request after idle takes 30–60 s. One service running all month fits in 750 h. |
| **Neon Free** | 1 GB storage, 100 CU-hours/month, 5 GB egress/month, sleeps after 5 min idle | Text data for 3 shops is tiny. **Images are currently stored in the database** — keep them small; moving them to InfinityFree is the planned next improvement. |
| **InfinityFree** | Limited file count (inodes) and file size; daily hit limits | The built sites are ~1.4 MB, so fine. Don't use it for large downloads. |

**Don't** set up an uptime monitor that pings `/api/health` around the clock — it queries the database and would keep Neon awake 24/7, using up the 100 CU-hours in about 2–3 weeks.

---

## Security checklist

- [ ] `JWT_SECRET` on Render is a long random value (not `change-me-in-production`).
- [ ] `cow_flow_sign_up_pass` on Render is **not** `admin`.
- [ ] `backend/.env` was never pushed to GitHub (`git log --all -- backend/.env` shows nothing).
- [ ] Neon connection string is only stored in Render and your private notes.
- [ ] Both InfinityFree sites open with **https://** (padlock shown).
- [ ] After creating staff accounts, keep the signup pass private (or change it on Render — existing accounts keep working).
- [ ] Branch POS codes are effectively the POS password together with the Business Code. Don't use easy codes like `1234`, and change one if a cashier leaves.
- [ ] Renaming the business generates a **new Business Code**. Every branch's POS must then sign in with the new code.

---

## Troubleshooting

### Render log: `Failed to start server error: password authentication failed` / `getaddrinfo ENOTFOUND`
`DATABASE_URL` is wrong. Copy it again from Neon → **Connect** (with **Show password** on), paste it into Render, save and redeploy. Make sure there are no spaces or quotes around it.

### Render log: `DATABASE_URL is required`
The variable is missing or the key is misspelled. It must be exactly `DATABASE_URL`.

### Render build fails with `npm ERR! enoent ... package.json`
**Root Directory** isn't set to `backend`. Render → **Settings** → **Root Directory** → `backend` → save → **Manual Deploy**.

### Website shows a blank page
Press **F12** → **Console** tab:
- `404` for `assets/index-xxxx.js` → the `assets` folder wasn't uploaded into `htdocs`, or you uploaded the `dist` folder itself (files must be directly in `htdocs`, not `htdocs/dist`).

### Login fails with "Failed to fetch" / network error
Press **F12** → **Console**:
- **"blocked by CORS policy"** → `CORS_ORIGIN` on Render doesn't exactly match the site address. Check `https` vs `http`, `www`, and no trailing `/`. Save and redeploy.
- Request goes to `localhost:4000` or the site's own address → the build didn't get `VITE_API_BASE_URL`. Redo Part 6 and re-upload.
- **"Mixed Content"** → the site is `https` but the backend URL was typed with `http`. Rebuild with `https://…onrender.com/api`.
- Request is just slow / times out → Render was asleep. Wait a minute and try again.

### Refreshing `/login` or `/signup` shows a 404 page
`.htaccess` is missing from `htdocs`. Turn on hidden files in FileZilla (**Server → Force showing hidden files**) and upload `dist\.htaccess`.

### Sign up says "A business with that name already exists"
Enter business code `COW_001` (see Part 9.2), or use a different business name.

### "Upload … image under 2 MB" error
Use a smaller image (resize it to around 800 px wide before uploading).

### Neon says compute is suspended / quota exceeded
You used the 100 CU-hours for the month. Check that Render's Health Check Path is empty and that no uptime monitor is pinging `/api/health`. Usage resets next billing month, or upgrade in Neon.

---

## Local development (no change)

Running on this PC still works as before:

- Backend: `cd backend; npm start` (uses `backend/.env` → local PostgreSQL)
- Login site: `cd frontend; npx vite --port 3000`
- POS: `cd cowflow_pos; npx vite --port 5600`

When virtualization is enabled in the BIOS, `docker compose up --build` also works again.
