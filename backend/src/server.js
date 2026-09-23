import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prismaClient.js';
import { applySqlitePragmas } from './lib/sqlitePragmas.js';
import { startGenerationWorker, stopGenerationWorker } from './services/generation/worker.js';

// Before anything serves a request or polls for a job: on SQLite this puts the database into WAL
// mode, without which a generation job's materialisation transaction blocks every read for its
// duration. A no-op on PostgreSQL. See lib/sqlitePragmas.js for what is deliberately not set.
await applySqlitePragmas(prisma, env.databaseProvider);

const server = app.listen(env.port, () => {
  console.log(`Quiz app backend listening on http://localhost:${env.port}`);
});

// Started here and not in app.js: the test suites import `app` directly, and a worker booted there
// would poll Postgres for the whole run.
startGenerationWorker();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // Stop claiming new jobs; anything mid-flight keeps its lease and is reclaimed on restart.
    stopGenerationWorker();
    server.close(() => process.exit(0));
  });
}
