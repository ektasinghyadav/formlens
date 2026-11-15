# DFUA - Digital Form Usability Analyzer

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
   `JWT_SECRET` and `IP_HASH_SALT` (any long random strings). Never commit `.env`.
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
Check: open http://localhost:3000/api/v1/health (should show `{"status":"ok"}`).

## Test
```bash
cd server && npm test
cd client && npm test
```

