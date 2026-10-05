import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const SALT_ROUNDS = 10;

// HS256 is what jwt.sign uses by default for a string secret. Naming it here and passing it to
// verify as an allowlist is what stops a token that declares a different algorithm from being
// considered at all.
const ALGORITHM = 'HS256';

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id }, env.jwtSecret, {
    algorithm: ALGORITHM,
    // Env-driven rather than hardcoded so a deployment can shorten it without a code change.
    // Do not go below 7d without a refresh flow: there is none, so a shorter window just logs
    // people out mid-quiz.
    expiresIn: env.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret, { algorithms: [ALGORITHM] });
}
