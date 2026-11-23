import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { db, runInTransaction } from './db.ts';
import {
  buildTwimlForDelivery,
  confirmAlertAndStopRetries,
  dispatchVoiceDelivery,
  dispatchWhatsAppDelivery,
  escalateMissedVoiceReminder,
  generateMedicationSchedules,
  getProviderConfigStatus,
  processDueNotifications,
  WHATSAPP_MESSAGES,
  type SupportedLanguage,
} from './notifications.ts';
import {
  type AuthenticatedRequest,
  createAccessToken,
  ensurePatientExistsAndAccess,
  hashPassword,
  isValidLanguage,
  recordAuditLog,
  requireAuth,
  requireRoles,
  verifyPassword,
} from './security.ts';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function parseReadingNumbers(metric: string, value: string): { primary: number | null; secondary: number | null } {
  const cleaned = value.trim();
  const bpMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (bpMatch) {
    return { primary: Number(bpMatch[1]), secondary: Number(bpMatch[2]) };
  }
  const numMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    return { primary: Number(numMatch[1]), secondary: null };
  }
  return { primary: null, secondary: null };
}

function getAccessiblePatientIds(user: NonNullable<AuthenticatedRequest['user']>): number[] {
  if (user.role === 'patient') {
    return user.patient_id ? [user.patient_id] : [];
  }
  if (user.role === 'nurse') {
    if (!user.nurse_id) return [];
    const rows = db
      .prepare(
        `SELECT patient_id FROM nurse_patient_assignments
         WHERE nurse_id = ? AND is_active = 1`
      )
      .all(user.nurse_id) as Array<{ patient_id: number }>;
    return rows.map((r) => r.patient_id);
  }
  if (user.role === 'doctor') {
    if (!user.doctor_id) return [];
    const rows = db
      .prepare(`SELECT id FROM patients WHERE doctor_id = ?`)
      .all(user.doctor_id) as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }
  return [];
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

export function registerApiRoutes(app: express.Application): void {
  // ==========================================================
  // HEALTH CHECK & INITIAL SETUP STATUS
  // ==========================================================
  app.get('/api/health', (_req: Request, res: Response) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.json({
        status: 'ok',
        service: 'SmartCare API',
        database: 'connected',
        providers: getProviderConfigStatus(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({ status: 'error', database: 'disconnected' });
    }
  });

  app.get('/api/auth/status', (_req: Request, res: Response) => {
    const userCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number }).cnt;
    const doctorCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'doctor'`).get() as { cnt: number }
    ).cnt;
    const nurseCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'nurse'`).get() as { cnt: number }
    ).cnt;
    res.json({
      hasUsers: userCount > 0,
      hasDoctor: doctorCount > 0,
      hasNurse: nurseCount > 0,
    });
  });

  // ==========================================================
  // AUTHENTICATION & CLINICIAN REGISTRATION
  // ==========================================================
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const {
      username,
      password,
      role,
      full_name,
      phone = '',
      email = '',
      specialty = 'General Medicine',
      license_number = '',
      qualification = 'Registered Nurse',
    } = req.body ?? {};

    if (role === 'patient') {
      res.status(403).json({
        detail:
          'Patient self-registration is disabled. Patient accounts are automatically created when your Doctor registers you.',
      });
      return;
    }

    if (role !== 'doctor' && role !== 'nurse') {
      res.status(400).json({ detail: 'Role must be doctor or nurse.' });
      return;
    }

    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanName = String(full_name || '').trim();
    const cleanPassword = String(password || '');

    if (!cleanUsername || cleanUsername.length < 3 || !/^[a-z0-9._-]+$/.test(cleanUsername)) {
      res.status(400).json({
        detail: 'Username must be at least 3 characters (letters, numbers, ., _, -).',
      });
      return;
    }
    if (!cleanName) {
      res.status(400).json({ detail: 'Full name is required.' });
      return;
    }
    if (cleanPassword.length < 8) {
      res.status(400).json({ detail: 'Password must contain at least 8 characters.' });
      return;
    }

    const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(cleanUsername);
    if (existing) {
      res.status(409).json({ detail: 'Username is already registered.' });
      return;
    }

    try {
      const created = runInTransaction(() => {
        const passwordHash = hashPassword(cleanPassword);
        let doctorId: number | null = null;
        let nurseId: number | null = null;

        if (role === 'doctor') {
          const docRes = db
            .prepare(
              `INSERT INTO doctors (name, specialty, phone, license_number)
               VALUES (?, ?, ?, ?)`
            )
            .run(cleanName, String(specialty || 'General Medicine'), String(phone || ''), String(license_number || ''));
          doctorId = Number(docRes.lastInsertRowid);
        } else {
          const nurseRes = db
            .prepare(
              `INSERT INTO nurses (name, phone, qualification)
               VALUES (?, ?, ?)`
            )
            .run(cleanName, String(phone || ''), String(qualification || 'Registered Nurse'));
          nurseId = Number(nurseRes.lastInsertRowid);
        }

        const userRes = db
          .prepare(
            `INSERT INTO users (username, password_hash, role, full_name, email, phone, doctor_id, nurse_id, must_change_password, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`
          )
          .run(cleanUsername, passwordHash, role, cleanName, String(email || ''), String(phone || ''), doctorId, nurseId);

        const userId = Number(userRes.lastInsertRowid);
        return { userId, doctorId, nurseId };
      });

      const token = createAccessToken(created.userId, role);
      recordAuditLog({
        user: {
          id: created.userId,
          username: cleanUsername,
          role,
          full_name: cleanName,
          email: String(email || ''),
          phone: String(phone || ''),
          patient_id: null,
          doctor_id: created.doctorId,
          nurse_id: created.nurseId,
          must_change_password: false,
          is_active: true,
        },
        action: 'CLINICIAN_REGISTERED',
        entityType: 'user',
        entityId: created.userId,
        details: `Registered ${role} account (${cleanUsername})`,
        ipAddress: getClientIp(req),
      });

      res.status(201).json({
        access_token: token,
        token_type: 'bearer',
        user_id: created.userId,
        username: cleanUsername,
        full_name: cleanName,
        role,
        patient_id: null,
        doctor_id: created.doctorId,
        nurse_id: created.nurseId,
        must_change_password: false,
      });
    } catch (err) {
      res.status(500).json({ detail: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const cleanUsername = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!cleanUsername || !password) {
      res.status(400).json({ detail: 'Username and password are required.' });
      return;
    }

    const user = db
      .prepare(
        `SELECT id, username, password_hash, role, full_name, email, phone,
                patient_id, doctor_id, nurse_id, must_change_password, is_active
         FROM users WHERE username = ?`
      )
      .get(cleanUsername) as
      | {
          id: number;
          username: string;
          password_hash: string;
          role: 'doctor' | 'nurse' | 'patient';
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

    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ detail: 'Incorrect username or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ detail: 'This account has been deactivated.' });
      return;
    }

    const token = createAccessToken(user.id, user.role);
    recordAuditLog({
      user: {
        ...user,
        must_change_password: Boolean(user.must_change_password),
        is_active: Boolean(user.is_active),
      },
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      details: `Signed into ${user.role} portal`,
      ipAddress: getClientIp(req),
    });

    res.json({
      access_token: token,
      token_type: 'bearer',
      user_id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      patient_id: user.patient_id,
      doctor_id: user.doctor_id,
      nurse_id: user.nurse_id,
      must_change_password: Boolean(user.must_change_password),
    });
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const currentPassword = String(req.body?.current_password || '');
    const newPassword = String(req.body?.new_password || '');

    if (newPassword.length < 8) {
      res.status(400).json({ detail: 'New password must be at least 8 characters long.' });
      return;
    }

    const userRow = db
      .prepare(`SELECT id, password_hash FROM users WHERE id = ?`)
      .get(req.user!.id) as { id: number; password_hash: string } | undefined;

    if (!userRow || !verifyPassword(currentPassword, userRow.password_hash)) {
      res.status(401).json({ detail: 'Current password is incorrect.' });
      return;
    }

    const newHash = hashPassword(newPassword);
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`).run(
      newHash,
      req.user!.id
    );

    recordAuditLog({
      user: req.user,
      action: 'PASSWORD_CHANGED',
      entityType: 'user',
      entityId: req.user!.id,
      details: 'User updated account password.',
      ipAddress: getClientIp(req),
    });

    res.json({ message: 'Password updated successfully.', must_change_password: false });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json(req.user);
  });

  // ==========================================================
  // DASHBOARD SUMMARY (ROLE-SCOPED)
  // ==========================================================
  app.get('/api/summary', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const patientIds = getAccessiblePatientIds(user);

    if (patientIds.length === 0) {
      res.json({
        patients: 0,
        active_patients: 0,
        attention_required: 0,
        medications: 0,
        upcoming_appointments: 0,
        today_followups: 0,
        pending_visits: 0,
        overdue_followups: 0,
        missed_reminders: 0,
        open_alerts: 0,
        adherence: 0,
        readings: [],
        appointments: [],
        followups: [],
        alerts: [],
        providers: getProviderConfigStatus(),
      });
      return;
    }

    const placeholders = patientIds.map(() => '?').join(',');

    const patientRows = db
      .prepare(`SELECT id, status FROM patients WHERE id IN (${placeholders})`)
      .all(...patientIds) as Array<{ id: number; status: string }>;

    const medsCount = (
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM medications WHERE patient_id IN (${placeholders}) AND is_active = 1`)
        .get(...patientIds) as { cnt: number }
    ).cnt;

    const readings = db
      .prepare(
        `SELECT hr.*, p.name AS patient_name
         FROM health_readings hr
         JOIN patients p ON p.id = hr.patient_id
         WHERE hr.patient_id IN (${placeholders})
         ORDER BY hr.recorded_at DESC
         LIMIT 20`
      )
      .all(...patientIds);

    const appointments = db
      .prepare(
        `SELECT a.*, p.name AS patient_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.patient_id IN (${placeholders})
         ORDER BY a.appointment_date ASC`
      )
      .all(...patientIds) as Array<{ status: string }>;

    const followups =
      user.role === 'nurse' && user.nurse_id
        ? (db
            .prepare(
              `SELECT fv.*, p.name AS patient_name, p.patient_code, n.name AS nurse_name
               FROM follow_up_visits fv
               JOIN patients p ON p.id = fv.patient_id
               JOIN nurses n ON n.id = fv.nurse_id
               WHERE fv.patient_id IN (${placeholders}) AND fv.nurse_id = ?
               ORDER BY fv.scheduled_at ASC`
            )
            .all(...patientIds, user.nurse_id) as Array<{ status: string; scheduled_at: string }>)
        : (db
            .prepare(
              `SELECT fv.*, p.name AS patient_name, p.patient_code, n.name AS nurse_name
               FROM follow_up_visits fv
               JOIN patients p ON p.id = fv.patient_id
               JOIN nurses n ON n.id = fv.nurse_id
               WHERE fv.patient_id IN (${placeholders})
               ORDER BY fv.scheduled_at ASC`
            )
            .all(...patientIds) as Array<{ status: string; scheduled_at: string }>);

    const alerts = db
      .prepare(
        `SELECT a.*, p.name AS patient_name
         FROM alerts a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.patient_id IN (${placeholders})
         ORDER BY a.created_at DESC
         LIMIT 25`
      )
      .all(...patientIds) as Array<{ status: string; alert_type: string }>;

    const logs = db
      .prepare(
        `SELECT action_type, status FROM medication_logs WHERE patient_id IN (${placeholders})`
      )
      .all(...patientIds) as Array<{ action_type: string; status: string }>;

    const schedStats = db
      .prepare(
        `SELECT status, COUNT(*) AS cnt
         FROM medication_schedules
         WHERE patient_id IN (${placeholders})
         GROUP BY status`
      )
      .all(...patientIds) as Array<{ status: string; cnt: number }>;

    const schedMap = Object.fromEntries(schedStats.map((s) => [s.status, s.cnt]));
    const takenLogs = logs.filter((l) => l.action_type === 'verified_intake' || l.status.startsWith('Taken')).length;
    const ackLogs = logs.filter((l) => l.action_type === 'acknowledgement').length;
    const totalTrackable = (schedMap['Taken'] || 0) + (schedMap['Acknowledged'] || 0) + (schedMap['Missed'] || 0);
    const adherence =
      totalTrackable > 0
        ? Math.round((100 * ((schedMap['Taken'] || 0) + (schedMap['Acknowledged'] || 0))) / totalTrackable)
        : logs.length > 0
        ? Math.round((100 * (takenLogs + ackLogs)) / logs.length)
        : 0;

    const todayStr = new Date().toISOString().slice(0, 10);

    res.json({
      patients: patientRows.length,
      active_patients: patientRows.filter((p) => p.status !== 'Discharged').length,
      attention_required: patientRows.filter((p) => p.status === 'Attention Required').length,
      medications: medsCount,
      upcoming_appointments: appointments.filter((a) => a.status === 'Scheduled').length,
      today_followups: followups.filter((f) => f.scheduled_at.slice(0, 10) === todayStr && f.status !== 'Completed').length,
      pending_visits: followups.filter((f) => f.status === 'Pending').length,
      overdue_followups: followups.filter((f) => f.status === 'Overdue' || f.status === 'Missed').length,
      missed_reminders: schedMap['Missed'] || 0,
      open_alerts: alerts.filter((a) => a.status === 'Open').length,
      adherence,
      readings,
      appointments,
      followups,
      alerts,
      providers: getProviderConfigStatus(),
    });
  });

  // ==========================================================
  // NURSES DIRECTORY (DOCTOR ONLY)
  // ==========================================================
  app.get('/api/nurses', requireAuth, requireRoles('doctor'), (_req: AuthenticatedRequest, res: Response) => {
    const nurses = db
      .prepare(
        `SELECT n.*, u.username, u.is_active,
                (SELECT COUNT(*) FROM nurse_patient_assignments npa WHERE npa.nurse_id = n.id AND npa.is_active = 1) AS assigned_count
         FROM nurses n
         JOIN users u ON u.nurse_id = n.id
         WHERE u.is_active = 1
         ORDER BY n.name ASC`
      )
      .all();
    res.json(nurses);
  });

  // ==========================================================
  // PATIENTS & AUTOMATIC PATIENT ACCOUNT CREATION
  // ==========================================================
  app.get('/api/patients', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientIds = getAccessiblePatientIds(req.user!);
    if (patientIds.length === 0) {
      res.json([]);
      return;
    }

    const placeholders = patientIds.map(() => '?').join(',');
    const patients = db
      .prepare(
        `SELECT p.*,
                d.name AS doctor_name, d.specialty AS doctor_specialty, d.phone AS doctor_phone,
                dr.diagnosis, dr.discharge_summary, dr.discharge_instructions, dr.dietary_guidelines, dr.warning_signs,
                (SELECT GROUP_CONCAT(n.name, ', ')
                 FROM nurse_patient_assignments npa
                 JOIN nurses n ON n.id = npa.nurse_id
                 WHERE npa.patient_id = p.id AND npa.is_active = 1) AS assigned_nurses,
                (SELECT COUNT(*) FROM alerts a WHERE a.patient_id = p.id AND a.status = 'Open') AS open_alerts_count
         FROM patients p
         JOIN doctors d ON d.id = p.doctor_id
         LEFT JOIN patient_discharge_records dr ON dr.patient_id = p.id
         WHERE p.id IN (${placeholders})
         ORDER BY p.created_at DESC`
      )
      .all(...patientIds);

    res.json(patients);
  });

  app.post('/api/patients', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const {
      name,
      age = null,
      gender = 'Not specified',
      phone,
      language = 'English',
      emergency_contact_name = '',
      emergency_contact_phone = '',
      emergency_contact_relation = 'Family',
      discharge_date = new Date().toISOString().slice(0, 10),
      monitoring_frequency = 'daily',
      monitoring_requirements = [],
      opt_in_whatsapp = true,
      opt_in_voice = true,
      diagnosis = '',
      discharge_summary = '',
      discharge_instructions = '',
      dietary_guidelines = '',
      warning_signs = '',
      nurse_id = null,
      nurse_instructions = '',
    } = req.body ?? {};

    const cleanName = String(name || '').trim();
    const cleanPhone = String(phone || '').trim();
    if (!cleanName) {
      res.status(400).json({ detail: 'Patient full name is required.' });
      return;
    }
    if (!cleanPhone) {
      res.status(400).json({ detail: 'Patient phone number is required for medication reminders.' });
      return;
    }
    if (!isValidLanguage(String(language))) {
      res.status(400).json({ detail: 'Preferred language must be English, Tamil, or Malayalam.' });
      return;
    }
    if (!['daily', 'weekly', 'fortnightly', 'as_needed'].includes(String(monitoring_frequency))) {
      res.status(400).json({ detail: 'Invalid monitoring frequency.' });
      return;
    }
    if (!req.user!.doctor_id) {
      res.status(403).json({ detail: 'Doctor profile is required to register patients.' });
      return;
    }

    const reqArray = Array.isArray(monitoring_requirements)
      ? monitoring_requirements.map((item) => String(item))
      : [];

    try {
      const created = runInTransaction(() => {
        const tempCode = `TMP-${crypto.randomBytes(6).toString('hex')}`;
        const pRes = db
          .prepare(
            `INSERT INTO patients (
              patient_code, doctor_id, name, age, gender, phone, language,
              emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
              discharge_date, monitoring_frequency, monitoring_requirements,
              opt_in_whatsapp, opt_in_voice, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Monitoring')`
          )
          .run(
            tempCode,
            req.user!.doctor_id,
            cleanName,
            age !== null && age !== '' ? Number(age) : null,
            String(gender || 'Not specified'),
            cleanPhone,
            language,
            String(emergency_contact_name || ''),
            String(emergency_contact_phone || ''),
            String(emergency_contact_relation || 'Family'),
            discharge_date ? String(discharge_date) : null,
            String(monitoring_frequency),
            JSON.stringify(reqArray),
            opt_in_whatsapp ? 1 : 0,
            opt_in_voice ? 1 : 0
          );

        const patientId = Number(pRes.lastInsertRowid);
        const year = new Date().getFullYear();
        const patientCode = `SC-${year}-${String(patientId).padStart(4, '0')}`;
        db.prepare(`UPDATE patients SET patient_code = ? WHERE id = ?`).run(patientCode, patientId);

        db.prepare(
          `INSERT INTO patient_discharge_records
            (patient_id, doctor_id, diagnosis, discharge_summary, discharge_instructions, dietary_guidelines, warning_signs, discharge_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          patientId,
          req.user!.doctor_id,
          String(diagnosis || ''),
          String(discharge_summary || ''),
          String(discharge_instructions || ''),
          String(dietary_guidelines || ''),
          String(warning_signs || ''),
          discharge_date ? String(discharge_date) : null
        );

        // Generate unique Patient login account automatically
        const baseUsername = `sc-pat-${String(patientId).padStart(3, '0')}`;
        let username = baseUsername;
        let suffix = 1;
        while (db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)) {
          username = `${baseUsername}-${suffix}`;
          suffix += 1;
        }

        const temporaryPassword = crypto.randomBytes(9).toString('base64url'); // 12 chars URL-safe
        const passwordHash = hashPassword(temporaryPassword);

        db.prepare(
          `INSERT INTO users
            (username, password_hash, role, full_name, phone, patient_id, must_change_password, is_active)
           VALUES (?, ?, 'patient', ?, ?, ?, 1, 1)`
        ).run(username, passwordHash, cleanName, cleanPhone, patientId);

        // Optional initial Nurse assignment
        if (nurse_id) {
          const nurseExists = db.prepare(`SELECT id, name FROM nurses WHERE id = ?`).get(Number(nurse_id)) as
            | { id: number; name: string }
            | undefined;
          if (!nurseExists) {
            throw new Error('Selected nurse does not exist.');
          }
          db.prepare(
            `INSERT INTO nurse_patient_assignments
              (patient_id, nurse_id, assigned_by_doctor_id, monitoring_frequency, instructions, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`
          ).run(
            patientId,
            nurseExists.id,
            req.user!.doctor_id,
            String(monitoring_frequency),
            String(nurse_instructions || '')
          );

          // Schedule initial follow-up visit for tomorrow morning
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T10:00:00';
          db.prepare(
            `INSERT INTO follow_up_visits (patient_id, nurse_id, scheduled_at, status, visit_notes)
             VALUES (?, ?, ?, 'Pending', ?)`
          ).run(patientId, nurseExists.id, tomorrow, String(nurse_instructions || 'Initial post-discharge home/tele check-in'));
        }

        const patientRow = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(patientId);
        return {
          patient: patientRow,
          patientCode,
          username,
          temporaryPassword,
        };
      });

      recordAuditLog({
        user: req.user,
        action: 'PATIENT_AND_ACCOUNT_CREATED',
        entityType: 'patient',
        entityId: (created.patient as { id: number }).id,
        details: `Created patient ${created.patientCode} with auto-generated login ${created.username}`,
        ipAddress: getClientIp(req),
      });

      res.status(201).json({
        ...(created.patient as Record<string, unknown>),
        login_credentials: {
          patient_id: (created.patient as { id: number }).id,
          patient_code: created.patientCode,
          username: created.username,
          temporary_password: created.temporaryPassword,
          note: 'Shown once only. Patient must change this temporary password on first sign-in.',
        },
      });
    } catch (err) {
      res.status(400).json({ detail: err instanceof Error ? err.message : 'Failed to create patient.' });
    }
  });

  app.get('/api/patients/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.params.id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const patient = db
      .prepare(
        `SELECT p.*,
                d.name AS doctor_name, d.specialty AS doctor_specialty, d.phone AS doctor_phone, d.hospital AS doctor_hospital,
                dr.diagnosis, dr.discharge_summary, dr.discharge_instructions, dr.dietary_guidelines, dr.warning_signs
         FROM patients p
         JOIN doctors d ON d.id = p.doctor_id
         LEFT JOIN patient_discharge_records dr ON dr.patient_id = p.id
         WHERE p.id = ?`
      )
      .get(patientId);

    const assignedNurses = db
      .prepare(
        `SELECT n.id, n.name, n.phone, n.qualification, n.shift_area,
                npa.monitoring_frequency, npa.instructions, npa.assigned_at
         FROM nurse_patient_assignments npa
         JOIN nurses n ON n.id = npa.nurse_id
         WHERE npa.patient_id = ? AND npa.is_active = 1`
      )
      .all(patientId);

    const accountMeta = db
      .prepare(`SELECT username, must_change_password, is_active, created_at FROM users WHERE patient_id = ?`)
      .get(patientId);

    res.json({
      ...(patient as Record<string, unknown>),
      assigned_nurses: assignedNurses,
      account: accountMeta || null,
    });
  });

  app.patch('/api/patients/:id', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.params.id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const {
      status,
      phone,
      monitoring_frequency,
      monitoring_requirements,
      language,
      opt_in_whatsapp,
      opt_in_voice,
      diagnosis,
      discharge_summary,
      discharge_instructions,
      dietary_guidelines,
      warning_signs,
    } = req.body ?? {};

    if (language && !isValidLanguage(String(language))) {
      res.status(400).json({ detail: 'Invalid language.' });
      return;
    }

    runInTransaction(() => {
      if (phone !== undefined && String(phone).trim()) {
        const cleanPhone = String(phone).trim();
        db.prepare(`UPDATE patients SET phone = ? WHERE id = ?`).run(cleanPhone, patientId);
        db.prepare(`UPDATE users SET phone = ? WHERE patient_id = ?`).run(cleanPhone, patientId);
      }
      if (status && ['Monitoring', 'Attention Required', 'Stable', 'Discharged'].includes(String(status))) {
        db.prepare(`UPDATE patients SET status = ? WHERE id = ?`).run(String(status), patientId);
      }
      if (monitoring_frequency && ['daily', 'weekly', 'fortnightly', 'as_needed'].includes(String(monitoring_frequency))) {
        db.prepare(`UPDATE patients SET monitoring_frequency = ? WHERE id = ?`).run(
          String(monitoring_frequency),
          patientId
        );
      }
      if (Array.isArray(monitoring_requirements)) {
        db.prepare(`UPDATE patients SET monitoring_requirements = ? WHERE id = ?`).run(
          JSON.stringify(monitoring_requirements.map(String)),
          patientId
        );
      }
      if (language) {
        db.prepare(`UPDATE patients SET language = ? WHERE id = ?`).run(String(language), patientId);
      }
      if (typeof opt_in_whatsapp === 'boolean') {
        db.prepare(`UPDATE patients SET opt_in_whatsapp = ? WHERE id = ?`).run(opt_in_whatsapp ? 1 : 0, patientId);
      }
      if (typeof opt_in_voice === 'boolean') {
        db.prepare(`UPDATE patients SET opt_in_voice = ? WHERE id = ?`).run(opt_in_voice ? 1 : 0, patientId);
      }

      if (
        diagnosis !== undefined ||
        discharge_summary !== undefined ||
        discharge_instructions !== undefined ||
        dietary_guidelines !== undefined ||
        warning_signs !== undefined
      ) {
        db.prepare(
          `UPDATE patient_discharge_records
           SET diagnosis = COALESCE(?, diagnosis),
               discharge_summary = COALESCE(?, discharge_summary),
               discharge_instructions = COALESCE(?, discharge_instructions),
               dietary_guidelines = COALESCE(?, dietary_guidelines),
               warning_signs = COALESCE(?, warning_signs),
               updated_at = datetime('now')
           WHERE patient_id = ?`
        ).run(
          diagnosis ?? null,
          discharge_summary ?? null,
          discharge_instructions ?? null,
          dietary_guidelines ?? null,
          warning_signs ?? null,
          patientId
        );
      }
    });

    recordAuditLog({
      user: req.user,
      action: 'PATIENT_CARE_PLAN_UPDATED',
      entityType: 'patient',
      entityId: patientId,
      details: 'Doctor updated patient discharge/monitoring plan.',
      ipAddress: getClientIp(req),
    });

    res.json({ message: 'Patient care plan updated.' });
  });

  app.post(
    '/api/patients/:id/reset-password',
    requireAuth,
    requireRoles('doctor'),
    (req: AuthenticatedRequest, res: Response) => {
      const patientId = Number(req.params.id);
      if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

      const patient = db
        .prepare(`SELECT id, patient_code FROM patients WHERE id = ?`)
        .get(patientId) as { id: number; patient_code: string };

      const userRow = db
        .prepare(`SELECT id, username FROM users WHERE patient_id = ? AND role = 'patient'`)
        .get(patientId) as { id: number; username: string } | undefined;

      if (!userRow) {
        res.status(404).json({ detail: 'Linked patient login account not found.' });
        return;
      }

      const temporaryPassword = crypto.randomBytes(9).toString('base64url');
      const passwordHash = hashPassword(temporaryPassword);

      db.prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`
      ).run(passwordHash, userRow.id);

      recordAuditLog({
        user: req.user,
        action: 'PATIENT_PASSWORD_RESET',
        entityType: 'patient',
        entityId: patientId,
        details: `Doctor issued new one-time temporary password for ${userRow.username}`,
        ipAddress: getClientIp(req),
      });

      res.json({
        patient_id: patient.id,
        patient_code: patient.patient_code,
        username: userRow.username,
        temporary_password: temporaryPassword,
        note: 'New one-time temporary password generated. Patient must change it after signing in.',
      });
    }
  );

  // ==========================================================
  // NURSE ASSIGNMENT & FOLLOW-UP VISITS
  // ==========================================================
  app.post(
    '/api/patients/:id/assign-nurse',
    requireAuth,
    requireRoles('doctor'),
    (req: AuthenticatedRequest, res: Response) => {
      const patientId = Number(req.params.id);
      if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

      const nurseId = Number(req.body?.nurse_id);
      const monitoringFrequency = String(req.body?.monitoring_frequency || 'daily');
      const instructions = String(req.body?.instructions || '');
      const scheduleDate = req.body?.first_visit_at ? String(req.body.first_visit_at) : null;

      if (!nurseId) {
        res.status(400).json({ detail: 'nurse_id is required.' });
        return;
      }
      const nurse = db.prepare(`SELECT id, name FROM nurses WHERE id = ?`).get(nurseId) as
        | { id: number; name: string }
        | undefined;
      if (!nurse) {
        res.status(404).json({ detail: 'Nurse not found.' });
        return;
      }

      runInTransaction(() => {
        db.prepare(
          `INSERT INTO nurse_patient_assignments
            (patient_id, nurse_id, assigned_by_doctor_id, monitoring_frequency, instructions, is_active)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(patient_id, nurse_id)
           DO UPDATE SET is_active = 1, monitoring_frequency = excluded.monitoring_frequency, instructions = excluded.instructions, assigned_at = datetime('now')`
        ).run(patientId, nurseId, req.user!.doctor_id, monitoringFrequency, instructions);

        if (scheduleDate) {
          db.prepare(
            `INSERT INTO follow_up_visits (patient_id, nurse_id, scheduled_at, status, visit_notes)
             VALUES (?, ?, ?, 'Pending', ?)`
          ).run(patientId, nurseId, scheduleDate, instructions || 'Scheduled nurse follow-up');
        }
      });

      recordAuditLog({
        user: req.user,
        action: 'NURSE_ASSIGNED',
        entityType: 'nurse_assignment',
        entityId: `${patientId}:${nurseId}`,
        details: `Assigned nurse ${nurse.name} (#${nurseId}) to patient #${patientId}`,
        ipAddress: getClientIp(req),
      });

      res.status(201).json({ message: `Nurse ${nurse.name} assigned successfully.` });
    }
  );

  app.delete(
    '/api/patients/:id/nurses/:nurseId',
    requireAuth,
    requireRoles('doctor'),
    (req: AuthenticatedRequest, res: Response) => {
      const patientId = Number(req.params.id);
      const nurseId = Number(req.params.nurseId);
      if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

      db.prepare(
        `UPDATE nurse_patient_assignments SET is_active = 0 WHERE patient_id = ? AND nurse_id = ?`
      ).run(patientId, nurseId);

      recordAuditLog({
        user: req.user,
        action: 'NURSE_UNASSIGNED',
        entityType: 'nurse_assignment',
        entityId: `${patientId}:${nurseId}`,
        details: `Unassigned nurse #${nurseId} from patient #${patientId}`,
        ipAddress: getClientIp(req),
      });

      res.json({ message: 'Nurse assignment removed.' });
    }
  );

  app.get('/api/follow-ups', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const patientIds = getAccessiblePatientIds(user);
    if (patientIds.length === 0) {
      res.json([]);
      return;
    }
    const placeholders = patientIds.map(() => '?').join(',');
    const rows =
      user.role === 'nurse' && user.nurse_id
        ? db
            .prepare(
              `SELECT fv.*, p.name AS patient_name, p.patient_code, n.name AS nurse_name
               FROM follow_up_visits fv
               JOIN patients p ON p.id = fv.patient_id
               JOIN nurses n ON n.id = fv.nurse_id
               WHERE fv.patient_id IN (${placeholders}) AND fv.nurse_id = ?
               ORDER BY fv.scheduled_at ASC`
            )
            .all(...patientIds, user.nurse_id)
        : db
            .prepare(
              `SELECT fv.*, p.name AS patient_name, p.patient_code, n.name AS nurse_name
               FROM follow_up_visits fv
               JOIN patients p ON p.id = fv.patient_id
               JOIN nurses n ON n.id = fv.nurse_id
               WHERE fv.patient_id IN (${placeholders})
               ORDER BY fv.scheduled_at ASC`
            )
            .all(...patientIds);
    res.json(rows);
  });

  app.post('/api/follow-ups', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.body?.patient_id);
    const nurseId = Number(req.body?.nurse_id);
    const scheduledAt = String(req.body?.scheduled_at || '').trim();
    const visitNotes = String(req.body?.visit_notes || '');

    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;
    if (!nurseId || !scheduledAt) {
      res.status(400).json({ detail: 'nurse_id and scheduled_at are required.' });
      return;
    }

    const assignment = db
      .prepare(
        `SELECT 1 FROM nurse_patient_assignments WHERE patient_id = ? AND nurse_id = ? AND is_active = 1`
      )
      .get(patientId, nurseId);
    if (!assignment) {
      res.status(400).json({ detail: 'Selected nurse must be assigned to this patient first.' });
      return;
    }

    const r = db
      .prepare(
        `INSERT INTO follow_up_visits (patient_id, nurse_id, scheduled_at, status, visit_notes)
         VALUES (?, ?, ?, 'Pending', ?)`
      )
      .run(patientId, nurseId, scheduledAt, visitNotes);

    res.status(201).json(db.prepare(`SELECT * FROM follow_up_visits WHERE id = ?`).get(Number(r.lastInsertRowid)));
  });

  app.patch(
    '/api/follow-ups/:id',
    requireAuth,
    requireRoles('doctor', 'nurse'),
    (req: AuthenticatedRequest, res: Response) => {
      const visitId = Number(req.params.id);
      const visit = db
        .prepare(`SELECT * FROM follow_up_visits WHERE id = ?`)
        .get(visitId) as
        | { id: number; patient_id: number; nurse_id: number; status: string }
        | undefined;

      if (!visit) {
        res.status(404).json({ detail: 'Follow-up visit not found.' });
        return;
      }
      if (!ensurePatientExistsAndAccess(req.user!, visit.patient_id, res)) return;
      if (req.user!.role === 'nurse' && req.user!.nurse_id !== visit.nurse_id) {
        res.status(403).json({ detail: 'You can update only your own assigned follow-up visits.' });
        return;
      }

      const { status, visit_notes, flagged_for_doctor = false, flag_reason = '' } = req.body ?? {};
      if (status && !['Pending', 'Completed', 'Missed', 'Overdue'].includes(String(status))) {
        res.status(400).json({ detail: 'Invalid visit status.' });
        return;
      }

      const nowIso = new Date().toISOString();
      runInTransaction(() => {
        db.prepare(
          `UPDATE follow_up_visits
           SET status = COALESCE(?, status),
               visit_notes = COALESCE(?, visit_notes),
               flagged_for_doctor = ?,
               flag_reason = ?,
               completed_at = CASE WHEN ? = 'Completed' THEN COALESCE(completed_at, ?) ELSE completed_at END
           WHERE id = ?`
        ).run(
          status ?? null,
          visit_notes ?? null,
          flagged_for_doctor ? 1 : 0,
          String(flag_reason || ''),
          status ?? '',
          nowIso,
          visitId
        );

        if (flagged_for_doctor || status === 'Missed') {
          const patient = db.prepare(`SELECT name FROM patients WHERE id = ?`).get(visit.patient_id) as { name: string };
          db.prepare(
            `INSERT INTO alerts
              (patient_id, title, message, alert_type, severity, status, scheduled_at, created_by)
             VALUES (?, ?, ?, ?, ?, 'Open', ?, ?)`
          ).run(
            visit.patient_id,
            status === 'Missed'
              ? `Missed follow-up visit: ${patient.name}`
              : `Nurse observation flagged: ${patient.name}`,
            String(flag_reason || visit_notes || 'Follow-up requires doctor review.'),
            status === 'Missed' ? 'Missed Follow-up' : 'Clinical Flag',
            flagged_for_doctor ? 'high' : 'medium',
            nowIso,
            req.user!.full_name || req.user!.username
          );
          db.prepare(`UPDATE patients SET status = 'Attention Required' WHERE id = ?`).run(visit.patient_id);
        }
      });

      recordAuditLog({
        user: req.user,
        action: 'FOLLOWUP_UPDATED',
        entityType: 'follow_up_visit',
        entityId: visitId,
        details: `Status=${status || visit.status}, Flagged=${Boolean(flagged_for_doctor)}`,
        ipAddress: getClientIp(req),
      });

      res.json(db.prepare(`SELECT * FROM follow_up_visits WHERE id = ?`).get(visitId));
    }
  );

  // ==========================================================
  // MEDICATIONS, SCHEDULES & LOGS
  // ==========================================================
  app.get('/api/patients/:id/medications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.params.id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const meds = db
      .prepare(
        `SELECT m.*, d.name AS doctor_name
         FROM medications m
         JOIN doctors d ON d.id = m.doctor_id
         WHERE m.patient_id = ?
         ORDER BY m.is_active DESC, m.created_at DESC`
      )
      .all(patientId);

    const schedules = db
      .prepare(
        `SELECT ms.*, m.name AS medication_name, m.dosage
         FROM medication_schedules ms
         JOIN medications m ON m.id = ms.medication_id
         WHERE ms.patient_id = ?
         ORDER BY ms.scheduled_at ASC
         LIMIT 100`
      )
      .all(patientId);

    const logs = db
      .prepare(
        `SELECT ml.*, m.name AS medication_name
         FROM medication_logs ml
         JOIN medications m ON m.id = ml.medication_id
         WHERE ml.patient_id = ?
         ORDER BY ml.recorded_at DESC
         LIMIT 50`
      )
      .all(patientId);

    res.json({ medications: meds, schedules, logs });
  });

  app.post('/api/medications', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const {
      patient_id,
      name,
      dosage,
      frequency = 'Twice daily',
      timings = ['08:00', '20:00'],
      start_date = new Date().toISOString().slice(0, 10),
      end_date,
      instructions = '',
      verified_by_clinician = true,
    } = req.body ?? {};

    const patientId = Number(patient_id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const cleanName = String(name || '').trim();
    const cleanDosage = String(dosage || '').trim();
    if (!cleanName || !cleanDosage) {
      res.status(400).json({ detail: 'Medication name and dosage are required.' });
      return;
    }

    const cleanTimings = Array.isArray(timings)
      ? timings.map((t) => String(t).trim()).filter((t) => /^\d{2}:\d{2}$/.test(t))
      : String(timings || '')
          .split(',')
          .map((t) => t.trim())
          .filter((t) => /^\d{2}:\d{2}$/.test(t));

    if (cleanTimings.length === 0) {
      res.status(400).json({ detail: 'At least one valid 24-hour timing (HH:MM, e.g. 08:00, 20:00) is required.' });
      return;
    }

    const startStr = String(start_date).slice(0, 10);
    const defaultEnd = new Date(new Date(`${startStr}T00:00:00Z`).getTime() + 6 * 86400000)
      .toISOString()
      .slice(0, 10);
    const endStr = end_date ? String(end_date).slice(0, 10) : defaultEnd;

    const result = runInTransaction(() => {
      const mRes = db
        .prepare(
          `INSERT INTO medications
            (patient_id, doctor_id, name, dosage, frequency, timings, start_date, end_date, instructions, verified_by_clinician, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          patientId,
          req.user!.doctor_id,
          cleanName,
          cleanDosage,
          String(frequency),
          JSON.stringify(cleanTimings),
          startStr,
          endStr,
          String(instructions || ''),
          verified_by_clinician ? 1 : 0
        );

      const medicationId = Number(mRes.lastInsertRowid);
      const schedulesCreated = generateMedicationSchedules({
        medicationId,
        patientId,
        startDate: startStr,
        endDate: endStr,
        timings: cleanTimings,
      });

      return {
        medication: db.prepare(`SELECT * FROM medications WHERE id = ?`).get(medicationId),
        schedulesCreated,
      };
    });

    recordAuditLog({
      user: req.user,
      action: 'MEDICATION_PRESCRIBED',
      entityType: 'medication',
      entityId: (result.medication as { id: number }).id,
      details: `Prescribed ${cleanName} (${cleanDosage}) for patient #${patientId}; generated ${result.schedulesCreated} schedule slots.`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json(result);
  });

  app.patch('/api/medications/:id', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const medId = Number(req.params.id);
    const med = db.prepare(`SELECT * FROM medications WHERE id = ?`).get(medId) as
      | { id: number; patient_id: number }
      | undefined;
    if (!med) {
      res.status(404).json({ detail: 'Medication not found.' });
      return;
    }
    if (!ensurePatientExistsAndAccess(req.user!, med.patient_id, res)) return;

    const { is_active, verified_by_clinician, instructions } = req.body ?? {};
    db.prepare(
      `UPDATE medications
       SET is_active = COALESCE(?, is_active),
           verified_by_clinician = COALESCE(?, verified_by_clinician),
           instructions = COALESCE(?, instructions)
       WHERE id = ?`
    ).run(
      typeof is_active === 'boolean' ? (is_active ? 1 : 0) : null,
      typeof verified_by_clinician === 'boolean' ? (verified_by_clinician ? 1 : 0) : null,
      instructions ?? null,
      medId
    );

    recordAuditLog({
      user: req.user,
      action: 'MEDICATION_UPDATED',
      entityType: 'medication',
      entityId: medId,
      details: `Doctor updated medication #${medId}`,
      ipAddress: getClientIp(req),
    });

    res.json(db.prepare(`SELECT * FROM medications WHERE id = ?`).get(medId));
  });

  app.post('/api/schedules/:id/acknowledge', requireAuth, requireRoles('patient'), (req: AuthenticatedRequest, res: Response) => {
    const scheduleId = Number(req.params.id);
    const sched = db
      .prepare(`SELECT * FROM medication_schedules WHERE id = ?`)
      .get(scheduleId) as { id: number; medication_id: number; patient_id: number; status: string } | undefined;

    if (!sched) {
      res.status(404).json({ detail: 'Medication schedule slot not found.' });
      return;
    }
    if (!ensurePatientExistsAndAccess(req.user!, sched.patient_id, res)) return;

    const nowIso = new Date().toISOString();
    const who = req.user!.full_name || req.user!.username;

    runInTransaction(() => {
      db.prepare(
        `UPDATE medication_schedules
         SET status = CASE WHEN status = 'Taken' THEN 'Taken' ELSE 'Acknowledged' END,
             acknowledged_at = COALESCE(acknowledged_at, ?),
             acknowledged_by = COALESCE(acknowledged_by, ?)
         WHERE id = ?`
      ).run(nowIso, who, scheduleId);

      db.prepare(
        `INSERT INTO medication_logs
          (medication_id, schedule_id, patient_id, action_type, status, source, notes)
         VALUES (?, ?, ?, 'acknowledgement', 'Acknowledged', 'Patient / Family Portal', 'Reminder acknowledged. Does not verify physical tablet consumption.')`
      ).run(sched.medication_id, scheduleId, sched.patient_id);

      // Stop any pending voice retries on linked alerts
      const linkedAlerts = db
        .prepare(`SELECT id FROM alerts WHERE medication_schedule_id = ?`)
        .all(scheduleId) as Array<{ id: number }>;

      for (const a of linkedAlerts) {
        db.prepare(
          `UPDATE notification_deliveries
           SET confirmation_status = 'Confirmed',
               confirmed_at = COALESCE(confirmed_at, ?),
               next_retry_at = NULL,
               status = CASE WHEN channel = 'Voice' AND status = 'Pending' THEN 'Cancelled' ELSE status END
           WHERE alert_id = ? AND recipient_type = 'Patient'`
        ).run(nowIso, a.id);

        db.prepare(`UPDATE alerts SET status = 'Acknowledged' WHERE id = ? AND status = 'Open'`).run(a.id);
      }
    });

    res.json({
      message:
        'Reminder acknowledged and any pending voice call retries have been stopped. Note: reminder acknowledgement is recorded separately from dose intake.',
      schedule_id: scheduleId,
    });
  });

  app.post('/api/medication-logs', requireAuth, requireRoles('patient'), (req: AuthenticatedRequest, res: Response) => {
    const { medication_id, schedule_id = null, action_type = 'verified_intake', notes = '' } = req.body ?? {};
    const med = db
      .prepare(`SELECT id, patient_id, verified_by_clinician FROM medications WHERE id = ?`)
      .get(Number(medication_id)) as
      | { id: number; patient_id: number; verified_by_clinician: number }
      | undefined;

    if (!med) {
      res.status(404).json({ detail: 'Medication not found.' });
      return;
    }
    if (!ensurePatientExistsAndAccess(req.user!, med.patient_id, res)) return;

    const cleanAction = action_type === 'acknowledgement' ? 'acknowledgement' : 'verified_intake';
    const statusLabel = cleanAction === 'acknowledgement' ? 'Acknowledged' : 'Taken (Patient Reported)';
    const nowIso = new Date().toISOString();

    const logId = runInTransaction(() => {
      const lRes = db
        .prepare(
          `INSERT INTO medication_logs
            (medication_id, schedule_id, patient_id, action_type, status, source, notes)
           VALUES (?, ?, ?, ?, ?, 'Patient / Family Portal', ?)`
        )
        .run(
          med.id,
          schedule_id ? Number(schedule_id) : null,
          med.patient_id,
          cleanAction,
          statusLabel,
          String(
            notes ||
              (cleanAction === 'verified_intake'
                ? 'Self-reported intake by patient/authorized family member.'
                : 'Reminder acknowledged.')
          )
        );

      if (schedule_id) {
        if (cleanAction === 'verified_intake') {
          db.prepare(
            `UPDATE medication_schedules
             SET status = 'Taken',
                 taken_at = COALESCE(taken_at, ?),
                 acknowledged_at = COALESCE(acknowledged_at, ?),
                 acknowledged_by = COALESCE(acknowledged_by, ?)
             WHERE id = ? AND patient_id = ?`
          ).run(nowIso, nowIso, req.user!.username, Number(schedule_id), med.patient_id);
        } else {
          db.prepare(
            `UPDATE medication_schedules
             SET status = CASE WHEN status = 'Taken' THEN 'Taken' ELSE 'Acknowledged' END,
                 acknowledged_at = COALESCE(acknowledged_at, ?),
                 acknowledged_by = COALESCE(acknowledged_by, ?)
             WHERE id = ? AND patient_id = ?`
          ).run(nowIso, req.user!.username, Number(schedule_id), med.patient_id);
        }

        const linkedAlerts = db
          .prepare(`SELECT id FROM alerts WHERE medication_schedule_id = ?`)
          .all(Number(schedule_id)) as Array<{ id: number }>;
        for (const a of linkedAlerts) {
          db.prepare(
            `UPDATE notification_deliveries
             SET confirmation_status = 'Confirmed', confirmed_at = COALESCE(confirmed_at, ?), next_retry_at = NULL
             WHERE alert_id = ?`
          ).run(nowIso, a.id);
          db.prepare(`UPDATE alerts SET status = 'Acknowledged' WHERE id = ? AND status = 'Open'`).run(a.id);
        }
      }

      return Number(lRes.lastInsertRowid);
    });

    res.status(201).json({
      id: logId,
      action_type: cleanAction,
      status: statusLabel,
      recorded_at: nowIso,
      message:
        cleanAction === 'verified_intake'
          ? 'Patient-reported dose intake logged (distinct from automated reminder delivery).'
          : 'Reminder acknowledgement logged (does not prove medication consumption).',
    });
  });

  // ==========================================================
  // HEALTH READINGS & OBSERVATIONS
  // ==========================================================
  app.get('/api/patients/:id/readings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.params.id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const readings = db
      .prepare(
        `SELECT * FROM health_readings WHERE patient_id = ? ORDER BY recorded_at ASC`
      )
      .all(patientId);
    res.json(readings);
  });

  app.post('/api/readings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const {
      patient_id,
      metric,
      value,
      unit = '',
      notes = '',
      flagged_for_doctor = false,
      flag_reason = '',
    } = req.body ?? {};

    const patientId = Number(patient_id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const cleanMetric = String(metric || '').trim();
    const cleanValue = String(value || '').trim();
    if (!cleanMetric || !cleanValue) {
      res.status(400).json({ detail: 'Measurement metric and value are required.' });
      return;
    }

    const parsed = parseReadingNumbers(cleanMetric, cleanValue);

    const reading = runInTransaction(() => {
      const rRes = db
        .prepare(
          `INSERT INTO health_readings
            (patient_id, recorded_by_user_id, recorded_by_role, recorded_by_name, metric, value, numeric_primary, numeric_secondary, unit, notes, flagged_for_doctor, review_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          patientId,
          req.user!.id,
          req.user!.role,
          req.user!.full_name || req.user!.username,
          cleanMetric,
          cleanValue,
          parsed.primary,
          parsed.secondary,
          String(unit || ''),
          String(notes || ''),
          flagged_for_doctor ? 1 : 0,
          flagged_for_doctor ? 'Action Required' : 'Pending Review'
        );

      if (flagged_for_doctor) {
        const patient = db.prepare(`SELECT name FROM patients WHERE id = ?`).get(patientId) as { name: string };
        db.prepare(
          `INSERT INTO alerts
            (patient_id, title, message, alert_type, severity, status, scheduled_at, created_by)
           VALUES (?, ?, ?, 'Clinical Flag', 'high', 'Open', ?, ?)`
        ).run(
          patientId,
          `Flagged ${cleanMetric} reading for ${patient.name}: ${cleanValue} ${unit}`,
          String(flag_reason || notes || `Observation flagged by ${req.user!.role} for doctor review.`),
          new Date().toISOString(),
          req.user!.full_name || req.user!.username
        );
        db.prepare(`UPDATE patients SET status = 'Attention Required' WHERE id = ?`).run(patientId);
      }

      return db.prepare(`SELECT * FROM health_readings WHERE id = ?`).get(Number(rRes.lastInsertRowid));
    });

    recordAuditLog({
      user: req.user,
      action: flagged_for_doctor ? 'READING_FLAGGED_FOR_DOCTOR' : 'READING_RECORDED',
      entityType: 'health_reading',
      entityId: (reading as { id: number }).id,
      details: `${cleanMetric}: ${cleanValue} ${unit} for patient #${patientId}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json(reading);
  });

  app.patch('/api/readings/:id/review', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const readingId = Number(req.params.id);
    const reading = db
      .prepare(`SELECT id, patient_id FROM health_readings WHERE id = ?`)
      .get(readingId) as { id: number; patient_id: number } | undefined;
    if (!reading) {
      res.status(404).json({ detail: 'Reading not found.' });
      return;
    }
    if (!ensurePatientExistsAndAccess(req.user!, reading.patient_id, res)) return;

    const reviewStatus = String(req.body?.review_status || 'Reviewed');
    if (!['Pending Review', 'Reviewed', 'Action Required'].includes(reviewStatus)) {
      res.status(400).json({ detail: 'Invalid review_status.' });
      return;
    }

    db.prepare(
      `UPDATE health_readings
       SET review_status = ?, doctor_review_notes = ?, flagged_for_doctor = CASE WHEN ? = 'Reviewed' THEN 0 ELSE flagged_for_doctor END
       WHERE id = ?`
    ).run(reviewStatus, String(req.body?.doctor_review_notes || ''), reviewStatus, readingId);

    res.json(db.prepare(`SELECT * FROM health_readings WHERE id = ?`).get(readingId));
  });

  // ==========================================================
  // APPOINTMENTS
  // ==========================================================
  app.get('/api/appointments', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientIds = getAccessiblePatientIds(req.user!);
    if (patientIds.length === 0) {
      res.json([]);
      return;
    }
    const placeholders = patientIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT a.*, p.name AS patient_name, p.patient_code
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.patient_id IN (${placeholders})
         ORDER BY a.appointment_date ASC`
      )
      .all(...patientIds);
    res.json(rows);
  });

  app.post('/api/appointments', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const {
      patient_id,
      nurse_id = null,
      provider = req.user!.full_name || 'Attending Doctor',
      appointment_type = 'Doctor Follow-up',
      appointment_date,
      frequency = 'once',
      notes = '',
    } = req.body ?? {};

    const patientId = Number(patient_id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;
    if (!appointment_date) {
      res.status(400).json({ detail: 'appointment_date is required.' });
      return;
    }

    const r = db
      .prepare(
        `INSERT INTO appointments
          (patient_id, doctor_id, nurse_id, provider, appointment_type, appointment_date, frequency, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?)`
      )
      .run(
        patientId,
        req.user!.doctor_id,
        nurse_id ? Number(nurse_id) : null,
        String(provider),
        String(appointment_type),
        String(appointment_date),
        String(frequency),
        String(notes || '')
      );

    res.status(201).json(db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(Number(r.lastInsertRowid)));
  });

  app.patch(
    '/api/appointments/:id',
    requireAuth,
    requireRoles('doctor', 'nurse'),
    (req: AuthenticatedRequest, res: Response) => {
      const apptId = Number(req.params.id);
      const appt = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(apptId) as
        | { id: number; patient_id: number }
        | undefined;
      if (!appt) {
        res.status(404).json({ detail: 'Appointment not found.' });
        return;
      }
      if (!ensurePatientExistsAndAccess(req.user!, appt.patient_id, res)) return;

      const status = String(req.body?.status || '');
      if (!['Scheduled', 'Completed', 'Missed', 'Cancelled'].includes(status)) {
        res.status(400).json({ detail: 'Invalid appointment status.' });
        return;
      }
      db.prepare(`UPDATE appointments SET status = ?, notes = COALESCE(?, notes) WHERE id = ?`).run(
        status,
        req.body?.notes ?? null,
        apptId
      );
      res.json(db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(apptId));
    }
  );

  // ==========================================================
  // ALERTS, REMINDERS, NOTIFICATIONS & TWILIO WEBHOOKS
  // ==========================================================
  app.get('/api/alerts', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientIds = getAccessiblePatientIds(req.user!);
    if (patientIds.length === 0) {
      res.json([]);
      return;
    }
    const placeholders = patientIds.map(() => '?').join(',');
    const alerts = db
      .prepare(
        `SELECT a.*, p.name AS patient_name, p.patient_code, p.language AS patient_language
         FROM alerts a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.patient_id IN (${placeholders})
         ORDER BY a.created_at DESC
         LIMIT 60`
      )
      .all(...patientIds) as Array<{ id: number }>;

    const deliveriesByAlert = new Map<number, unknown[]>();
    if (alerts.length > 0) {
      const alertPlaceholders = alerts.map(() => '?').join(',');
      const deliveries = db
        .prepare(
          `SELECT * FROM notification_deliveries
           WHERE alert_id IN (${alertPlaceholders})
           ORDER BY id ASC`
        )
        .all(...alerts.map((a) => a.id)) as Array<{ alert_id: number }>;
      for (const d of deliveries) {
        const list = deliveriesByAlert.get(d.alert_id) || [];
        list.push(d);
        deliveriesByAlert.set(d.alert_id, list);
      }
    }

    res.json(
      alerts.map((a) => ({
        ...a,
        deliveries: deliveriesByAlert.get(a.id) || [],
      }))
    );
  });

  app.get('/api/patients/:id/alerts', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.params.id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const alerts = db
      .prepare(`SELECT * FROM alerts WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50`)
      .all(patientId) as Array<{ id: number }>;

    const deliveries = db
      .prepare(`SELECT * FROM notification_deliveries WHERE patient_id = ? ORDER BY id DESC LIMIT 100`)
      .all(patientId) as Array<{ alert_id: number }>;

    res.json(
      alerts.map((a) => ({
        ...a,
        deliveries: deliveries.filter((d) => d.alert_id === a.id),
      }))
    );
  });

  app.post(
    '/api/alerts',
    requireAuth,
    requireRoles('doctor', 'nurse'),
    async (req: AuthenticatedRequest, res: Response) => {
      const {
        patient_id,
        title,
        message,
        alert_type = 'Medication reminder',
        severity = 'medium',
        scheduled_at = new Date().toISOString(),
        dispatch_now = false,
      } = req.body ?? {};

      const patientId = Number(patient_id);
      if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

      const patient = db
        .prepare(`SELECT id, phone, language, opt_in_whatsapp, opt_in_voice FROM patients WHERE id = ?`)
        .get(patientId) as
        | { id: number; phone: string; language: SupportedLanguage; opt_in_whatsapp: number; opt_in_voice: number }
        | undefined;

      if (!patient || !patient.phone.trim()) {
        res.status(400).json({ detail: 'Patient registered phone number is missing.' });
        return;
      }

      const created = runInTransaction(() => {
        const aRes = db
          .prepare(
            `INSERT INTO alerts (patient_id, title, message, alert_type, severity, status, scheduled_at, created_by)
             VALUES (?, ?, ?, ?, ?, 'Open', ?, ?)`
          )
          .run(
            patientId,
            String(title || 'SmartCare reminder'),
            String(message || 'Please check your SmartCare schedule.'),
            String(alert_type),
            String(severity),
            String(scheduled_at),
            req.user!.full_name || req.user!.username
          );
        const alertId = Number(aRes.lastInsertRowid);

        const deliveryIds: Array<{ id: number; channel: 'WhatsApp' | 'Voice' }> = [];
        for (const channel of ['WhatsApp', 'Voice'] as const) {
          const dRes = db
            .prepare(
              `INSERT INTO notification_deliveries
                (alert_id, patient_id, recipient_type, recipient_phone, language, channel, status, confirmation_status, scheduled_at, attempt_number, max_attempts)
               VALUES (?, ?, 'Patient', ?, ?, ?, 'Pending', 'Awaiting', ?, 1, ?)`
            )
            .run(
              alertId,
              patientId,
              patient.phone,
              patient.language,
              channel,
              String(scheduled_at),
              channel === 'Voice' ? 3 : 1
            );
          deliveryIds.push({ id: Number(dRes.lastInsertRowid), channel });
        }

        return { alertId, deliveryIds };
      });

      if (dispatch_now) {
        for (const item of created.deliveryIds) {
          if (item.channel === 'WhatsApp') await dispatchWhatsAppDelivery(item.id);
          else await dispatchVoiceDelivery(item.id);
        }
      }

      const alert = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(created.alertId);
      const deliveries = db
        .prepare(`SELECT * FROM notification_deliveries WHERE alert_id = ?`)
        .all(created.alertId);

      res.status(201).json({
        alert,
        deliveries,
        providers: getProviderConfigStatus(),
      });
    }
  );

  app.post(
    '/api/notifications/test-reminder',
    requireAuth,
    requireRoles('doctor'),
    async (req: AuthenticatedRequest, res: Response) => {
      const patientId = Number(req.body?.patient_id);
      const medName = String(req.body?.medication_name || 'Prescribed Medication');
      const dosage = String(req.body?.dosage || '1 dose');
      const scheduledTime = String(req.body?.scheduled_time || new Date().toTimeString().slice(0, 5));

      if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

      const patient = db
        .prepare(`SELECT id, name, phone, language FROM patients WHERE id = ?`)
        .get(patientId) as
        | { id: number; name: string; phone: string; language: SupportedLanguage }
        | undefined;

      if (!patient || !patient.phone.trim()) {
        res.status(400).json({ detail: 'Patient registered phone number is missing.' });
        return;
      }

      const lang: SupportedLanguage =
        patient.language === 'Tamil' || patient.language === 'Malayalam' ? patient.language : 'English';
      const msg = WHATSAPP_MESSAGES[lang](medName, dosage, scheduledTime);
      const nowIso = new Date().toISOString();

      const created = runInTransaction(() => {
        const aRes = db
          .prepare(
            `INSERT INTO alerts (patient_id, title, message, alert_type, severity, status, scheduled_at, created_by)
             VALUES (?, ?, ?, 'Medication reminder', 'medium', 'Open', ?, ?)`
          )
          .run(patientId, `${medName} (${dosage}) · ${scheduledTime}`, msg, nowIso, req.user!.full_name || req.user!.username);
        const alertId = Number(aRes.lastInsertRowid);

        const waRes = db
          .prepare(
            `INSERT INTO notification_deliveries
              (alert_id, patient_id, recipient_type, recipient_phone, language, channel, status, confirmation_status, scheduled_at, attempt_number, max_attempts)
             VALUES (?, ?, 'Patient', ?, ?, 'WhatsApp', 'Pending', 'Awaiting', ?, 1, 1)`
          )
          .run(alertId, patientId, patient.phone, lang, nowIso);

        const voiceRes = db
          .prepare(
            `INSERT INTO notification_deliveries
              (alert_id, patient_id, recipient_type, recipient_phone, language, channel, status, confirmation_status, scheduled_at, attempt_number, max_attempts)
             VALUES (?, ?, 'Patient', ?, ?, 'Voice', 'Pending', 'Awaiting', ?, 1, 3)`
          )
          .run(alertId, patientId, patient.phone, lang, nowIso);

        return {
          alertId,
          waId: Number(waRes.lastInsertRowid),
          voiceId: Number(voiceRes.lastInsertRowid),
        };
      });

      await dispatchWhatsAppDelivery(created.waId);
      await dispatchVoiceDelivery(created.voiceId);

      recordAuditLog({
        user: req.user,
        action: 'REMINDER_DISPATCHED',
        entityType: 'alert',
        entityId: created.alertId,
        details: `Dispatched ${lang} WhatsApp & Voice reminder to patient #${patientId} registered phone.`,
        ipAddress: getClientIp(req),
      });

      res.status(201).json({
        alert: db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(created.alertId),
        deliveries: db
          .prepare(`SELECT * FROM notification_deliveries WHERE alert_id = ?`)
          .all(created.alertId),
        providers: getProviderConfigStatus(),
      });
    }
  );

  app.post('/api/alerts/:id/confirm', requireAuth, requireRoles('patient'), (req: AuthenticatedRequest, res: Response) => {
    const alertId = Number(req.params.id);
    const alert = db.prepare(`SELECT id, patient_id FROM alerts WHERE id = ?`).get(alertId) as
      | { id: number; patient_id: number }
      | undefined;

    if (!alert) {
      res.status(404).json({ detail: 'Alert not found.' });
      return;
    }
    if (!ensurePatientExistsAndAccess(req.user!, alert.patient_id, res)) return;

    const result = confirmAlertAndStopRetries(alertId, req.user!.username, false);
    recordAuditLog({
      user: req.user,
      action: 'ALERT_CONFIRMED',
      entityType: 'alert',
      entityId: alertId,
      details: 'Patient acknowledged reminder; pending voice retries cancelled.',
      ipAddress: getClientIp(req),
    });

    res.json({
      message: 'Reminder acknowledged and pending voice call retries cancelled. This records acknowledgement, not verified intake.',
      ...result,
    });
  });

  app.post(
    '/api/alerts/:id/resolve',
    requireAuth,
    requireRoles('doctor', 'nurse'),
    (req: AuthenticatedRequest, res: Response) => {
      const alertId = Number(req.params.id);
      const alert = db.prepare(`SELECT id, patient_id FROM alerts WHERE id = ?`).get(alertId) as
        | { id: number; patient_id: number }
        | undefined;
      if (!alert) {
        res.status(404).json({ detail: 'Alert not found.' });
        return;
      }
      if (!ensurePatientExistsAndAccess(req.user!, alert.patient_id, res)) return;

      db.prepare(
        `UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ? WHERE id = ?`
      ).run(req.user!.full_name || req.user!.username, new Date().toISOString(), alertId);

      // Re-evaluate if patient still has open high/critical alerts
      const remaining = (
        db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM alerts WHERE patient_id = ? AND status = 'Open' AND severity IN ('high', 'critical')`
          )
          .get(alert.patient_id) as { cnt: number }
      ).cnt;
      if (remaining === 0) {
        db.prepare(
          `UPDATE patients SET status = 'Monitoring' WHERE id = ? AND status = 'Attention Required'`
        ).run(alert.patient_id);
      }

      res.json(db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(alertId));
    }
  );

  app.post(
    '/api/notifications/process',
    requireAuth,
    requireRoles('doctor', 'nurse'),
    async (_req: AuthenticatedRequest, res: Response) => {
      const stats = await processDueNotifications();
      res.json({
        message: 'Notification scheduler cycle completed.',
        ...stats,
        providers: getProviderConfigStatus(),
      });
    }
  );

  app.post(
    '/api/notifications/deliveries/:id/simulate-retry',
    requireAuth,
    requireRoles('doctor', 'nurse'),
    async (req: AuthenticatedRequest, res: Response) => {
      const deliveryId = Number(req.params.id);
      const delivery = db
        .prepare(`SELECT * FROM notification_deliveries WHERE id = ?`)
        .get(deliveryId) as
        | {
            id: number;
            patient_id: number;
            channel: string;
            confirmation_status: string;
            attempt_number: number;
            max_attempts: number;
          }
        | undefined;

      if (!delivery) {
        res.status(404).json({ detail: 'Delivery record not found.' });
        return;
      }
      if (!ensurePatientExistsAndAccess(req.user!, delivery.patient_id, res)) return;
      if (delivery.channel !== 'Voice') {
        res.status(400).json({ detail: 'Retry progression applies to Voice reminder deliveries.' });
        return;
      }
      if (delivery.confirmation_status === 'Confirmed') {
        res.status(400).json({ detail: 'Reminder is already confirmed; retries stopped.' });
        return;
      }
      if (delivery.confirmation_status === 'Escalated') {
        res.status(400).json({ detail: 'Delivery already reached 3 attempts and escalated.' });
        return;
      }

      if (delivery.attempt_number < delivery.max_attempts) {
        db.prepare(
          `UPDATE notification_deliveries SET attempt_number = attempt_number + 1, status = 'Pending' WHERE id = ?`
        ).run(deliveryId);
        await dispatchVoiceDelivery(deliveryId);
      } else {
        escalateMissedVoiceReminder(deliveryId);
      }

      res.json({
        delivery: db.prepare(`SELECT * FROM notification_deliveries WHERE id = ?`).get(deliveryId),
      });
    }
  );

  app.post(
    '/api/notifications/deliveries/:id/simulate-dtmf',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const deliveryId = Number(req.params.id);
      const digit = String(req.body?.digit || '1');
      const delivery = db
        .prepare(`SELECT * FROM notification_deliveries WHERE id = ?`)
        .get(deliveryId) as { id: number; alert_id: number; patient_id: number } | undefined;

      if (!delivery) {
        res.status(404).json({ detail: 'Delivery not found.' });
        return;
      }
      if (!ensurePatientExistsAndAccess(req.user!, delivery.patient_id, res)) return;

      if (digit === '1') {
        const result = confirmAlertAndStopRetries(
          delivery.alert_id,
          `Voice Keypad DTMF (${req.user!.username})`,
          false
        );
        res.json({
          message: 'Keypad input "1" accepted. Reminder confirmed and all further voice retries stopped.',
          ...result,
        });
      } else {
        res.json({ message: 'Keypad digit did not match confirmation option (1).' });
      }
    }
  );

  // Real Twilio Voice Webhooks (unauthenticated provider callbacks using Twilio parameters)
  app.post('/api/webhooks/twilio/voice', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const deliveryId = Number(req.query.deliveryId || 0);
    const row = db
      .prepare(
        `SELECT nd.id, nd.language, a.title, a.message
         FROM notification_deliveries nd
         JOIN alerts a ON a.id = nd.alert_id
         WHERE nd.id = ?`
      )
      .get(deliveryId) as
      | { id: number; language: SupportedLanguage; title: string; message: string }
      | undefined;

    const twiml = row
      ? buildTwimlForDelivery(row.id, row.language, row.title, row.message)
      : '<?xml version="1.0" encoding="UTF-8"?><Response><Say>SmartCare reminder unavailable.</Say></Response>';

    res.type('application/xml').send(twiml);
  });

  app.post('/api/webhooks/twilio/gather', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const deliveryId = Number(req.query.deliveryId || 0);
    const digits = String(req.body?.Digits || '');
    const delivery = db
      .prepare(`SELECT id, alert_id FROM notification_deliveries WHERE id = ?`)
      .get(deliveryId) as { id: number; alert_id: number } | undefined;

    if (delivery && digits === '1') {
      confirmAlertAndStopRetries(delivery.alert_id, 'Twilio Voice Keypad DTMF-1', false);
      res
        .type('application/xml')
        .send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Your SmartCare medication reminder is confirmed. Goodbye.</Say></Response>'
        );
      return;
    }

    res
      .type('application/xml')
      .send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No valid confirmation received. SmartCare may retry shortly. Goodbye.</Say></Response>'
      );
  });

  app.post('/api/webhooks/twilio/status', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const deliveryId = Number(req.query.deliveryId || 0);
    const callStatus = String(req.body?.CallStatus || '');
    if (deliveryId && ['completed', 'answered'].includes(callStatus)) {
      db.prepare(`UPDATE notification_deliveries SET status = 'Delivered' WHERE id = ? AND status = 'Sent'`).run(
        deliveryId
      );
    } else if (deliveryId && ['failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
      db.prepare(
        `UPDATE notification_deliveries SET status = 'Failed', error_message = ? WHERE id = ?`
      ).run(`Twilio call status: ${callStatus}`, deliveryId);
    }
    res.sendStatus(204);
  });

  // ==========================================================
  // MEDICAL DOCUMENT UPLOADS
  // ==========================================================
  app.get('/api/patients/:id/documents', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const patientId = Number(req.params.id);
    if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

    const docs = db
      .prepare(`SELECT * FROM patient_documents WHERE patient_id = ? ORDER BY uploaded_at DESC`)
      .all(patientId);
    res.json(docs);
  });

  app.post(
    '/api/documents/upload',
    requireAuth,
    requireRoles('doctor', 'patient'),
    upload.single('file'),
    (req: AuthenticatedRequest, res: Response) => {
      const patientId = Number(req.query.patient_id || req.body?.patient_id);
      if (!ensurePatientExistsAndAccess(req.user!, patientId, res)) return;

      if (!req.file) {
        res.status(400).json({ detail: 'Please attach a PDF, PNG, or JPG file.' });
        return;
      }

      const ext = path.extname(req.file.originalname || '').toLowerCase();
      if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)) {
        res.status(400).json({ detail: 'Only PDF, PNG, and JPG files are allowed.' });
        return;
      }

      const safeName = `patient_${patientId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const destination = path.resolve(UPLOAD_DIR, safeName);
      if (!destination.startsWith(UPLOAD_DIR + path.sep)) {
        res.status(400).json({ detail: 'Invalid file destination.' });
        return;
      }

      fs.writeFileSync(destination, req.file.buffer);
      const docType = String(req.body?.document_type || 'Discharge Summary');

      const docRes = db
        .prepare(
          `INSERT INTO patient_documents
            (patient_id, uploaded_by_user_id, original_name, stored_name, mime_type, size_bytes, document_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          patientId,
          req.user!.id,
          path.basename(req.file.originalname),
          safeName,
          req.file.mimetype,
          req.file.size,
          docType
        );

      res.status(201).json(db.prepare(`SELECT * FROM patient_documents WHERE id = ?`).get(Number(docRes.lastInsertRowid)));
    }
  );

  // ==========================================================
  // AUDIT LOGS (DOCTOR ONLY)
  // ==========================================================
  app.get('/api/audit-logs', requireAuth, requireRoles('doctor'), (_req: AuthenticatedRequest, res: Response) => {
    const logs = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 100`).all();
    res.json(logs);
  });

  // ==========================================================
  // SAMPLE FICTIONAL COHORT SEEDER (DOCTOR ONLY, EXPLICITLY LABELED)
  // ==========================================================
  app.post('/api/demo/seed', requireAuth, requireRoles('doctor'), (req: AuthenticatedRequest, res: Response) => {
    const existing = db.prepare(`SELECT id FROM patients WHERE doctor_id = ? LIMIT 1`).get(req.user!.doctor_id);
    if (existing) {
      res.status(409).json({ detail: 'Your clinical workspace already has patient records.' });
      return;
    }

    const result = runInTransaction(() => {
      // Ensure at least one nurse exists to assign
      let nurse = db.prepare(`SELECT id, name FROM nurses LIMIT 1`).get() as { id: number; name: string } | undefined;
      let sampleNurseCreds: { username: string; temporary_password: string } | null = null;

      if (!nurse) {
        const nRes = db
          .prepare(
            `INSERT INTO nurses (name, phone, qualification, shift_area)
             VALUES ('Nurse Priya Nair (Sample)', '+91 98400 11220', 'B.Sc Nursing', 'Post-Discharge Home Care')`
          )
          .run();
        const nId = Number(nRes.lastInsertRowid);
        const nPass = crypto.randomBytes(9).toString('base64url');
        const nUsername = `sc-nurse-${nId}`;
        db.prepare(
          `INSERT INTO users (username, password_hash, role, full_name, phone, nurse_id, must_change_password, is_active)
           VALUES (?, ?, 'nurse', 'Nurse Priya Nair (Sample)', '+91 98400 11220', ?, 1, 1)`
        ).run(nUsername, hashPassword(nPass), nId);
        nurse = { id: nId, name: 'Nurse Priya Nair (Sample)' };
        sampleNurseCreds = { username: nUsername, temporary_password: nPass };
      }

      const today = new Date().toISOString().slice(0, 10);
      const dischargeDate = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const pRes = db
        .prepare(
          `INSERT INTO patients (
            patient_code, doctor_id, name, age, gender, phone, language,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            discharge_date, monitoring_frequency, monitoring_requirements,
            opt_in_whatsapp, opt_in_voice, status
          ) VALUES ('TMP-SEED', ?, 'Meera Krishnan (Fictional Sample)', 68, 'Female', '+91 90000 00001', 'Malayalam',
            'Anand Krishnan', '+91 90000 00002', 'Son', ?, 'daily', '["Blood Pressure","Blood Sugar"]', 1, 1, 'Monitoring')`
        )
        .run(req.user!.doctor_id, dischargeDate);

      const patientId = Number(pRes.lastInsertRowid);
      const patientCode = `SC-${new Date().getFullYear()}-${String(patientId).padStart(4, '0')}`;
      db.prepare(`UPDATE patients SET patient_code = ? WHERE id = ?`).run(patientCode, patientId);

      db.prepare(
        `INSERT INTO patient_discharge_records
          (patient_id, doctor_id, diagnosis, discharge_summary, discharge_instructions, dietary_guidelines, warning_signs, discharge_date)
         VALUES (?, ?, 'Post-Operative Cardiac & Glycemic Recovery (Fictional)',
           'Discharged in stable condition after 4 days inpatient stabilization. Home recovery requires blood pressure and fasting blood glucose tracking.',
           'Take prescribed morning and evening doses on time. Walk 10 minutes twice daily as tolerated.',
           'Low-sodium, balanced diabetic-friendly diet; maintain 2L daily hydration.',
           'Seek immediate care for chest tightness, dizziness, BP > 160/100 mmHg, or fasting sugar > 240 mg/dL.', ?)`
      ).run(patientId, req.user!.doctor_id, dischargeDate);

      const pUsername = `sc-pat-${String(patientId).padStart(3, '0')}`;
      const pTempPass = crypto.randomBytes(9).toString('base64url');
      db.prepare(
        `INSERT INTO users (username, password_hash, role, full_name, phone, patient_id, must_change_password, is_active)
         VALUES (?, ?, 'patient', 'Meera Krishnan (Fictional Sample)', '+91 90000 00001', ?, 1, 1)`
      ).run(pUsername, hashPassword(pTempPass), patientId);

      db.prepare(
        `INSERT INTO nurse_patient_assignments (patient_id, nurse_id, assigned_by_doctor_id, monitoring_frequency, instructions, is_active)
         VALUES (?, ?, ?, 'daily', 'Check seated blood pressure and fasting blood sugar during morning home visits.', 1)`
      ).run(patientId, nurse.id, req.user!.doctor_id);

      const m1Res = db
        .prepare(
          `INSERT INTO medications (patient_id, doctor_id, name, dosage, frequency, timings, start_date, end_date, instructions, verified_by_clinician, is_active)
           VALUES (?, ?, 'Sample Medicine A (Antihypertensive)', '1 tablet', 'Twice daily', '["08:00","20:00"]', ?, ?, 'Take after food with water.', 1, 1)`
        )
        .run(patientId, req.user!.doctor_id, dischargeDate, endDate);
      const m1Id = Number(m1Res.lastInsertRowid);
      generateMedicationSchedules({
        medicationId: m1Id,
        patientId,
        startDate: today,
        endDate,
        timings: ['08:00', '20:00'],
      });

      const m2Res = db
        .prepare(
          `INSERT INTO medications (patient_id, doctor_id, name, dosage, frequency, timings, start_date, end_date, instructions, verified_by_clinician, is_active)
           VALUES (?, ?, 'Sample Medicine B (Glycemic Control)', '500 mg', 'Once daily', '["08:00"]', ?, ?, 'Take with breakfast.', 1, 1)`
        )
        .run(patientId, req.user!.doctor_id, dischargeDate, endDate);
      const m2Id = Number(m2Res.lastInsertRowid);
      generateMedicationSchedules({
        medicationId: m2Id,
        patientId,
        startDate: today,
        endDate,
        timings: ['08:00'],
      });

      // Seed 4 historical readings so Recharts renders genuine DB series
      const sampleReadings = [
        { daysAgo: 3, metric: 'Blood Pressure', val: '134/86', p: 134, s: 86, unit: 'mmHg' },
        { daysAgo: 2, metric: 'Blood Pressure', val: '128/82', p: 128, s: 82, unit: 'mmHg' },
        { daysAgo: 1, metric: 'Blood Pressure', val: '122/80', p: 122, s: 80, unit: 'mmHg' },
        { daysAgo: 0, metric: 'Blood Pressure', val: '118/78', p: 118, s: 78, unit: 'mmHg' },
        { daysAgo: 3, metric: 'Blood Sugar', val: '154', p: 154, s: null, unit: 'mg/dL' },
        { daysAgo: 2, metric: 'Blood Sugar', val: '142', p: 142, s: null, unit: 'mg/dL' },
        { daysAgo: 1, metric: 'Blood Sugar', val: '131', p: 131, s: null, unit: 'mg/dL' },
        { daysAgo: 0, metric: 'Blood Sugar', val: '124', p: 124, s: null, unit: 'mg/dL' },
      ];
      for (const r of sampleReadings) {
        const dt = new Date(Date.now() - r.daysAgo * 86400000).toISOString();
        db.prepare(
          `INSERT INTO health_readings
            (patient_id, recorded_by_user_id, recorded_by_role, recorded_by_name, metric, value, numeric_primary, numeric_secondary, unit, notes, review_status, recorded_at)
           VALUES (?, ?, 'doctor', ?, ?, ?, ?, ?, ?, 'Sample baseline observation', 'Reviewed', ?)`
        ).run(patientId, req.user!.id, req.user!.full_name || req.user!.username, r.metric, r.val, r.p, r.s, r.unit, dt);
      }

      const nextAppt = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) + 'T11:00:00';
      db.prepare(
        `INSERT INTO appointments (patient_id, doctor_id, nurse_id, provider, appointment_type, appointment_date, frequency, status, notes)
         VALUES (?, ?, ?, ?, 'Doctor Follow-up', ?, 'weekly', 'Scheduled', 'Review 7-day BP and glycemic trend')`
      ).run(patientId, req.user!.doctor_id, nurse.id, req.user!.full_name || 'Attending Doctor', nextAppt);

      const visitAt = new Date(Date.now() + 12 * 3600000).toISOString().slice(0, 16);
      db.prepare(
        `INSERT INTO follow_up_visits (patient_id, nurse_id, scheduled_at, status, visit_notes)
         VALUES (?, ?, ?, 'Pending', 'Scheduled home vitals check')`
      ).run(patientId, nurse.id, visitAt);

      return {
        patientId,
        patientCode,
        patientCredentials: { username: pUsername, temporary_password: pTempPass },
        sampleNurseCreds,
      };
    });

    recordAuditLog({
      user: req.user,
      action: 'FICTIONAL_SAMPLE_SEEDED',
      entityType: 'patient',
      entityId: result.patientId,
      details: `Seeded fictional sample patient ${result.patientCode}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      message: 'Fictional sample cohort created.',
      ...result,
    });
  });
}
