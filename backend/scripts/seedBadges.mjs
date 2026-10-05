#!/usr/bin/env node
/**
 * Seeds ONLY the badge reference rows (and the default Org they need).
 *
 * This exists because badges are reference data that nothing in `src/` ever creates:
 * `badgeService.evaluateAndAwardBadges` does a `prisma.badge.findMany()` and awards whatever it
 * finds, so against a freshly migrated database it silently awards nothing and the Badges page is
 * permanently empty. No error, no log -- the feature just does not work.
 *
 * `npm run seed` would fix that, but it also creates demo@example.com with the password
 * `demopass123` hardcoded in prisma/seed.js, which must not exist on a public deployment. Hence
 * this narrower entry point. Run it once per database:
 *
 *   DATABASE_URL="<neon direct url>" node scripts/seedBadges.mjs
 *
 * Idempotent -- seedBadges skips badges that already exist -- so re-running it is harmless.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prismaClient.js';
import { seedOrg, seedBadges } from '../prisma/seed.js';

async function main() {
  await seedOrg();
  await seedBadges();

  const badgeCount = await prisma.badge.count();
  const userCount = await prisma.user.count();
  console.log(`Badges in database: ${badgeCount}`);
  console.log(`Users in database: ${userCount} (this script creates none)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
