import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listLibrary, listTopics, favoriteQuiz, unfavoriteQuiz } from '../controllers/library.controller.js';

const router = Router();

// Mounted at /api/quiz, ahead of quiz.routes.js's `GET /:id` -- registration order determines
// which one Express matches, so this must stay mounted first or `/library` would be read as an id.
router.get('/library', requireAuth, listLibrary);
router.post('/:id/favorite', requireAuth, favoriteQuiz);
router.delete('/:id/favorite', requireAuth, unfavoriteQuiz);

export default router;

export const topicsRouter = Router();
topicsRouter.get('/', requireAuth, listTopics);
