import { getDashboardSummary, getDashboardHistory } from '../services/dashboardService.js';

export async function summary(req, res, next) {
  try {
    res.json(await getDashboardSummary(req.user.id));
  } catch (err) {
    next(err);
  }
}

export async function history(req, res, next) {
  try {
    res.json(await getDashboardHistory(req.user.id));
  } catch (err) {
    next(err);
  }
}
