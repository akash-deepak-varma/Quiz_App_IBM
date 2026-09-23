# AI-Powered Dynamic Quiz & Practice App

Generate quizzes on any topic, optionally from your own pasted notes, take them, and track your
progress over time with accuracy trends, topic breakdowns, streaks, badges and leaderboards.

Quiz content comes either from a built-in **mock generator** that needs no accounts, keys or internet
access, or from a real LLM (Claude or GPT) through IBM Consulting Advantage. **The mock generator is
the default**, so you can have the whole app running without signing up for anything.

**New to this kind of project?** Start at [Part 1](#part-1--install-what-the-app-needs) and work
straight down. Every command is written out in full, and after each step there is a way to check it
worked. You do not need to understand the code to run it.

---

## Contents

**Getting it running**

1. [Part 1 — Install what the app needs](#part-1--install-what-the-app-needs)
   * [1.1 Opening a terminal](#11-opening-a-terminal)
   * [1.2 Install Node.js](#12-install-nodejs)
   * [1.3 Choose your database](#13-choose-your-database)
   * [1.4 Install PostgreSQL](#14-install-postgresql)
   * [1.5 Create the database](#15-create-the-database)
   * [1.6 Build your connection URL](#16-build-your-connection-url)
   * [1.7 Git (optional)](#17-git-optional)
2. [Part 2 — Set up the project](#part-2--set-up-the-project)
3. [Part 3 — Start the app](#part-3--start-the-app)
4. [Part 4 — Everyday use](#part-4--everyday-use)
5. [Troubleshooting](#troubleshooting)

**Reference**

6. [Environment variables](#environment-variables)
7. [Database](#database)
8. [AI providers](#ai-providers)
9. [Tests](#tests)
10. [Scripts reference](#scripts-reference)
11. [Manual setup without the setup script](#manual-setup-without-the-setup-script)
12. [Project structure](#project-structure)
13. [Stack](#stack)

---

# Part 1 — Install what the app needs

There are only two things to install, and one of them is optional:

| Thing          | Required?                          | Why                                        |
| -------------- | ---------------------------------- | ------------------------------------------ |
| **Node.js**    | Yes                                | Runs the app. Comes with `npm`.            |
| **PostgreSQL** | Only if you choose it over SQLite  | Stores your quizzes, attempts and progress |
| **Git**        | No                                 | Only for cloning / version control         |

Budget about 15 minutes for this part if you pick PostgreSQL, or about 3 minutes if you pick SQLite.

---

## 1.1 Opening a terminal

Almost everything below is typed into a terminal (also called a command line, shell, or console). If
you have not used one before, this is the only unfamiliar part, and it is just a window where you type
a command and press Enter.

**Windows**

1. Press the **Start** key.
2. Type `powershell`.
3. Click **Windows PowerShell**.

**macOS**

1. Press **Cmd + Space**.
2. Type `terminal`.
3. Press Enter.

**Linux**

Press **Ctrl + Alt + T**, or find "Terminal" in your applications menu.

### Moving to a folder

The terminal is always "inside" one folder, and commands act on that folder. To move into another one
you use `cd` (change directory):

```bash
cd C:\Users\YourName\Downloads\Quiz_app     # Windows example
cd ~/Downloads/Quiz_app                      # macOS / Linux example
```

Two shortcuts that save a lot of typing:

* Type `cd ` (with the space), then **drag the folder from your file manager onto the terminal
  window** — the path is filled in for you. Press Enter.
* On Windows, **Shift + right-click** a folder in File Explorer and choose **Open PowerShell window
  here**.

To confirm where you are:

```bash
pwd          # macOS / Linux
cd           # Windows PowerShell, with nothing after it, prints the current folder
```

---

## 1.2 Install Node.js

Node.js is the program that runs this app. `npm`, which installs the app's building blocks, is
included with it — you do not install `npm` separately.

**You need Node.js 18 or newer.** Version 20 LTS or newer is recommended. (Development on this project
happens on Node 24.)

### Windows

1. Go to **<https://nodejs.org/en/download>**.
2. Download the **LTS** Windows Installer (`.msi`).
3. Run it and click through with the default options. Leave every checkbox as it comes.
4. **Close the terminal and open a new one.** New installations are not visible to terminals that were
   already open — this is the single most common reason the next step appears to fail.

### macOS

Either download the **LTS** macOS Installer (`.pkg`) from <https://nodejs.org/en/download> and run it,
or, if you already use Homebrew:

```bash
brew install node
```

### Linux (Debian / Ubuntu)

Your distribution's own package is often several years old. Use NodeSource instead:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Check it worked

```bash
node -v
npm -v
```

You should see two version numbers, for example:

```text
v22.14.0
10.9.2
```

If instead you see `node: command not found` or `'node' is not recognized as an internal or external
command`, see [Troubleshooting → npm or node is not recognized](#npm-or-node-is-not-recognized).

---

## 1.3 Choose your database

The app stores everything — accounts, quizzes, attempts, streaks — in a database. You have two
options, and **both run the whole app**. This is the one decision worth making before you start,
because it changes what you install.

|                                              | SQLite                        | PostgreSQL                          |
| -------------------------------------------- | ----------------------------- | ----------------------------------- |
| Anything to install?                         | **No**                        | Yes, a database server              |
| Setup time                                   | none                          | ~10 minutes, once                   |
| Whole app works, background generation too?  | **Yes**                       | **Yes**                             |
| People using it at the same time             | one                           | many                                |
| Can run several background workers           | no                            | yes                                 |
| Where your data lives                        | one file inside the project   | in the database server              |
| Best for                                     | trying it out; one person     | anything shared, or a real server   |

**If you are unsure, pick SQLite.** Nothing is lost by starting there: switching later is two
commands, and the app itself behaves identically. SQLite is a fully supported option here, not a
crippled fallback — all 144 backend tests run against it. The only real difference is that SQLite
allows one writer at a time, which matters when several people use the app at once, and never matters
on your own laptop.

**Chose SQLite?** You are done with Part 1 except for the optional Git step — skip ahead to
[Part 2](#part-2--set-up-the-project). When Part 2 asks you to edit `backend/.env`, you will set:

```env
DATABASE_URL="file:./dev.db"
```

**Chose PostgreSQL?** Continue to 1.4.

---

## 1.4 Install PostgreSQL

You need **PostgreSQL 13 or newer**. Any current version (16, 17, 18) is fine.

### Windows

1. Go to **<https://www.postgresql.org/download/windows/>** and click **Download the installer**.
   This takes you to EDB, who package the official Windows build.
2. Download the latest version and run the installer.
3. Click **Next** through the first screens, leaving the install directory as it is.
4. On the **Select Components** screen, keep these checked:
   * **PostgreSQL Server** — the database itself.
   * **pgAdmin 4** — a point-and-click tool for looking inside the database. Recommended.
   * **Command Line Tools** — gives you `psql` and `pg_isready`, used below.
   * *Stack Builder* is not needed. Leave it unchecked if offered.
5. **Data Directory** — leave the default.
6. **Password** — the installer asks you to set a password for the database superuser, which is named
   `postgres`.

   > **Write this password down now.** You will need it in step 1.6, and there is no easy way to
   > recover it later. Avoid `@`, `:`, `/`, `#` and `?` if you can — they are legal, but they have to
   > be escaped in the connection URL (1.6 explains how, if you already used one).

7. **Port** — leave it at **5432** unless you know you need something else.
8. **Locale** — leave the default.
9. Click through to the end. If the last screen offers to launch Stack Builder, uncheck it and finish.

The database server now starts automatically with Windows, so this is a one-time job.

### macOS

The simplest route is **Postgres.app**:

1. Download it from <https://postgresapp.com>.
2. Drag it into your Applications folder and open it.
3. Click **Initialize**. That is the whole installation — an elephant icon in the menu bar means it is
   running.
4. To get the `psql` command in your terminal, run:

   ```bash
   sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
   ```

   Then close and reopen the terminal.

With Postgres.app there is **no password** for local connections, and your macOS username is the
database user. Homebrew behaves the same way:

```bash
brew install postgresql@17
brew services start postgresql@17
```

### Linux (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install postgresql
sudo systemctl enable --now postgresql
```

Fedora / RHEL:

```bash
sudo dnf install postgresql-server
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

On Linux the `postgres` user has no password by default and is reached through the system account.
Step 1.5 shows how to set a password so the app can connect over the network the way it expects.

### Check the server is running

```bash
pg_isready
```

Expected:

```text
localhost:5432 - accepting connections
```

If you get `no response`, or `pg_isready` is not found, see
[Troubleshooting → Can't reach database server](#cant-reach-database-server-at-localhost5432).

Other ways to check:

* **Windows** — press Start, type `services`, open **Services**, and look for `postgresql-x64-18`
  (the number matches your version). Its status should be **Running**. You can start it from here if
  it is not.
* **macOS** — the Postgres.app elephant icon is in the menu bar, or run `brew services list`.
* **Linux** — `sudo systemctl status postgresql`.

---

## 1.5 Create the database

PostgreSQL is now running, but it is empty. The app needs a database inside it, conventionally named
`quiz_app`. **Create it now** — this is the step most often skipped, and without it setup stops
during the migration step with `P1003: Database "quiz_app" does not exist`.

Pick whichever of the two approaches below you find more comfortable. They do exactly the same thing.

### Option A — pgAdmin (point and click)

1. Open **pgAdmin 4** (installed alongside PostgreSQL on Windows).
2. On first launch it asks for a **master password**. This is a password for pgAdmin itself, not for
   the database — set anything you will remember.
3. In the left sidebar, expand **Servers**. Click **PostgreSQL <version>**. It asks for the `postgres`
   password you set during installation. Enter it and tick "Save password".
4. Right-click **Databases** → **Create** → **Database…**.
5. In **Database**, type `quiz_app`. Leave everything else alone.
6. Click **Save**.

`quiz_app` now appears under Databases. That is all you need pgAdmin for, though it is also the
easiest way to browse your data later.

### Option B — psql (the terminal)

**Windows:** press Start, type `sql shell`, and open **SQL Shell (psql)**. It asks four questions —
press **Enter** for each to accept the defaults (Server `localhost`, Database `postgres`, Port `5432`,
Username `postgres`) — then type the password you set during installation. It will not show anything
as you type the password; that is normal.

**macOS:**

```bash
psql postgres
```

**Linux:**

```bash
sudo -u postgres psql
```

Once you see the `postgres=#` prompt, type this — **including the semicolon**, which is what tells
psql the command is finished:

```sql
CREATE DATABASE quiz_app;
```

You should see `CREATE DATABASE`. Confirm it exists:

```sql
\l
```

`quiz_app` should be in the list. Press `q` to leave the list, then leave psql:

```sql
\q
```

### Linux only — give the postgres user a password

The app connects over the network, which needs a password. Still inside psql:

```sql
ALTER USER postgres WITH PASSWORD 'choose-a-password';
```

### Optional — a dedicated user instead of the superuser

Using `postgres` is fine for a local install. For anything shared, give the app its own account:

```sql
CREATE USER quiz_user WITH PASSWORD 'choose-a-password';
CREATE DATABASE quiz_app OWNER quiz_user;
```

The `OWNER` part matters. From PostgreSQL 15 onwards, a plain user cannot create tables in a database
it does not own, so a `quiz_user` that is not the owner will fail during setup with a permission
error. Making it the owner at creation time avoids that entirely.

---

## 1.6 Build your connection URL

This is the "connecting them" step: one line of text that tells the app where the database is and how
to log in. It goes into `backend/.env` in Part 2.

A PostgreSQL URL is five pieces in a fixed order:

```text
postgresql://postgres:MyPassword123@localhost:5432/quiz_app
             ─────┬── ───────┬───── ────┬──── ─┬── ───┬────
                  │          │          │      │      │
            username     password      host   port  database name
```

| Piece         | What to put                                                     |
| ------------- | --------------------------------------------------------------- |
| username      | `postgres`, or `quiz_user` if you created one                    |
| password      | the password you set during installation (or for that user)      |
| host          | `localhost` — the same machine you are on                        |
| port          | `5432` unless you changed it                                     |
| database name | `quiz_app` — the one you created in 1.5                          |

So if your password is `Summer2026`, your line is:

```env
DATABASE_URL="postgresql://postgres:Summer2026@localhost:5432/quiz_app"
```

**macOS with Postgres.app or Homebrew** has no password and uses your own username:

```env
DATABASE_URL="postgresql://YourMacUsername@localhost:5432/quiz_app"
```

### If your password contains special characters

A URL gives special meaning to a handful of characters, so they cannot appear literally in the
password. Replace them:

| In your password | Write instead |
| ---------------- | ------------- |
| `@`              | `%40`         |
| `:`              | `%3A`         |
| `/`              | `%2F`         |
| `#`              | `%23`         |
| `?`              | `%3F`         |
| `&`              | `%26`         |
| `%`              | `%25`         |
| a space          | `%20`         |

A password of `p@ss:word` becomes:

```env
DATABASE_URL="postgresql://postgres:p%40ss%3Aword@localhost:5432/quiz_app"
```

Getting this wrong produces an authentication error even though the password is "right" — see
[Troubleshooting → Authentication failed](#authentication-failed-for-user-postgres).

### SQLite, for comparison

If you chose SQLite in 1.3, there is no server, user or password — just a filename:

```env
DATABASE_URL="file:./dev.db"
```

The file is created for you on first use. A relative path like this is resolved against
`backend/prisma/sqlite/`, so `dev.db` lands there.

---

## 1.7 Git (optional)

Git is **not needed to run the app**. It is only how you download the project if you want to track
changes or pull updates later; otherwise you can download a ZIP from the project page instead.

* Windows: <https://git-scm.com/download/win>
* macOS: `brew install git`, or it is included with Xcode Command Line Tools
* Linux: `sudo apt install git`

---

# Part 2 — Set up the project

## Step 1 — Get the project onto your machine

With Git:

```bash
git clone <repository-url>
cd Quiz_app
```

Without Git: download the ZIP, extract it somewhere sensible such as your Documents folder, then `cd`
into the extracted folder (see [1.1](#11-opening-a-terminal) for the drag-and-drop shortcut).

Check you are in the right place — this should list `backend`, `frontend`, `scripts` and
`package.json`:

```bash
ls        # macOS / Linux
dir       # Windows
```

## Step 2 — Run the setup script

From the project root (the folder containing `package.json`):

```bash
npm run setup
```

This does seven things in order:

1. Installs the root dependencies
2. Installs the backend dependencies
3. Installs the frontend dependencies
4. Creates `backend/.env` from `backend/.env.example`
5. Creates `frontend/.env` from `frontend/.env.example`
6. **Pauses**, so you can fill those two files in
7. After you press Enter: prepares the database driver, creates all the tables, and adds the demo data

The first three steps download a few hundred packages and can take several minutes on a slow
connection. Scrolling output and warnings about deprecated packages are normal. Only a line beginning
`npm error` means something actually failed.

## Step 3 — Fill in the environment files

The script stops with:

```text
Fill in backend/.env and frontend/.env, then press ENTER to continue...
```

**Leave the terminal open** and edit the files in another window. Any plain text editor works —
Notepad, TextEdit, VS Code. There are exactly two values to change, both in `backend/.env`.

> **Do not rename `.env` or commit it.** It holds your database password, and it is deliberately
> excluded from version control.

### `JWT_SECRET` — required

This signs the login tokens that keep you logged in. The file ships with a placeholder that the app
refuses to start on. Replace it with any long random string — 30+ characters, no spaces:

```env
JWT_SECRET=g7Kq2wXpR4tLvNc8sYzB1mHdJ6fQaE3u
```

It does not need to be memorable, and you never type it again. To have one generated for you:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `DATABASE_URL` — required

Replace the placeholder line with the URL you built in [1.6](#16-build-your-connection-url).

**PostgreSQL:**

```env
DATABASE_URL="postgresql://postgres:YourPassword@localhost:5432/quiz_app"
```

**SQLite:**

```env
DATABASE_URL="file:./dev.db"
```

This one line is the *only* thing that decides which database engine the app uses. There is no second
setting to keep in step with it and nothing to change inside the code.

### Everything else — leave alone

Ignore the remaining variables for now. In particular `AI_PROVIDER=mock` is what lets the app generate
quizzes with no API key and no internet access. [AI providers](#ai-providers) covers switching to a
real model later.

`frontend/.env` needs no changes at all; it already points at the local backend.

## Step 4 — Let setup finish

Save both files, return to the terminal, and press **Enter**.

The script now generates the database driver, creates the tables, and seeds the demo data. Expect:

```text
Generating the Prisma client for your database...
Applying database migrations...
Seeding database...
Created default org: Default Org
Created badge: ...
Created demo user: demo@example.com (password: demopass123)
Created sample quiz "JavaScript Basics" for demo@example.com

=========================
 Setup complete!
=========================
```

If it ends in `Setup failed while running: ...` instead, the message underneath names the real cause.
The usual suspects are the `DATABASE_URL` placeholder left unedited, PostgreSQL not running, or the
`quiz_app` database not created — all covered in [Troubleshooting](#troubleshooting).

---

# Part 3 — Start the app

From the project root:

```bash
npm run dev
```

This starts the backend and the frontend together in one terminal. You do not need a second one.

```text
[BACKEND] Quiz app backend listening on http://localhost:4000
[FRONTEND]   VITE v5  ready in 412 ms
[FRONTEND]   ➜  Local:   http://localhost:5173/
```

Open **<http://localhost:5173>** in your browser.

## Log in

The seed data includes a ready-made account:

```text
Email:    demo@example.com
Password: demopass123
```

It comes with one completed quiz, so the dashboard, history, badges and leaderboard have something in
them on your first visit rather than being empty. You can also register your own account from the
sign-up page.

## Generate your first quiz

1. Click **Generate Quiz**.
2. Type a topic, for example `Python loops`.
3. Choose how many questions and a difficulty. Optionally paste notes for it to draw on.
4. Submit. A progress screen counts the questions as they are produced, then the quiz opens.

With `AI_PROVIDER=mock` the questions are generated locally, instantly, and cost nothing. They are
structurally real but their content is placeholder — that is the point of the mock provider. Swap in a
real model when you have keys.

## Stopping the app

Press **Ctrl + C** in the terminal. That stops both halves.

---

# Part 4 — Everyday use

Setup is a one-time job. From then on:

```bash
npm run dev
```

That is the whole routine:

```text
First time ever:        npm run setup
                        npm run dev

Every time after:       npm run dev
```

Re-run `npm run setup` only after pulling changes that add dependencies or database tables. It is safe
to run again — it will not overwrite an existing `.env`.

---

# Troubleshooting

Find the error message you are seeing. Most of these are configuration, not breakage.

### npm or node is not recognized

```text
'npm' is not recognized as an internal or external command
npm: command not found
```

Either Node.js is not installed, or your terminal was open before you installed it. **Close every
terminal window, open a new one, and try `node -v` again.** If it still fails, reinstall Node.js from
<https://nodejs.org/en/download> and accept the default options — they include adding Node to your
PATH.

### JWT_SECRET is not set

```text
Error: JWT_SECRET is not set -- copy .env.example to .env and fill it in.
```

`backend/.env` is missing, or `JWT_SECRET` is empty. Set it as shown in
[Part 2 Step 3](#jwt_secret--required). If `backend/.env` does not exist at all, copy it:

```bash
cd backend
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

### DATABASE_URL does not name a supported database

```text
Error: DATABASE_URL does not name a supported database. Use a PostgreSQL URL
("postgresql://...") or a SQLite file path ("file:./dev.db").
```

The URL does not start with `postgresql://`, `postgres://` or `file:`. Common causes: a missing `//`,
a stray quote, or a Windows path written as `C:\...` instead of `file:./dev.db`. The app checks this
at startup on purpose, so you get this message instead of a confusing failure later.

### Can't reach database server at localhost:5432

```text
Error: P1001: Can't reach database server at `localhost:5432`
```

PostgreSQL is not running, or not on that port.

* **Windows** — Start → `services` → find `postgresql-x64-<version>` → right-click → **Start**.
* **macOS** — open Postgres.app and check the elephant icon, or `brew services start postgresql@17`.
* **Linux** — `sudo systemctl start postgresql`.

Then confirm with `pg_isready`, which should say `accepting connections`. If PostgreSQL is on a
different port, correct the `:5432` in your `DATABASE_URL`.

### Authentication failed for user "postgres"

```text
Error: P1000: Authentication failed against database server, the provided database
credentials for `postgres` are not valid.
```

The username or password in `DATABASE_URL` is wrong. Three things to check, in this order:

1. **Special characters in the password.** This is the most common cause and it looks exactly like a
   wrong password. See [the encoding table](#if-your-password-contains-special-characters) — an `@`
   must be written `%40`.
2. **The password itself.** Test it independently: `psql -U postgres -h localhost` and enter it. If
   psql rejects it too, the password is genuinely wrong, not the URL.
3. **The username.** It is `postgres` unless you created your own user.

Forgotten the password entirely? On Windows the least painful fix is to re-run the PostgreSQL
installer and choose to repair/reinstall, setting a new one.

### Database "quiz_app" does not exist

```text
Error: P1003: Database `quiz_app` does not exist on the database server
```

[Step 1.5](#15-create-the-database) was skipped, or the database has a different name. Either create
it, or change the last part of `DATABASE_URL` to match what you actually named it.

### permission denied for schema public

Your database user is not the owner of the database. Connect as `postgres` and transfer ownership:

```sql
ALTER DATABASE quiz_app OWNER TO quiz_user;
```

From PostgreSQL 15 onwards, only the owner may create tables in a new database. See
[the note in 1.5](#optional--a-dedicated-user-instead-of-the-superuser).

### Setup failed while running: ...

The setup script prints the underlying error right below this line, plus the three most common causes.
Read that message — it is the actual problem. Once you have fixed it, simply run `npm run setup`
again; the steps that already succeeded are cheap to repeat.

### Port 4000 (or 5173) is already in use

```text
Error: listen EADDRINUSE: address already in use :::4000
```

Something else is on that port — often a previous copy of this app that did not shut down. Close other
terminals running `npm run dev`. If the port is genuinely taken by another program, change
`PORT=4000` in `backend/.env` to something free such as `4100`, and update `VITE_API_BASE_URL` in
`frontend/.env` to match:

```env
VITE_API_BASE_URL=http://localhost:4100/api
```

### The page loads but nothing works / "Failed to fetch"

The frontend is running but cannot reach the backend. Check that the `[BACKEND]` line appeared when
you ran `npm run dev`, and open <http://localhost:4000/api/health> directly — it should show
`{"status":"ok"}`. If the backend is on a non-default port, `VITE_API_BASE_URL` in `frontend/.env` must
point at it. Vite reads `.env` only at startup, so restart `npm run dev` after changing it.

### Login says invalid credentials with the demo account

The seed data has not been created, or the database was reset. From the project root:

```bash
cd backend
npm run seed
```

### Tests or the app fail right after switching database engines

```text
Error: the URL must start with the protocol `file:` / `postgresql://`
```

The database driver is generated for one engine at a time, and the test commands regenerate it for
whichever engine they target. If the last thing you ran was `npm run test:sqlite` but you develop on
PostgreSQL, put the driver back before starting the app:

```bash
cd backend
npm run db:generate
```

### Everything is broken and I want to start over

This deletes all your quizzes and accounts, then rebuilds from scratch.

**SQLite** — delete the database file and re-create it:

```bash
cd backend
rm prisma/sqlite/dev.db*        # Windows PowerShell: del prisma\sqlite\dev.db*
npm run db:deploy
npm run seed
```

**PostgreSQL** — drop and re-create the database, then rebuild:

```sql
DROP DATABASE quiz_app;
CREATE DATABASE quiz_app;
```

```bash
cd backend
npm run db:deploy
npm run seed
```

---

# Environment variables

## `backend/.env`

Only the first two need your attention. Everything else has a working default.

| Variable                           | Purpose                                                        | Default                       |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| `JWT_SECRET`                       | Signs login tokens. **Must be changed** — the app will not start on the placeholder | placeholder      |
| `DATABASE_URL`                     | Where the database is. Its scheme picks the engine             | Postgres URL placeholder      |
| `PORT`                             | Backend API port                                               | `4000`                        |
| `AI_PROVIDER`                      | `mock`, `claude` or `openai`                                   | `mock`                        |
| `QUIZ_GENERATE_RATE_LIMIT`         | Max generation requests per window per user                    | `10`                          |
| `AI_PROVIDER_TIMEOUT_MS`           | Per-request timeout for a real provider                        | `20000`                       |
| `AI_PROVIDER_MAX_RETRIES`          | SDK-level retries for a real provider                          | `2`                           |
| `AI_GENERATION_CONCURRENCY`        | Question batches generated in parallel                         | `3`                           |
| `AI_GENERATION_MAX_BATCH_ATTEMPTS` | Retries per batch before giving up on it                       | `3`                           |
| `GENERATION_LOG`                   | `off` silences the per-batch `[GEN]` log lines                  | `on`                          |
| `GENERATION_WORKER_ENABLED`        | Runs the background generation worker inside the API process   | `true`                        |
| `GENERATION_WORKER_POLL_MS`        | How often the worker looks for queued jobs                     | `1000`                        |
| `GENERATION_LEASE_MS`             | How stale a crashed job's claim must be before another worker resumes it | `120000`            |
| `ANTHROPIC_API_KEY`                | ICA-issued Claude key                                          | unset                         |
| `ANTHROPIC_BASE_URL`               | ICA Claude endpoint                                            | ICA gateway                   |
| `ANTHROPIC_MODEL`                  | Claude model name                                              | `claude-3-5-sonnet-20241022`  |
| `OPENAI_API_KEY`                   | ICA-issued GPT key                                             | unset                         |
| `OPENAI_BASE_URL`                  | ICA OpenAI-compatible endpoint                                 | ICA gateway                   |
| `OPENAI_MODEL`                     | GPT model name                                                 | `gpt-5.6-terra-dzus`          |

## `frontend/.env`

| Variable            | Purpose                              | Default                     |
| ------------------- | ------------------------------------ | --------------------------- |
| `VITE_API_BASE_URL` | Backend API URL used by the frontend | `http://localhost:4000/api` |

Already correct for a local install. Change it only if you moved the backend off port 4000.

---

# Database

The app runs on **PostgreSQL** or **SQLite**. `DATABASE_URL` in `backend/.env` is the only thing that
decides which:

```env
# PostgreSQL
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/quiz_app"

# SQLite
DATABASE_URL="file:./dev.db"
```

Nothing else changes. The URL's scheme selects the Prisma schema, the migration history and the
generated client, so there is no `provider` line to edit and no second setting that can contradict the
URL. If the URL names neither engine, the backend refuses to start and tells you, instead of failing
later on whichever request happens to touch the database first.

## Choosing one

|                                          | SQLite              | PostgreSQL                |
| ---------------------------------------- | ------------------- | ------------------------- |
| Database server to install               | none                | yes                       |
| Full app, background generation included | yes                 | yes                       |
| Concurrent writers                       | one at a time       | many                      |
| Several worker processes                 | no                  | yes                       |
| Suited to                                | one person, locally | anything shared or hosted |

SQLite is a supported option rather than a degraded one: every feature and all 144 backend tests run
on it. The difference that matters is concurrency. SQLite allows one writer at a time, so a busy
multi-user install -- or a deployment that runs separate worker processes -- wants PostgreSQL. For one
person on a laptop it never comes up.

On SQLite the backend switches the database into WAL mode at startup, which keeps reads fast while a
write is in flight, and Prisma waits up to 5 seconds for a write lock before giving up. Add
`?socket_timeout=20` to the URL to wait 20 seconds instead.

## Where each engine keeps its files

|            | SQLite                                                           | PostgreSQL                     |
| ---------- | ---------------------------------------------------------------- | ------------------------------ |
| Schema     | `backend/prisma/sqlite/schema.prisma` (generated)                | `backend/prisma/schema.prisma` |
| Migrations | `backend/prisma/sqlite/migrations/`                              | `backend/prisma/migrations/`   |
| Data       | the file in `DATABASE_URL`, relative to `backend/prisma/sqlite/` | your Postgres server           |

The engines need separate migration histories because SQLite cannot express some of what the Postgres
migrations do -- `ALTER TABLE ... ADD CONSTRAINT`, for instance. The *schema*, though, is generated
rather than hand-maintained: the models are identical and only the datasource block differs, so a
second copy would just be somewhere for the two to drift apart.

```bash
cd backend
npm run db:sync-sqlite     # regenerate after editing prisma/schema.prisma
```

The test suite fails if it is out of date, so drift is caught rather than discovered.

## Applying migrations

From `backend/`. Each of these reads `DATABASE_URL` and picks the matching schema itself:

```bash
npm run db:deploy       # apply the migrations that ship with the repo -- what an install wants
npm run db:migrate      # author a new migration, after changing prisma/schema.prisma
npm run db:generate     # regenerate the Prisma client
```

## Looking inside the database

```bash
cd backend
node scripts/prisma.mjs studio
```

This opens a browser table-browser at <http://localhost:5555> — useful for confirming a quiz really
was saved. Use the wrapper rather than `npx prisma studio`: the wrapper picks the schema that matches
`DATABASE_URL`, whereas the bare command always reads the PostgreSQL schema and refuses to run against
a `file:` URL. pgAdmin works too, for PostgreSQL.

## Switching engines later

Edit `DATABASE_URL`, then from `backend/`:

```bash
npm run db:deploy
npm run seed
```

Your data does not come with you. This gives you the new database with the schema applied, not a copy
of the old one.

## Upgrading an install that was already using SQLite

Older versions of this project shipped `provider = "sqlite"` in `backend/prisma/schema.prisma`, and
some installs edited that line by hand. Those databases have tables but no migration history Prisma
recognises, so `db:deploy` would try to create tables that already exist. Record the initial migration
as already applied first:

```bash
cd backend
npx prisma migrate resolve --applied 20260923105149_init --schema prisma/sqlite/schema.prisma
npm run db:deploy
```

If the folder name under `backend/prisma/sqlite/migrations/` differs from the one above, use that one.

---

# AI providers

## Mock — the default

The mock provider needs no API key, costs nothing, works offline, and supports every question type
including the short-answer grader. It is what makes the app fully usable without credentials:

```env
AI_PROVIDER=mock
```

Its questions are structurally complete but their wording is placeholder. Use it to learn the app and
to develop against; switch to a real model when you want real content.

## Claude, through IBM Consulting Advantage

In `backend/.env`:

```env
AI_PROVIDER=claude
ANTHROPIC_API_KEY=your-ica-key
ANTHROPIC_BASE_URL=https://api.nextgen-beta.ica.ibm.com/ica
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

## GPT, through IBM Consulting Advantage

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your-ica-key
OPENAI_BASE_URL=https://api.nextgen-beta.ica.ibm.com/ica/v1
OPENAI_MODEL=gpt-5.6-terra-dzus
```

Restart the app after changing any of these.

Both providers are wired to go through **IBM Consulting Advantage (ICA)** rather than the public
Anthropic or OpenAI APIs. The integration is implemented and unit-tested, but it has **not** been
exercised against a live ICA endpoint, because ICA credentials were not available during development.
Treat the first real call as something to verify rather than assume.

If GPT requests fail, check `OPENAI_BASE_URL` first. An older ICA document showed `.../ica/openai`
where the current one shows `.../ica/v1`; if `/v1` returns a 404, try the other.

---

# Tests

Backend:

```bash
cd backend
npm test
```

That runs against whichever engine `DATABASE_URL` names, in a database of its own -- a `test` schema
on Postgres, a separate `test.db` on SQLite -- so it never touches your development data. To run
against a specific engine, or both:

```bash
npm run test:postgres
npm run test:sqlite
npm run test:all
```

`test:postgres` needs a Postgres URL in `.env` even if you normally develop on SQLite, since that is
where it reads the host and credentials from. Each of these regenerates the Prisma client for its
engine first, so the last one you ran leaves the client pointed at that engine -- run `npm run
db:generate` before `npm run dev` if the two disagree.

Frontend:

```bash
cd frontend
npm test
```

---

# Scripts reference

## Root

Run from the project root.

| Script          | Does                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `npm run setup` | Install dependencies, create environment files, migrate the database, and seed development data |
| `npm run dev`   | Start the backend and frontend together                                                         |

## Backend

Run from `backend/`.

| Script                   | Does                                                     |
| ------------------------ | -------------------------------------------------------- |
| `npm run dev`            | Start the API with automatic restart on file changes     |
| `npm start`              | Start the API without auto-restart                       |
| `npm test`               | Run the Vitest test suite against `DATABASE_URL`         |
| `npm run test:postgres`  | Run the suite against PostgreSQL                         |
| `npm run test:sqlite`    | Run the suite against SQLite                             |
| `npm run test:all`       | Run it against both, one after the other                 |
| `npm run db:deploy`      | Apply existing migrations                                |
| `npm run db:migrate`     | Author a new migration after a schema change             |
| `npm run db:generate`    | Regenerate the Prisma client                             |
| `npm run db:sync-sqlite` | Regenerate the SQLite schema from `prisma/schema.prisma` |
| `npm run seed`           | Seed badge definitions and the demo account/sample quiz  |
| `npm run lint`           | Check code style                                         |

## Frontend

Run from `frontend/`.

| Script            | Does                                         |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Start the Vite development server            |
| `npm run build`   | Create a production build in `frontend/dist` |
| `npm run preview` | Preview the production build locally         |
| `npm test`        | Run the frontend test suite                  |

---

# Manual setup without the setup script

`npm run setup` does all of this for you. These are the same steps by hand, for debugging or for a
deployment script.

## Backend

```bash
cd backend
npm install
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

Edit `backend/.env` — set `JWT_SECRET` and `DATABASE_URL` — then:

```bash
npm run db:generate
npm run db:deploy
npm run seed
npm run dev
```

The API is then at <http://localhost:4000>.

## Frontend

In a second terminal:

```bash
cd frontend
npm install
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
npm run dev
```

The app is then at <http://localhost:5173>.

---

# Project structure

```text
Quiz_app/
├── backend/        Express API, Prisma schema and migrations, seed script, tests
├── frontend/       React single-page app, built with Vite
├── scripts/        Setup and development helpers
└── package.json    Root scripts: setup and dev
```

---

# Stack

**Backend** — Node.js, Express, Prisma, PostgreSQL or SQLite (whichever `DATABASE_URL` names), JWT
authentication.

**Frontend** — React, Vite, React Router, Tailwind CSS, Recharts, CodeMirror.

---

# Quick summary

```bash
git clone <repository-url>
cd Quiz_app
npm run setup      # once; fill in backend/.env when it pauses
npm run dev        # every time after
```

Then open <http://localhost:5173> and sign in as `demo@example.com` / `demopass123`.
