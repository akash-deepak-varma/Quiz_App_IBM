import { getLeaderboard } from '../services/leaderboardService.js';

export async function leaderboard(req, res, next) {
  try {
    const range = req.query.range === 'alltime' ? 'alltime' : 'week';
    res.json(await getLeaderboard(range));
  } catch (err) {
    next(err);
  }
}
