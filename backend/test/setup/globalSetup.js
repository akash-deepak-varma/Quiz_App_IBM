import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
import { testDatabaseUrl } from './testDatabaseUrl.js';

const backendRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

export default function setup() {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl(process.env.DATABASE_URL) };

  // Drop and recreate the "test" schema so every run starts from a clean slate -- the same
  // guarantee the old delete-the-sqlite-test.db-file approach gave us.
  execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', {
    cwd: backendRoot,
    env,
    input: 'DROP SCHEMA IF EXISTS "test" CASCADE;',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  execSync('npx prisma migrate deploy', {
    cwd: backendRoot,
    env,
    stdio: 'inherit',
  });
}
