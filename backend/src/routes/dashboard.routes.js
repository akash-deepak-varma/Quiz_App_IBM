import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { summary, history } from '../controllers/dashboard.controller.js';

const router = Router();

router.get('/summary', requireAuth, summary);
router.get('/history', requireAuth, history);

export default router;
