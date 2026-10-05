import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

/**
 * The API and the SPA are on different origins in production, so `app.use(cors())` with no options
 * is no longer good enough. These cases pin the three behaviours that matter.
 */
describe('CORS', () => {
  const allowed = env.corsOrigins[0];

  it('allows a request with no Origin header at all', async () => {
    // This is the branch that keeps every other suite working: supertest sends no Origin, and so do
    // curl and Render's health check. CORS is a browser mechanism, and a request without an Origin
    // did not arrive through a browser's cross-origin path.
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('echoes an allowlisted origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', allowed);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });

  it('omits the header for an origin that is not allowlisted', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    // Denied by *omitting* the header rather than by throwing: a throw would become a 500 with a
    // logged stack trace for a request the browser was about to block anyway. The body still comes
    // back over the wire; the browser is what refuses to hand it to the page.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight for an allowlisted origin', async () => {
    const res = await request(app)
      .options('/api/me/ai-config')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });

  it('does not enable credentialed CORS, since auth is a Bearer header', async () => {
    const res = await request(app).get('/api/health').set('Origin', allowed);
    // Leaving this off means never having to pair an exact-origin echo with cookie handling.
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not advertise the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
