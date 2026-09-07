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
