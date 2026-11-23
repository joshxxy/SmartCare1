import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const defaultDbPath = path.resolve(process.cwd(), 'data', 'smartcare.db');
const dbPath = process.env.DATABASE_PATH?.trim()
  ? path.resolve(process.env.DATABASE_PATH.trim())
  : defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function runInTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors if transaction already aborted
    }
    throw err;
  }
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((r) => r.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL DEFAULT 'General Medicine',
      phone TEXT NOT NULL DEFAULT '',
      license_number TEXT NOT NULL DEFAULT '',
      hospital TEXT NOT NULL DEFAULT 'SmartCare Partner Hospital',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS nurses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      qualification TEXT NOT NULL DEFAULT 'Registered Nurse',
      shift_area TEXT NOT NULL DEFAULT 'Home Recovery Unit',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_code TEXT NOT NULL UNIQUE,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      age INTEGER,
      gender TEXT NOT NULL DEFAULT 'Not specified',
      phone TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'English' CHECK (language IN ('English', 'Tamil', 'Malayalam')),
      emergency_contact_name TEXT NOT NULL DEFAULT '',
      emergency_contact_phone TEXT NOT NULL DEFAULT '',
      emergency_contact_relation TEXT NOT NULL DEFAULT 'Family',
      discharge_date TEXT,
      monitoring_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (monitoring_frequency IN ('daily', 'weekly', 'fortnightly', 'as_needed')),
      monitoring_requirements TEXT NOT NULL DEFAULT '[]',
      opt_in_whatsapp INTEGER NOT NULL DEFAULT 1,
      opt_in_voice INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Monitoring' CHECK (status IN ('Monitoring', 'Attention Required', 'Stable', 'Discharged')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('doctor', 'nurse', 'patient')),
      full_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      patient_id INTEGER UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id INTEGER UNIQUE REFERENCES doctors(id) ON DELETE CASCADE,
      nurse_id INTEGER UNIQUE REFERENCES nurses(id) ON DELETE CASCADE,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patient_discharge_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
      diagnosis TEXT NOT NULL DEFAULT '',
      discharge_summary TEXT NOT NULL DEFAULT '',
      discharge_instructions TEXT NOT NULL DEFAULT '',
      dietary_guidelines TEXT NOT NULL DEFAULT '',
      warning_signs TEXT NOT NULL DEFAULT '',
      discharge_date TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS nurse_patient_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      nurse_id INTEGER NOT NULL REFERENCES nurses(id) ON DELETE CASCADE,
      assigned_by_doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
      monitoring_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (monitoring_frequency IN ('daily', 'weekly', 'fortnightly', 'as_needed')),
      instructions TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(patient_id, nurse_id)
    );

    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'Twice daily',
      timings TEXT NOT NULL DEFAULT '["08:00","20:00"]',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      verified_by_clinician INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS medication_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Reminder Sent', 'Acknowledged', 'Taken', 'Missed')),
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      taken_at TEXT,
      UNIQUE(medication_id, scheduled_at)
    );

    CREATE TABLE IF NOT EXISTS medication_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
      schedule_id INTEGER REFERENCES medication_schedules(id) ON DELETE SET NULL,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL CHECK (action_type IN ('acknowledgement', 'verified_intake', 'missed')),
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Patient portal',
      notes TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS health_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      recorded_by_role TEXT NOT NULL,
      recorded_by_name TEXT NOT NULL,
      metric TEXT NOT NULL,
      value TEXT NOT NULL,
      numeric_primary REAL,
      numeric_secondary REAL,
      unit TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      flagged_for_doctor INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'Pending Review' CHECK (review_status IN ('Pending Review', 'Reviewed', 'Action Required')),
      doctor_review_notes TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
      nurse_id INTEGER REFERENCES nurses(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      appointment_type TEXT NOT NULL DEFAULT 'Doctor Follow-up',
      appointment_date TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'daily', 'weekly', 'fortnightly')),
      status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Missed', 'Cancelled')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS follow_up_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      nurse_id INTEGER NOT NULL REFERENCES nurses(id) ON DELETE CASCADE,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      scheduled_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Missed', 'Overdue')),
      visit_notes TEXT NOT NULL DEFAULT '',
      flagged_for_doctor INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      medication_schedule_id INTEGER REFERENCES medication_schedules(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      alert_type TEXT NOT NULL DEFAULT 'Medication reminder',
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Acknowledged', 'Resolved')),
      scheduled_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'SmartCare Scheduler',
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      medication_schedule_id INTEGER REFERENCES medication_schedules(id) ON DELETE SET NULL,
      recipient_type TEXT NOT NULL DEFAULT 'Patient',
      recipient_phone TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'English' CHECK (language IN ('English', 'Tamil', 'Malayalam')),
      channel TEXT NOT NULL CHECK (channel IN ('WhatsApp', 'Voice')),
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Simulated', 'Sent', 'Delivered', 'Failed', 'Cancelled')),
      confirmation_status TEXT NOT NULL DEFAULT 'Awaiting' CHECK (confirmation_status IN ('Awaiting', 'Confirmed', 'Not Confirmed', 'Escalated')),
      confirmed_at TEXT,
      provider_reference TEXT,
      error_message TEXT,
      scheduled_at TEXT NOT NULL,
      sent_at TEXT,
      next_retry_at TEXT,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patient_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      document_type TEXT NOT NULL DEFAULT 'Discharge Summary',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL DEFAULT 'system',
      role TEXT NOT NULL DEFAULT 'system',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_patients_doctor ON patients(doctor_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_nurse ON nurse_patient_assignments(nurse_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_assignments_patient ON nurse_patient_assignments(patient_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_meds_patient ON medications(patient_id);
    CREATE INDEX IF NOT EXISTS idx_sched_due ON medication_schedules(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_sched_patient ON medication_schedules(patient_id, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_readings_patient ON health_readings(patient_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_visits_nurse ON follow_up_visits(nurse_id, status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, status);
    CREATE INDEX IF NOT EXISTS idx_deliveries_due ON notification_deliveries(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);

  // Safe non-destructive forward migrations
  addColumnIfMissing('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('patients', 'monitoring_requirements', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('notification_deliveries', 'next_retry_at', 'TEXT');
}
