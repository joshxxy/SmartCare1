export type UserRole = 'doctor' | 'nurse' | 'patient';
export type SupportedLanguage = 'English' | 'Tamil' | 'Malayalam';

export interface Session {
  access_token: string;
  token_type: string;
  user_id: number;
  username: string;
  full_name: string;
  role: UserRole;
  patient_id: number | null;
  doctor_id: number | null;
  nurse_id: number | null;
  must_change_password: boolean;
}

export interface Patient {
  id: number;
  patient_code: string;
  doctor_id: number;
  name: string;
  age: number | null;
  gender: string;
  phone: string;
  language: SupportedLanguage;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
  discharge_date: string | null;
  monitoring_frequency: 'daily' | 'weekly' | 'fortnightly' | 'as_needed';
  monitoring_requirements: string;
  opt_in_whatsapp: number;
  opt_in_voice: number;
  status: 'Monitoring' | 'Attention Required' | 'Stable' | 'Discharged';
  created_at: string;
  doctor_name?: string;
  doctor_specialty?: string;
  doctor_phone?: string;
  doctor_hospital?: string;
  diagnosis?: string;
  discharge_summary?: string;
  discharge_instructions?: string;
  dietary_guidelines?: string;
  warning_signs?: string;
  assigned_nurses?: string | null;
  open_alerts_count?: number;
}

export interface NurseSummary {
  id: number;
  name: string;
  phone: string;
  qualification: string;
  shift_area: string;
  username: string;
  assigned_count: number;
}

export interface AssignedNurseInfo {
  id: number;
  name: string;
  phone: string;
  qualification: string;
  shift_area: string;
  monitoring_frequency: string;
  instructions: string;
  assigned_at: string;
}

export interface Medication {
  id: number;
  patient_id: number;
  doctor_id: number;
  doctor_name?: string;
  name: string;
  dosage: string;
  frequency: string;
  timings: string;
  start_date: string;
  end_date: string;
  instructions: string;
  verified_by_clinician: number;
  is_active: number;
  created_at: string;
}

export interface MedicationSchedule {
  id: number;
  medication_id: number;
  patient_id: number;
  medication_name?: string;
  dosage?: string;
  scheduled_date: string;
  scheduled_time: string;
  scheduled_at: string;
  status: 'Scheduled' | 'Reminder Sent' | 'Acknowledged' | 'Taken' | 'Missed';
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  taken_at: string | null;
}

export interface MedicationLog {
  id: number;
  medication_id: number;
  schedule_id: number | null;
  patient_id: number;
  medication_name?: string;
  action_type: 'acknowledgement' | 'verified_intake' | 'missed';
  status: string;
  source: string;
  notes: string;
  recorded_at: string;
}

export interface HealthReading {
  id: number;
  patient_id: number;
  patient_name?: string;
  recorded_by_user_id: number;
  recorded_by_role: string;
  recorded_by_name: string;
  metric: string;
  value: string;
  numeric_primary: number | null;
  numeric_secondary: number | null;
  unit: string;
  notes: string;
  flagged_for_doctor: number;
  review_status: 'Pending Review' | 'Reviewed' | 'Action Required';
  doctor_review_notes: string;
  recorded_at: string;
}

export interface Appointment {
  id: number;
  patient_id: number;
  patient_name?: string;
  patient_code?: string;
  doctor_id: number;
  nurse_id: number | null;
  provider: string;
  appointment_type: string;
  appointment_date: string;
  frequency: string;
  status: 'Scheduled' | 'Completed' | 'Missed' | 'Cancelled';
  notes: string;
}

export interface FollowUpVisit {
  id: number;
  patient_id: number;
  patient_name?: string;
  patient_code?: string;
  nurse_id: number;
  nurse_name?: string;
  scheduled_at: string;
  completed_at: string | null;
  status: 'Pending' | 'Completed' | 'Missed' | 'Overdue';
  visit_notes: string;
  flagged_for_doctor: number;
  flag_reason: string;
}

export interface NotificationDelivery {
  id: number;
  alert_id: number;
  patient_id: number;
  recipient_type: string;
  recipient_phone: string;
  language: SupportedLanguage;
  channel: 'WhatsApp' | 'Voice';
  status: 'Pending' | 'Simulated' | 'Sent' | 'Delivered' | 'Failed' | 'Cancelled';
  confirmation_status: 'Awaiting' | 'Confirmed' | 'Not Confirmed' | 'Escalated';
  confirmed_at: string | null;
  provider_reference: string | null;
  error_message: string | null;
  scheduled_at: string;
  sent_at: string | null;
  next_retry_at: string | null;
  attempt_number: number;
  max_attempts: number;
}

export interface AlertItem {
  id: number;
  patient_id: number;
  patient_name?: string;
  patient_code?: string;
  patient_language?: SupportedLanguage;
  medication_schedule_id: number | null;
  title: string;
  message: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'Open' | 'Acknowledged' | 'Resolved';
  scheduled_at: string;
  created_by: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  deliveries?: NotificationDelivery[];
}

export interface PatientDocument {
  id: number;
  patient_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  document_type: string;
  uploaded_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export interface ProviderStatus {
  whatsapp: { configured: boolean; mode: 'live' | 'simulated'; apiVersion: string };
  voice: { configured: boolean; mode: 'live' | 'simulated'; maxAttempts: number; retryIntervalMinutes: number };
}

export interface DashboardSummary {
  patients: number;
  active_patients: number;
  attention_required: number;
  medications: number;
  upcoming_appointments: number;
  today_followups: number;
  pending_visits: number;
  overdue_followups: number;
  missed_reminders: number;
  open_alerts: number;
  adherence: number;
  readings: HealthReading[];
  appointments: Appointment[];
  followups: FollowUpVisit[];
  alerts: AlertItem[];
  providers: ProviderStatus;
}

export type WhatsAppReminderType =
  | 'BP Check-up'
  | 'Blood Sugar Test'
  | 'Medicine'
  | 'Doctor Appointment'
  | 'Caregiver Visit';

export type WhatsAppReminderStatus = 'Pending' | 'Sent (Unconfirmed)' | 'Delivered' | 'Cancelled';

export interface WhatsAppReminder {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  opt_in_whatsapp: number;
  created_by_user_id: number;
  created_by_role: 'doctor' | 'nurse';
  created_by_name: string;
  recipient_phone: string;
  reminder_type: WhatsAppReminderType;
  language: SupportedLanguage;
  scheduled_date: string;
  scheduled_time: string;
  notes: string;
  message_text: string;
  status: WhatsAppReminderStatus;
  sent_at: string | null;
  delivered_confirmed_at: string | null;
  created_at: string;
}

export interface WhatsAppReminderDashboardData {
  reminders: WhatsAppReminder[];
  stats: {
    total: number;
    sent: number;
    upcoming: number;
    pending: number;
    delivered: number;
  };
}

export type AutomatedReminderType =
  | 'BP'
  | 'Blood Sugar'
  | 'Medicine'
  | 'Doctor Appointment'
  | 'Nurse Visit';

export type AutomatedReminderStatus = 'Pending' | 'Sending' | 'Sent' | 'Failed';

export interface AutomatedWhatsAppReminder {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  created_by_user_id: number;
  created_by_role: 'doctor' | 'nurse';
  created_by_name: string;
  masked_phone: string;
  reminder_type: AutomatedReminderType;
  language: SupportedLanguage;
  scheduled_date: string;
  scheduled_time: string;
  scheduled_at: string;
  notes: string;
  message_text: string;
  status: AutomatedReminderStatus;
  error_reason: string;
  sent_at: string | null;
  created_at: string;
}

export interface AutomatedWhatsAppDashboardData {
  reminders: AutomatedWhatsAppReminder[];
  stats: {
    total: number;
    sent: number;
    pending: number;
    failed: number;
  };
}

