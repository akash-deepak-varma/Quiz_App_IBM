import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import aiConfigRoutes from './routes/aiConfig.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import generationRoutes from './routes/generation.routes.js';
import libraryRoutes, { topicsRouter } from './routes/library.routes.js';
import attemptsRoutes from './routes/attempts.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import leaderboardRoutes from './routes/leaderboard.routes.js';
import badgesRoutes from './routes/badges.routes.js';

export const app = express();

// Render terminates TLS at its edge and forwards X-Forwarded-For. Without this, req.ip is the
// proxy's address -- so the IP-keyed auth limiter would treat every caller as one client -- and
// express-rate-limit v7 logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request. Off by default so
// the test suite and local dev are unaffected.
if (env.trustProxy) app.set('trust proxy', 1);

// Nothing here needs to advertise the framework.
app.disable('x-powered-by');

// `app.use(cors())` was right while the frontend was served from the same dev host. In production
// the SPA is a static site on a different origin, so an allowlist is what stops any other page in a
// friend's browser from scripting this API. (It cannot read their token -- that is in localStorage,
// same-origin -- but there is no reason to let it try.)
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all: curl, Render's health check, and every supertest request in the
      // suite. Allowed, because CORS is a browser mechanism and a request with no Origin did not
      // arrive through a browser's cross-origin path. Authentication is still required, as ever.
      if (!origin) return callback(null, true);
      // Denied by omitting the headers, not by throwing. A throw here becomes a 500 plus a logged
      // stack trace for what is simply a request the browser was about to block anyway.
      return callback(null, env.corsOrigins.includes(origin));
    },
    // Deliberately off: every authenticated call sends `Authorization: Bearer`, which is not a
    // credential in the CORS sense. Keeping this false means never having to pair an exact-origin
    // echo with cookie handling.
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// The one security header worth setting on a JSON API. The rest of helmet's useful output (CSP,
// frame options, referrer policy) protects the *static site* that serves HTML, where Render sets
// them with no code at all -- and HSTS already comes from Render's edge.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
// No route-ordering hazard: a distinct prefix, and /api/me was previously unused.
app.use('/api/me/ai-config', aiConfigRoutes);
app.use('/api/quiz', libraryRoutes);
// Before quizRoutes on purpose: that router owns `/:id`, which would otherwise swallow
// `/generations` and answer a job poll with "Quiz not found".
app.use('/api/quiz/generations', generationRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/topics', topicsRouter);
app.use('/api/attempts', attemptsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/badges', badgesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
