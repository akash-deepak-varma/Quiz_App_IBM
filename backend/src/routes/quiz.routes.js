import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { quizGenerateRateLimit } from '../middleware/rateLimit.js';
import { generate, submit } from '../controllers/quiz.controller.js';

const router = Router();

router.post('/generate', requireAuth, quizGenerateRateLimit, generate);
router.post('/:id/submit', requireAuth, submit);

export default router;
