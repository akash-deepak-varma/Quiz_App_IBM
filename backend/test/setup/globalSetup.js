import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const testDbPath = path.join(backendRoot, 'prisma', 'test.db');

export default function setup() {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
  execSync('npx prisma migrate deploy', {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  });
}
