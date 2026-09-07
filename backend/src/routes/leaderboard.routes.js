import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { leaderboard } from '../controllers/leaderboard.controller.js';

const router = Router();

router.get('/', requireAuth, leaderboard);

export default router;
