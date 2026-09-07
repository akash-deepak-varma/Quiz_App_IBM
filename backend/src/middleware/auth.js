import { verifyToken } from '../services/authService.js';
import { UnauthorizedError } from '../lib/errors.js';
import { prisma } from '../lib/prismaClient.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedError('User no longer exists');
    }

    req.user = { id: user.id, name: user.name, email: user.email, orgId: user.orgId };
    next();
  } catch (err) {
    next(err);
  }
}
