import request from 'supertest';
import { app } from '../../src/app.js';

/**
 * Create a user through the real signup endpoint and return its token.
 *
 * One copy, in one place. Five suites each kept their own byte-identical version of this, which
 * meant adding one required signup field was five separate edits -- the same lesson resetDb.js's
 * single DELETE_ORDER exists to record.
 *
 * `inviteCode` comes from test/setup/env.js, which sets SIGNUP_INVITE_CODE before config/env.js
 * reads it. Overrides are spread last so a test can deliberately send a wrong code or omit a field.
 */
export const TEST_INVITE_CODE = 'test-invite-code';

export async function signupUser(email, overrides = {}) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({
      name: 'Test User',
      email,
      password: 'supersecret',
      inviteCode: TEST_INVITE_CODE,
      ...overrides,
    });
  return res.body.token;
}
