import { Router } from 'express';
import { signup, login, me } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Rate limited by IP: these two are the only unauthenticated endpoints that run bcrypt, which makes
// them the app's cheapest denial-of-service target as well as its credential-stuffing surface.
router.post('/signup', authRateLimit, signup);
router.post('/login', authRateLimit, login);
router.get('/me', requireAuth, me);

export default router;
