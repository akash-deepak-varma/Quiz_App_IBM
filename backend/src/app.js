import express from 'express';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import libraryRoutes, { topicsRouter } from './routes/library.routes.js';
import attemptsRoutes from './routes/attempts.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import leaderboardRoutes from './routes/leaderboard.routes.js';
import badgesRoutes from './routes/badges.routes.js';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/quiz', libraryRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/topics', topicsRouter);
app.use('/api/attempts', attemptsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/badges', badgesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
