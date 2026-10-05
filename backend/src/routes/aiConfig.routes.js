import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { aiConfigTestRateLimit } from '../middleware/rateLimit.js';
import { get, put, remove, test } from '../controllers/aiConfig.controller.js';

const router = Router();

// GET never returns the API key -- only whether one is stored. That is the whole contract of this
// resource, and it is why PUT has to treat an omitted apiKey as "keep the one you have": the client
// is structurally incapable of sending back something it was never given.
router.get('/', requireAuth, get);
router.put('/', requireAuth, put);
router.delete('/', requireAuth, remove);

// Rate limited, unlike the three above: this is the only endpoint in the app that makes an outbound
// request to a URL the caller chose. Its own small budget, separate from quiz generation's, because
// exhausting one should not block the other.
router.post('/test', requireAuth, aiConfigTestRateLimit, test);

export default router;
