import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

export type UserRole = 'doctor' | 'nurse' | 'patient';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string;
  patient_id: number | null;
  doctor_id: number | null;
  nurse_id: number | null;
  must_change_password: boolean;
  is_active: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const configured = process.env.SMARTCARE_SECRET_KEY?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SECRET;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export function hashPassword(password: string): string {
  if (!password || password.length < 8) {
    throw new Error('Password must contain at least 8 characters.');
  }
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, expectedB64] = parts;
    const expected = Buffer.from(expectedB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createAccessToken(userId: number, role: UserRole): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: String(userId),
      role,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    })
  ).toString('base64url');
  const message = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(message).digest('base64url');
  return `${message}.${sig}`;
}

export function decodeAccessToken(token: string): { sub: string; role: UserRole; exp: number } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format.');
  }
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const message = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(message).digest();
  const actualSig = Buffer.from(encodedSig, 'base64url');
  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('Invalid token signature.');
  }
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported token algorithm.');
  }
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    throw new Error('Token has expired.');
  }
  if (!payload.sub || !['doctor', 'nurse', 'patient'].includes(payload.role)) {
    throw new Error('Invalid token claims.');
  }
  return payload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ detail: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  try {
    const claims = decodeAccessToken(token);
    const userId = Number(claims.sub);
    const row = db
      .prepare(
        `SELECT id, username, role, full_name, email, phone, patient_id, doctor_id, nurse_id,
                must_change_password, is_active
         FROM users WHERE id = ?`
      )
      .get(userId) as
      | {
          id: number;
          username: string;
          role: UserRole;
          full_name: string;
          email: string;
          phone: string;
          patient_id: number | null;
          doctor_id: number | null;
          nurse_id: number | null;
          must_change_password: number;
          is_active: number;
        }
      | undefined;

    if (!row || !row.is_active || row.role !== claims.role) {
      res.status(401).json({ detail: 'Invalid or inactive account session.' });
      return;
    }

    req.user = {
      ...row,
      must_change_password: Boolean(row.must_change_password),
      is_active: Boolean(row.is_active),
    };
    next();
  } catch (err) {
    res.status(401).json({ detail: err instanceof Error ? err.message : 'Invalid or expired token.' });
  }
}

export function requireRoles(...allowed: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required.' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({
        detail: `Access denied. Required role: ${allowed.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export function canUserAccessPatient(user: AuthUser, patientId: number): boolean {
  if (user.role === 'patient') {
    return user.patient_id !== null && user.patient_id === patientId;
  }

  if (user.role === 'nurse') {
    if (!user.nurse_id) return false;
    const assigned = db
      .prepare(
        `SELECT 1 FROM nurse_patient_assignments
         WHERE patient_id = ? AND nurse_id = ? AND is_active = 1 LIMIT 1`
      )
      .get(patientId, user.nurse_id);
    return Boolean(assigned);
  }

  if (user.role === 'doctor') {
    if (!user.doctor_id) return false;
    const patient = db
      .prepare(`SELECT doctor_id FROM patients WHERE id = ?`)
      .get(patientId) as { doctor_id: number } | undefined;
    if (!patient) return false;
    return patient.doctor_id === user.doctor_id;
  }

  return false;
}

export function ensurePatientExistsAndAccess(
  user: AuthUser,
  patientId: number,
  res: Response
): boolean {
  const exists = db.prepare(`SELECT id FROM patients WHERE id = ?`).get(patientId);
  if (!exists) {
    res.status(404).json({ detail: 'Patient record not found.' });
    return false;
  }
  if (!canUserAccessPatient(user, patientId)) {
    res.status(403).json({
      detail: 'Forbidden: you do not have permission to access this patient record.',
    });
    return false;
  }
  return true;
}

export function recordAuditLog(params: {
  user?: AuthUser | null;
  action: string;
  entityType: string;
  entityId?: string | number;
  details?: string;
  ipAddress?: string;
}): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (user_id, username, role, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.user?.id ?? null,
      params.user?.username ?? 'system',
      params.user?.role ?? 'system',
      params.action,
      params.entityType,
      String(params.entityId ?? ''),
      params.details ?? '',
      params.ipAddress ?? ''
    );
  } catch {
    // Never crash core workflow if audit log write fails
  }
}

export function isValidLanguage(lang: string): lang is 'English' | 'Tamil' | 'Malayalam' {
  return lang === 'English' || lang === 'Tamil' || lang === 'Malayalam';
}
