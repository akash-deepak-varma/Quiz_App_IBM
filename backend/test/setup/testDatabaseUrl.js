// Tests run against the same local Postgres database as dev, but isolated into their own
// "test" schema (namespace) via the `schema` connection param, so no second database is needed
// and DATABASE_URL only ever has to be set once (in .env) for both dev and test.
export function testDatabaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set -- copy .env.example to .env and fill it in before running tests.');
  }
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}schema=test`;
}
