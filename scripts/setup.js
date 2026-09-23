const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const root = path.resolve(__dirname, "..");

function run(command, cwd = root) {
    console.log(`\n> ${command}\n`);

    execSync(command, {
        cwd,
        stdio: "inherit",
        shell: true
    });
}

function copyEnv(folder) {
    const example = path.join(root, folder, ".env.example");
    const env = path.join(root, folder, ".env");

    if (!fs.existsSync(example)) {
        console.log(`No .env.example found in ${folder}`);
        return false;
    }

    if (fs.existsSync(env)) {
        console.log(`${folder}/.env already exists`);
        return false;
    }

    fs.copyFileSync(example, env);

    console.log(`Created ${folder}/.env`);

    return true;
}

function waitForEnter() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(
            "\nFill in backend/.env and frontend/.env, then press ENTER to continue...",
            () => {
                rl.close();
                resolve();
            }
        );
    });
}

async function setup() {
    console.log(`
=========================
   QuizzApp Setup
=========================
`);

    try {
        console.log("Installing root dependencies...");
        run("npm install");

        console.log("\nInstalling backend dependencies...");
        run("npm install", path.join(root, "backend"));

        console.log("\nInstalling frontend dependencies...");
        run("npm install", path.join(root, "frontend"));

        console.log("\nSetting up environment files...");

        const backendEnvCreated = copyEnv("backend");
        const frontendEnvCreated = copyEnv("frontend");

        if (backendEnvCreated || frontendEnvCreated) {
            console.log(`
Environment files were created.

Please add your API keys / database configuration:

    backend/.env
    frontend/.env
`);

            await waitForEnter();
        }

        console.log("\nGenerating the Prisma client for your database...");

        // Both of these read DATABASE_URL and pick the matching schema, so they work whether you
        // filled in a Postgres URL or a SQLite file path. The generate is not optional: npm install
        // already generated a client, but against the default (Postgres) schema, and Prisma ships a
        // separate query engine per provider -- a SQLite install needs this to reach its own database.
        run("npm run db:generate", path.join(root, "backend"));

        console.log("\nApplying database migrations...");

        // `migrate deploy`, not `migrate dev`: deploy applies the migrations that ship with the repo,
        // whereas dev wants to author new ones and needs a shadow database -- which on Postgres means
        // the CREATEDB privilege a fresh install has usually not been granted.
        run("npm run db:deploy", path.join(root, "backend"));

        console.log("\nSeeding database...");

        run(
            "npm run seed",
            path.join(root, "backend")
        );

        console.log(`
=========================
 Setup complete!
=========================

Start QuizzApp with:

    npm run dev
`);
    } catch (error) {
        // Print what actually broke. This used to say only "Setup failed.", which left the most
        // common failure -- a DATABASE_URL still holding the example <user>:<password> placeholders
        // -- looking like a bug in the installer rather than a value the reader still has to fill in.
        console.error(`\nSetup failed while running: ${error.cmd || "a setup step"}`);
        console.error(error.message);
        console.error(`
Common causes:

  - backend/.env still has the example DATABASE_URL, with <user>:<password> placeholders.
  - Using Postgres, but the server is not running or the database does not exist yet.
  - A password containing characters that need percent-encoding ("@" -> "%40").
`);
        process.exit(1);
    }
}

setup();