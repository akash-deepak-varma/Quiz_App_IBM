import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { hardestQuestions, reviewQueue } from '../controllers/analytics.controller.js';

const router = Router();

router.get('/hardest-questions', requireAuth, hardestQuestions);
router.get('/review-queue', requireAuth, reviewQueue);

export default router;
