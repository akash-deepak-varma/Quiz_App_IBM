import { prisma } from '../lib/prismaClient.js';
import { hashPassword, verifyPassword, signToken } from '../services/authService.js';
import { BadRequestError, UnauthorizedError } from '../lib/errors.js';

function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, orgId: user.orgId };
}

export async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      throw new BadRequestError('name, email, and password are all required');
    }
    if (password.length < 8) {
      throw new BadRequestError('Password must be at least 8 characters');
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
