import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { quizGenerateRateLimit } from '../middleware/rateLimit.js';
import {
  generate,
  getForRetake,
  submit,
  getEditableQuestion,
  updateQuestion,
  regenerateQuestion,
} from '../controllers/quiz.controller.js';

const router = Router();

router.post('/generate', requireAuth, quizGenerateRateLimit, generate);
router.get('/:id', requireAuth, getForRetake);
router.post('/:id/submit', requireAuth, submit);
router.get('/:quizId/questions/:questionId', requireAuth, getEditableQuestion);
router.patch('/:quizId/questions/:questionId', requireAuth, updateQuestion);
router.post('/:quizId/questions/:questionId/regenerate', requireAuth, regenerateQuestion);

export default router;
