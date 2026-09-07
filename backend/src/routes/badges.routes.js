import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listBadges } from '../controllers/badges.controller.js';

const router = Router();

router.get('/', requireAuth, listBadges);

export default router;
