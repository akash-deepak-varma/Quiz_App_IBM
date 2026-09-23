import { app } from './app.js';
import { env } from './config/env.js';
import { startGenerationWorker, stopGenerationWorker } from './services/generation/worker.js';

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
