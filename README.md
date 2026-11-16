# FormLens - Digital Form Usability Analyzer (project code name: DFUA)

An admin builds and publishes a form. While respondents fill it in, their interactions
(which field they focused, how long, errors, where they quit) are recorded - never what
they typed. The server turns this into usability metrics, charts, and recommendations.

Stack: React (Vite) + Tailwind - Node.js + Express - MySQL - Recharts - JWT + bcrypt - Multer - Axios.

## Requirements
- Node.js 20 or newer (developed on Node 26)
- MySQL 8 (developed on 8.4)

## Setup
1. **Create the database and a dedicated user** (not root). In a MySQL shell as an admin:
   ```sql
   CREATE DATABASE dfua CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'dfua_user'@'localhost' IDENTIFIED BY 'choose-a-password';
   GRANT ALL PRIVILEGES ON dfua.* TO 'dfua_user'@'localhost';
   ```
2. **Create `.env`** in the project root: `cp .env.example .env`, then fill in `DB_PASSWORD`,
   `JWT_SECRET` (at least 32 random characters) and `IP_HASH_SALT` (any random string).
   Never commit `.env`. The server refuses to start while a secret is missing or still a placeholder.
   Quick way to make a secret: `openssl rand -hex 32`.
3. **Install dependencies:**
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```
4. **Create the tables:** `cd server && npm run db:init` (safe to run again).

## Run
In two terminals:
```bash
cd server && npm run dev     # API on http://localhost:3000/api/v1
cd client && npm run dev     # app on http://localhost:5173
```
Check: open http://localhost:3000/api/v1/health (should show `{"status":"ok"}`), then
http://localhost:5173/login and register an admin account.

## Demo data (synthetic)
```bash
cd server && npm run seed -- --reset      # 5,000 made-up visits on "Demo: Job Application"
```
Log in as `demo@example.com` / `demo-password-123`, open the form's **Dashboard**.
`--sessions 200` makes a smaller set.

## Test
Tests use the real MySQL database from `.env` (they create throwaway `...@example.test` admins and delete them again).
```bash
cd server && npm test        # API, engines, security review, 50-respondent concurrency test
cd client && npm test        # screens, event tracker, dashboard
```

## Useful commands (in `server/`)
| Command | What it does |
|---|---|
| `npm run db:init` | create the 8 tables and 5 indexes |
| `npm run seed` | make the synthetic demo data (`-- --reset`, `-- --sessions N`) |
| `npm run loadtest` | 50 simultaneous respondents; checks no event is lost (`-- --respondents 200`) |
| `npm run purge -- --dry-run` | show how many events are older than the retention period |
| `npm run purge` | delete events older than `EVENT_RETENTION_DAYS` (FR-4.2) |

## Settings (`.env`, see `.env.example`)
- `EVENT_RETENTION_DAYS` (default 180): interaction events older than this are removed by `npm run purge`. Sessions, submissions and answers are kept. Run the purge from a daily scheduled job (e.g. cron) if you want it automatic.
- `THRESHOLD_*` (optional): the cut-off numbers for recommendations, e.g. `THRESHOLD_ABANDONMENT_HIGH=0.25`. Defaults: `server/config/thresholds.js`.

## Deploying
Any standard Node.js host with a MySQL database works (NFR-5.2): set the `.env` values as
environment variables, run `npm run db:init`, build the client with `cd client && npm run build`
and serve `client/dist` (and proxy `/api` to the server), then run `npm start` in `server/`.
**Use HTTPS in production** (the SRS requires it): terminate TLS at your host or reverse proxy.
Passwords and the login token travel over the network, so plain HTTP is for local development only.
If the server runs behind a reverse proxy, set Express's `trust proxy` so the visitor's real address
(used only as a salted hash) is seen.

