# AI-Powered Dynamic Quiz & Practice App

Generate quizzes on any topic, optionally using pasted notes, take them, and track your progress over time with:

* Accuracy trends
* Topic breakdowns
* Streaks
* Badges
* Leaderboards

Quiz content can come from a zero-setup mock generator or from a real LLM such as Claude or GPT through IBM Consulting Advantage.

The **mock provider is enabled by default** and requires no API keys.

---

## Stack

### Backend

* Node.js
* Express
* Prisma
* SQLite for local development
* JWT authentication

### Frontend

* React
* Vite
* React Router
* Tailwind CSS
* Recharts
* CodeMirror

---

## Project Structure

```text
Quiz_app/
├── backend/        Express API, Prisma schema, seed script, tests
├── frontend/       React SPA powered by Vite
├── scripts/        Project setup and development helper scripts
└── package.json    Root scripts for setup and development
```

---

## Prerequisites

You only need:

* Node.js 18 or later
* npm

Git is **not required to run the application**. It is only needed if you want to clone or version-control the project.

If you want Git on Windows, install Git for Windows:

https://git-scm.com/download/win

---

# Quick Start

Clone or download the project, then open a terminal in the project root.

```bash
git clone <repository-url>
cd Quiz_app
```

Run:

```bash
npm run setup
```

The setup script automatically:

1. Installs the root dependencies
2. Installs backend dependencies
3. Installs frontend dependencies
4. Creates `backend/.env` from `backend/.env.example`
5. Creates `frontend/.env` from `frontend/.env.example`
6. Gives you a chance to configure environment variables
7. Applies the Prisma database migrations
8. Seeds the local database

When the environment files are created, open:

```text
backend/.env
frontend/.env
```

At minimum, change `JWT_SECRET` in `backend/.env` to a long random string.

The default mock AI provider requires no API keys.

After editing the environment files, return to the setup terminal and continue the setup.

Once setup is complete, start the entire application with:

```bash
npm run dev
```

This starts both the backend and frontend in the same terminal.

You should see output similar to:

```text
Starting QuizApp...

Quiz app backend listening on http://localhost:4000

VITE ready
Local: http://localhost:5173
```

Open:

```text
http://localhost:5173
```

To stop both the frontend and backend:

```text
Ctrl+C
```

There is no need to open two separate terminals.

---

## Demo Account

The seed script creates a demo account:

```text
Email:    demo@example.com
Password: demopass123
```

The demo account also contains a completed sample quiz so that the dashboard, leaderboard, badges, and history are not empty on the first login.

You can also create your own account from the frontend.

---

# Environment Variables

## `backend/.env`

| Variable                   | Purpose                                                   | Default                   |
| -------------------------- | --------------------------------------------------------- | ------------------------- |
| `PORT`                     | Backend API port                                          | `4000`                    |
| `JWT_SECRET`               | Secret used to sign authentication tokens                 | Placeholder — change this |
| `DATABASE_URL`             | Prisma database connection                                | `file:./dev.db`           |
| `AI_PROVIDER`              | Quiz-generation provider: `mock`, `claude`, or `openai`   | `mock`                    |
| `QUIZ_GENERATE_RATE_LIMIT` | Maximum `/api/quiz/generate` requests per window per user | `10`                      |
| `ANTHROPIC_API_KEY`        | ICA-issued Claude API key                                 | unset                     |
| `ANTHROPIC_BASE_URL`       | ICA Claude endpoint                                       | unset                     |
| `ANTHROPIC_MODEL`          | Claude model name                                         | unset                     |
| `OPENAI_API_KEY`           | ICA-issued GPT API key                                    | unset                     |
| `OPENAI_BASE_URL`          | ICA OpenAI-compatible endpoint                            | unset                     |
| `OPENAI_MODEL`             | GPT model name                                            | unset                     |

At minimum, set:

```env
JWT_SECRET=replace-this-with-a-long-random-secret
```

For normal local development, no AI API keys are required because:

```env
AI_PROVIDER=mock
```

is the default.

---

## `frontend/.env`

| Variable            | Purpose                              | Default                     |
| ------------------- | ------------------------------------ | --------------------------- |
| `VITE_API_BASE_URL` | Backend API URL used by the frontend | `http://localhost:4000/api` |

The default configuration already points the frontend to the local backend.

---

# AI Providers

## Mock

The mock provider:

* Requires no API key
* Costs nothing
* Works completely locally
* Supports quiz generation
* Supports all question types
* Supports the short-answer grader

It is the default provider:

```env
AI_PROVIDER=mock
```

This is the recommended option when first running the project.

---

## Claude

To use Claude through IBM Consulting Advantage, configure the relevant values in:

```text
backend/.env
```

For example:

```env
AI_PROVIDER=claude

ANTHROPIC_API_KEY=your-key
ANTHROPIC_BASE_URL=your-ica-endpoint
ANTHROPIC_MODEL=your-model
```

---

## OpenAI / GPT

To use GPT through IBM Consulting Advantage:

```env
AI_PROVIDER=openai

OPENAI_API_KEY=your-key
OPENAI_BASE_URL=your-ica-endpoint
OPENAI_MODEL=your-model
```

Claude and OpenAI requests are designed to go through **IBM Consulting Advantage (ICA)** rather than directly through the public Anthropic or OpenAI APIs.

The integration code is implemented and unit-tested, but it has not been tested against a live ICA endpoint because ICA credentials were not available during development.

If an OpenAI request fails, verify the value of:

```env
OPENAI_BASE_URL
```

ICA documentation examples may use different endpoint suffixes depending on the environment.

---

# Database

Local development uses SQLite, so no separate database server needs to be installed.

Running:

```bash
npm run setup
```

automatically creates and prepares the local database.

The SQLite database is stored at:

```text
backend/dev.db
```

Prisma migrations are stored under:

```text
backend/prisma/migrations/
```

---

## Switching to PostgreSQL

The Prisma schema intentionally avoids SQLite-specific features, making it easier to move to PostgreSQL later.

Change the datasource in:

```text
backend/prisma/schema.prisma
```

from:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

to:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then update:

```text
backend/.env
```

with something such as:

```env
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/quiz_app"
```

Then apply the migrations from the backend directory:

```bash
cd backend
npx prisma migrate dev
```

---

# Development

After the initial setup, you normally only need:

```bash
npm run dev
```

This starts:

```text
Backend  → http://localhost:4000
Frontend → http://localhost:5173
```

Both processes run together from the project root.

You do **not** need to run:

```bash
cd backend
npm run dev
```

and then open another terminal for:

```bash
cd frontend
npm run dev
```

The root development script handles both.

Press:

```text
Ctrl+C
```

to stop the application.

---

# Initial Setup vs Daily Development

The setup command normally only needs to be run once:

```bash
npm run setup
```

After that, whenever you want to work on the project:

```bash
npm run dev
```

So the normal workflow is simply:

```text
First time:

npm run setup
npm run dev


Every time after:

npm run dev
```

---

# Tests

Backend tests can be run with:

```bash
cd backend
npm test
```

---

# Scripts Reference

## Root

| Script          | Does                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `npm run setup` | Install dependencies, create environment files, migrate the database, and seed development data |
| `npm run dev`   | Start the backend and frontend together                                                         |

---

## Backend

Run these from:

```bash
cd backend
```

| Script                   | Does                                                    |
| ------------------------ | ------------------------------------------------------- |
| `npm run dev`            | Start the API with automatic restart on file changes    |
| `npm start`              | Start the API without auto-restart                      |
| `npm test`               | Run the Vitest test suite                               |
| `npm run prisma:migrate` | Apply Prisma migrations                                 |
| `npm run seed`           | Seed badge definitions and the demo account/sample quiz |

---

## Frontend

Run these from:

```bash
cd frontend
```

| Script            | Does                                         |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Start the Vite development server            |
| `npm run build`   | Create a production build in `frontend/dist` |
| `npm run preview` | Preview the production build locally         |

---

# Manual Setup

Normally you should use:

```bash
npm run setup
```

If you need to configure everything manually for debugging or development, follow these steps.

## Backend

```bash
cd backend
npm install
copy .env.example .env
```

Edit:

```text
backend/.env
```

Then run:

```bash
npx prisma migrate dev
npm run seed
npm run dev
```

The backend runs at:

```text
http://localhost:4000
```

---

## Frontend

Open another terminal:

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

The frontend normally runs at:

```text
http://localhost:5173
```

---

# Quick Summary

For a new installation:

```bash
git clone <repository-url>
cd Quiz_app
npm run setup
npm run dev
```

For normal development after setup:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

That's it.
