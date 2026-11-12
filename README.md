# CowFlo

CowFlo is a React + Node.js login experience with an owner-only sign-up page, PostgreSQL persistence, and Docker support.

## Stack

- React with Vite
- Tailwind CSS
- Font Awesome icons
- Node.js with Express
- PostgreSQL
- Docker Compose
- Socket.IO (WebSockets) for real-time updates

## Real-time updates

Every successful change (inventory, prices, stock, SKUs, branches, sales, refunds, account access, business settings) is broadcast over a WebSocket to every open admin screen and POS terminal of the same business, and they refresh instantly.

- Server: `backend/src/realtime.js`. A middleware maps each write route to topics (e.g. `/api/pos/checkout` → `sales`, `inventory`). The event carries topic names only, so screens re-fetch through the normal permission-checked API.
- Clients: `frontend/src/live.js` and `cowflow_pos/src/live.js` (same file). The dot on the admin profile picture and beside the POS branch name is green when live and gray while reconnecting. After a reconnect, everything reloads to catch up.
- The socket runs on the same port as the API, so no extra service or paid plan is needed. To make a new write route live, add its path to `topicRules` in `realtime.js`.

## Run with Docker

```bash
docker compose up --build
```

Frontend: `http://localhost:3000/login`

Backend health check: `http://localhost:4000/api/health`

Login uses username and password.

## Owner signup

The public app starts on the login page. The owner-only registration page lives at:

`http://localhost:3000/signup`

Use this signup pass when creating the owner account:

`cow_flow_sign_up_pass=admin`

Signup requires first name, last name, username, business name, email, password, confirm password, and the private signup pass.
