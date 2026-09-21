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

        console.log("\nRunning Prisma migrations...");

        run(
            "npx prisma migrate dev",
            path.join(root, "backend")
        );

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
        console.error("\nSetup failed.");
        process.exit(1);
    }
}

setup();