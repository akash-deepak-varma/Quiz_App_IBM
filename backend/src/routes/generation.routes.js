import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { quizGenerateRateLimit } from '../middleware/rateLimit.js';
import { create, getStatus, cancel } from '../controllers/generation.controller.js';

const router = Router();

// Same rate limit as the synchronous endpoint: what it protects is the provider bill, and that is
// unchanged by where the generation runs.
router.post('/', requireAuth, quizGenerateRateLimit, create);
// Polled every ~1.5s by the progress page, so deliberately not rate limited.
router.get('/:id', requireAuth, getStatus);
router.post('/:id/cancel', requireAuth, cancel);

export default router;
