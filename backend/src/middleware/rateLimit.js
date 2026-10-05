import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

// Keyed by authenticated user id, not IP -- coworkers behind the same office/VPN NAT
// shouldn't throttle each other. In-memory store: fine for a single-instance deployment;
// a multi-instance prod deployment would need a shared store (e.g. Redis) instead.
export const quizGenerateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.quizGenerateRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: { message: 'Quiz generation limit reached. Please try again later.' } },
});

// Test Connection makes a real outbound call to a URL the caller supplied, so it gets the tightest
// budget in the app: a short window and a low ceiling. That bounds both the cost of someone
// hammering it and its usefulness as a port/SSRF probe.
export const aiConfigTestRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: env.aiConfigTestRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: { message: 'Too many connection tests. Please wait a few minutes.' } },
});

// IP-keyed, unlike its siblings, because it necessarily runs before requireAuth. Without it,
// unlimited requests against a pure-JS bcrypt at cost 10 are both a credential-stuffing path and a
// CPU-exhaustion DoS on a small instance. Needs `trust proxy` to be meaningful behind a proxy --
// see app.js.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.authRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

export const explainMistakeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.explainRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: { message: 'Explanation request limit reached. Please try again later.' } },
});
