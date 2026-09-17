import { getHardestQuestions, getReviewQueue } from '../services/analyticsService.js';

export async function hardestQuestions(req, res, next) {
  try {
    res.json({ questions: await getHardestQuestions(req.user.id) });
  } catch (err) {
    next(err);
  }
}

export async function reviewQueue(req, res, next) {
  try {
    res.json({ questions: await getReviewQueue(req.user.id) });
  } catch (err) {
    next(err);
  }
}
