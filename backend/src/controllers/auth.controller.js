import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prismaClient.js';
import { hashPassword, verifyPassword, signToken } from '../services/authService.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { env } from '../config/env.js';

/**
 * Constant-time comparison of the submitted invite code against the configured one.
 *
 * A shared prototype code barely warrants this -- an attacker who can time a bcrypt-bound signup
 * endpoint over the internet to byte resolution has easier options. But the two buffers have to be
 * length-checked before timingSafeEqual anyway (it throws on a length mismatch), so the
 * constant-time version costs one extra line over `===` and removes the question entirely.
 */
function inviteCodeMatches(submitted) {
  if (typeof submitted !== 'string') return false;
  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(env.signupInviteCode, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, orgId: user.orgId };
}

export async function signup(req, res, next) {
  try {
    const { name, email, password, inviteCode } = req.body || {};
    if (!name || !email || !password) {
      throw new BadRequestError('name, email, and password are all required');
    }
    if (password.length < 8) {
      throw new BadRequestError('Password must be at least 8 characters');
    }

    // Checked before the email lookup and before bcrypt, so an uninvited caller costs this server
    // one string comparison rather than a database round trip and a KDF.
    //
    // 403 rather than 400: the request is well-formed, the caller simply is not invited. The same
    // message for a missing and a wrong code -- the difference is no use to anyone who does not
    // already have it.
    if (!inviteCodeMatches(inviteCode)) {
      throw new ForbiddenError('That invite code is not valid.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new BadRequestError('An account with that email already exists');
    }

    let org = await prisma.org.findFirst();
    if (!org) {
      org = await prisma.org.create({ data: { name: 'Default Org' } });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name: name.trim(), email: normalizedEmail, passwordHash, orgId: org.id },
    });

    const token = signToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new BadRequestError('email and password are required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res) {
  res.json({ user: req.user });
}
