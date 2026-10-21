# CowFlo

CowFlo is a React + Node.js login experience with an owner-only sign-up page, PostgreSQL persistence, and Docker support.

## Stack

- React with Vite
- Tailwind CSS
- Font Awesome icons
- Node.js with Express
- PostgreSQL
- Docker Compose

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
