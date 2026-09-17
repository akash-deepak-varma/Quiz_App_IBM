import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAttempt, explainMistake } from '../controllers/attempts.controller.js';
import { explainMistakeRateLimit } from '../middleware/rateLimit.js';

const router = Router();

router.get('/:id', requireAuth, getAttempt);
router.post('/:id/questions/:questionId/explain', requireAuth, explainMistakeRateLimit, explainMistake);

export default router;
