import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAttempt } from '../controllers/attempts.controller.js';

const router = Router();

router.get('/:id', requireAuth, getAttempt);

export default router;
