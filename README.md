# AI-Powered Dynamic Quiz & Practice App

Generate quizzes on any topic (optionally from pasted notes), take them, and track your
progress over time — accuracy trends, topic breakdowns, streaks, badges, and a leaderboard.

Quiz content can come from a zero-setup mock generator or from a real LLM (Claude / GPT via
IBM Consulting Advantage). The mock provider is the default and needs no API keys.

## Stack

- **Backend:** Node.js, Express, Prisma (SQLite for local dev), JWT auth
- **Frontend:** React (Vite), React Router, Tailwind CSS, Recharts, CodeMirror

## Project structure

```
backend/    Express API, Prisma schema + seed script, tests
frontend/   React SPA (Vite)
```

## Prerequisites

- Node.js 18 or later and npm
- **Git is not required to run the app**, only to version-control it. If this copy of the
  project isn't already a Git repo and you want one, install [Git for Windows](https://git-scm.com/download/win)
  and run `git init` from the project root — nothing else here depends on Git being present.

## Setup

### 1. Backend

```
cd backend
npm install
copy .env.example .env
```

Open `backend/.env` and set at least `JWT_SECRET` to a long random string. Everything else has
a working default (see [Environment variables](#environment-variables) below).

```
npx prisma migrate dev
npm run seed
npm run dev
```

This creates `backend/dev.db` (SQLite), applies the schema, seeds badge definitions plus a
demo account (`demo@example.com` / `demopass123`) with one completed sample quiz already on
its history — so the dashboard/leaderboard/badges aren't empty on first login — and starts the
API on `http://localhost:4000`.

### 2. Frontend

In a second terminal:

```
cd frontend
npm install
copy .env.example .env
npm run dev
```

`frontend/.env` already points at the backend above by default. Open the URL Vite prints
(`http://localhost:5173`) and either log in as the demo account or sign up.

## Environment variables

**`backend/.env`**

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | `4000` |
| `JWT_SECRET` | Signs auth tokens — set this to a real secret | *(placeholder, change it)* |
| `DATABASE_URL` | Prisma datasource | `file:./dev.db` (SQLite) |
| `AI_PROVIDER` | Default quiz-generation provider: `mock` \| `claude` \| `openai` | `mock` |
| `QUIZ_GENERATE_RATE_LIMIT` | Max `/api/quiz/generate` calls per window per user | `10` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` | ICA-issued Claude access | unset |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | ICA-issued GPT access | unset |

**`frontend/.env`**

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Base URL the SPA calls | `http://localhost:4000/api` |

### Switching AI providers

`mock` costs nothing, needs no keys, and is what the app uses out of the box — every question
type and the short-answer grader all work against it. `claude` and `openai` call real models
through IBM Consulting Advantage (ICA), an internal gateway, not the public Anthropic/OpenAI
APIs directly. That code is written and unit-tested, but **has not been exercised against a
live ICA endpoint** — no ICA keys were available while building this. To try it: paste your
ICA-issued key(s) into `backend/.env`, then either set `AI_PROVIDER` or pass `provider` in a
`/api/quiz/generate` request. If a request fails, double-check `OPENAI_BASE_URL` — ICA
documentation samples have shown both `/ica/v1` and `/ica/openai` as the path suffix.

## Database

Local dev uses SQLite so there's nothing to install. The Prisma schema deliberately avoids
SQLite-only features, so moving to Postgres later is a two-line change in
`backend/prisma/schema.prisma` and `backend/.env`:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

```
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/quiz_app"
```

Then re-run `npx prisma migrate dev`.

## Tests

```
cd backend
npm test
```

## Scripts reference

**backend**

| Script | Does |
|---|---|
| `npm run dev` | Start the API with auto-restart on file changes |
| `npm start` | Start the API (no auto-restart) |
| `npm test` | Run the Vitest suite |
| `npm run prisma:migrate` | Apply Prisma migrations |
| `npm run seed` | Seed badge definitions + the demo account/quiz |

**frontend**

| Script | Does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `frontend/dist` |
| `npm run preview` | Preview the production build locally |
