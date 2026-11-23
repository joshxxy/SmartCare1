import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Copy,
  FileText,
  KeyRound,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AlertItem,
  Appointment,
  AssignedNurseInfo,
  AuditLog,
  DashboardSummary,
  FollowUpVisit,
  HealthReading,
  Medication,
  MedicationLog,
  MedicationSchedule,
  NotificationDelivery,
  NurseSummary,
  Patient,
  PatientDocument,
  Session,
  SupportedLanguage,
} from '../types';
import { VitalsChart } from './VitalsChart';

export type DoctorTab = 'overview' | 'patients' | 'appointments' | 'alerts' | 'audit';

interface DoctorPortalProps {
  tab: DoctorTab;
  setTab: (tab: DoctorTab) => void;
  session: Session;
  onNotice: (msg: string) => void;
}

interface CreatedCredentials {
  patient_id: number;
  patient_code: string;
  username: string;
  temporary_password: string;
  note: string;
  sample_nurse?: { username: string; temporary_password: string } | null;
}

const MONITORING_METRICS = ['Blood Pressure', 'Blood Sugar', 'SpO2', 'Heart Rate', 'Temperature', 'Weight'];

export function DoctorPortal({ tab, setTab, session, onNotice }: DoctorPortalProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [nurses, setNurses] = useState<NurseSummary[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followups, setFollowups] = useState<FollowUpVisit[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected patient workspace
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [patientSubTab, setPatientSubTab] = useState<
    'careplan' | 'medications' | 'nurses' | 'readings' | 'notifications' | 'documents'
  >('careplan');
  const [patientDetail, setPatientDetail] = useState<
    (Patient & { assigned_nurses?: AssignedNurseInfo[]; account?: { username: string; must_change_password: number } }) | null
  >(null);
  const [patientMeds, setPatientMeds] = useState<Medication[]>([]);
  const [patientSchedules, setPatientSchedules] = useState<MedicationSchedule[]>([]);
  const [patientMedLogs, setPatientMedLogs] = useState<MedicationLog[]>([]);
  const [patientReadings, setPatientReadings] = useState<HealthReading[]>([]);
  const [patientAlerts, setPatientAlerts] = useState<AlertItem[]>([]);
  const [patientDocs, setPatientDocs] = useState<PatientDocument[]>([]);

  // Modals
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<CreatedCredentials | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Forms
  const [regForm, setRegForm] = useState({
    name: '',
    age: '',
    gender: 'Female',
    phone: '',
    language: 'English' as SupportedLanguage,
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relation: 'Family',
    discharge_date: new Date().toISOString().slice(0, 10),
    monitoring_frequency: 'daily' as Patient['monitoring_frequency'],
    monitoring_requirements: ['Blood Pressure'] as string[],
    opt_in_whatsapp: true,
    opt_in_voice: true,
    diagnosis: '',
    discharge_summary: '',
    discharge_instructions: '',
    dietary_guidelines: '',
    warning_signs: '',
    nurse_id: '',
    nurse_instructions: '',
  });

  const [medForm, setMedForm] = useState({
    name: '',
    dosage: '',
    frequency: 'Twice daily',
    timings: '08:00, 20:00',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    instructions: '',
  });

  const [assignForm, setAssignForm] = useState({
    nurse_id: '',
    monitoring_frequency: 'daily',
    instructions: '',
    first_visit_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T10:00',
  });

  const [apptForm, setApptForm] = useState({
    patient_id: '',
    appointment_type: 'Doctor Follow-up',
    appointment_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) + 'T10:30',
    frequency: 'once',
    notes: '',
  });

  const [carePlanEdit, setCarePlanEdit] = useState({
    phone: '',
    status: 'Monitoring' as Patient['status'],
    monitoring_frequency: 'daily' as Patient['monitoring_frequency'],
    language: 'English' as SupportedLanguage,
    diagnosis: '',
    discharge_instructions: '',
    warning_signs: '',
  });

  const [docFile, setDocFile] = useState<File | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [sumData, patData, nurseData, apptData, fuData, alertData] = await Promise.all([
        apiFetch<DashboardSummary>('/api/summary'),
        apiFetch<Patient[]>('/api/patients'),
        apiFetch<NurseSummary[]>('/api/nurses'),
        apiFetch<Appointment[]>('/api/appointments'),
        apiFetch<FollowUpVisit[]>('/api/follow-ups'),
        apiFetch<AlertItem[]>('/api/alerts'),
      ]);
      setSummary(sumData);
      setPatients(patData);
      setNurses(nurseData);
      setAppointments(apptData);
      setFollowups(fuData);
      setAlerts(alertData);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not load doctor workspace.');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  const loadPatientDetail = useCallback(async (patientId: number) => {
    try {
      const [detail, medBundle, readings, pAlerts, docs] = await Promise.all([
        apiFetch<
          Patient & { assigned_nurses?: AssignedNurseInfo[]; account?: { username: string; must_change_password: number } }
        >(`/api/patients/${patientId}`),
        apiFetch<{ medications: Medication[]; schedules: MedicationSchedule[]; logs: MedicationLog[] }>(
          `/api/patients/${patientId}/medications`
        ),
        apiFetch<HealthReading[]>(`/api/patients/${patientId}/readings`),
        apiFetch<AlertItem[]>(`/api/patients/${patientId}/alerts`),
        apiFetch<PatientDocument[]>(`/api/patients/${patientId}/documents`),
      ]);
      setPatientDetail(detail);
      setPatientMeds(medBundle.medications);
      setPatientSchedules(medBundle.schedules);
      setPatientMedLogs(medBundle.logs);
      setPatientReadings(readings);
      setPatientAlerts(pAlerts);
      setPatientDocs(docs);
      setCarePlanEdit({
        phone: detail.phone || '',
        status: detail.status,
        monitoring_frequency: detail.monitoring_frequency,
        language: detail.language,
        diagnosis: detail.diagnosis || '',
        discharge_instructions: detail.discharge_instructions || '',
        warning_signs: detail.warning_signs || '',
      });
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Unable to load patient details.');
    }
  }, [onNotice]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (selectedPatientId) {
      void loadPatientDetail(selectedPatientId);
    }
  }, [selectedPatientId, loadPatientDetail]);

  useEffect(() => {
    if (tab === 'audit') {
      apiFetch<AuditLog[]>('/api/audit-logs')
        .then(setAuditLogs)
        .catch((err) => onNotice(err instanceof Error ? err.message : 'Failed to load audit logs.'));
    }
  }, [tab, onNotice]);

  async function handleRegisterPatient(e: FormEvent) {
    e.preventDefault();
    setBusyAction(true);
    try {
      const res = await apiFetch<Patient & { login_credentials: CreatedCredentials }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          ...regForm,
          age: regForm.age ? Number(regForm.age) : null,
          nurse_id: regForm.nurse_id ? Number(regForm.nurse_id) : null,
        }),
      });
      setShowRegisterModal(false);
      setCreatedCreds(res.login_credentials);
      setCopiedCreds(false);
      setRegForm({
        name: '',
        age: '',
        gender: 'Female',
        phone: '',
        language: 'English',
        emergency_contact_name: '',
        emergency_contact_phone: '',
        emergency_contact_relation: 'Family',
        discharge_date: new Date().toISOString().slice(0, 10),
        monitoring_frequency: 'daily',
        monitoring_requirements: ['Blood Pressure'],
        opt_in_whatsapp: true,
        opt_in_voice: true,
        diagnosis: '',
        discharge_summary: '',
        discharge_instructions: '',
        dietary_guidelines: '',
        warning_signs: '',
        nurse_id: '',
        nurse_instructions: '',
      });
      await loadWorkspace();
      setSelectedPatientId(res.id);
      setTab('patients');
      onNotice(`Patient ${res.name} registered and individual patient login created.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Failed to register patient.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSeedSample() {
    setBusyAction(true);
    try {
      const res = await apiFetch<{
        patientId: number;
        patientCode: string;
        patientCredentials: { username: string; temporary_password: string };
        sampleNurseCreds: { username: string; temporary_password: string } | null;
      }>('/api/demo/seed', { method: 'POST' });

      setCreatedCreds({
        patient_id: res.patientId,
        patient_code: res.patientCode,
        username: res.patientCredentials.username,
        temporary_password: res.patientCredentials.temporary_password,
        note: 'Fictional sample patient credentials (shown once). Change temporary password on first patient sign-in.',
        sample_nurse: res.sampleNurseCreds,
      });
      await loadWorkspace();
      onNotice('Fictional sample cohort created for workspace evaluation.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Unable to seed sample data.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleAddMedication(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) return;
    setBusyAction(true);
    try {
      const timingsArr = medForm.timings
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await apiFetch<{ schedulesCreated: number }>('/api/medications', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: selectedPatientId,
          name: medForm.name,
          dosage: medForm.dosage,
          frequency: medForm.frequency,
          timings: timingsArr,
          start_date: medForm.start_date,
          end_date: medForm.end_date,
          instructions: medForm.instructions,
          verified_by_clinician: true,
        }),
      });
      setMedForm({
        name: '',
        dosage: '',
        frequency: 'Twice daily',
        timings: '08:00, 20:00',
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        instructions: '',
      });
      await Promise.all([loadPatientDetail(selectedPatientId), loadWorkspace()]);
      onNotice(`Prescription saved and ${res.schedulesCreated} medication reminder slots scheduled.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not add medication.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleAssignNurse(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatientId || !assignForm.nurse_id) return;
    setBusyAction(true);
    try {
      await apiFetch(`/api/patients/${selectedPatientId}/assign-nurse`, {
        method: 'POST',
        body: JSON.stringify({
          nurse_id: Number(assignForm.nurse_id),
          monitoring_frequency: assignForm.monitoring_frequency,
          instructions: assignForm.instructions,
          first_visit_at: assignForm.first_visit_at,
        }),
      });
      await Promise.all([loadPatientDetail(selectedPatientId), loadWorkspace()]);
      onNotice('Nurse assigned and follow-up schedule updated.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not assign nurse.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleUnassignNurse(nurseId: number) {
    if (!selectedPatientId) return;
    try {
      await apiFetch(`/api/patients/${selectedPatientId}/nurses/${nurseId}`, { method: 'DELETE' });
      await Promise.all([loadPatientDetail(selectedPatientId), loadWorkspace()]);
      onNotice('Nurse assignment removed.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Failed to unassign nurse.');
    }
  }

  async function handleUpdateCarePlan(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) return;
    setBusyAction(true);
    try {
      await apiFetch(`/api/patients/${selectedPatientId}`, {
        method: 'PATCH',
        body: JSON.stringify(carePlanEdit),
      });
      await Promise.all([loadPatientDetail(selectedPatientId), loadWorkspace()]);
      onNotice('Patient discharge instructions and monitoring plan updated.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Failed to update care plan.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReviewReading(readingId: number, reviewStatus: 'Reviewed' | 'Action Required') {
    if (!selectedPatientId) return;
    try {
      await apiFetch(`/api/readings/${readingId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          review_status: reviewStatus,
          doctor_review_notes:
            reviewStatus === 'Reviewed' ? `Reviewed by ${session.full_name || session.username}` : 'Requires clinical follow-up',
        }),
      });
      await loadPatientDetail(selectedPatientId);
      onNotice(`Observation marked as ${reviewStatus}.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not review reading.');
    }
  }

  async function handleCreateAppointment(e: FormEvent) {
    e.preventDefault();
    const targetPatient = Number(apptForm.patient_id || selectedPatientId);
    if (!targetPatient) return;
    setBusyAction(true);
    try {
      await apiFetch('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: targetPatient,
          appointment_type: apptForm.appointment_type,
          appointment_date: apptForm.appointment_date,
          frequency: apptForm.frequency,
          notes: apptForm.notes,
        }),
      });
      setApptForm({ ...apptForm, notes: '' });
      await loadWorkspace();
      onNotice('Follow-up appointment scheduled.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Failed to schedule appointment.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSendTestReminder(patientId: number) {
    setBusyAction(true);
    try {
      const firstMed = patientMeds[0];
      const res = await apiFetch<{ deliveries?: NotificationDelivery[] }>('/api/notifications/test-reminder', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: patientId,
          medication_name: firstMed?.name || 'Prescribed Medication',
          dosage: firstMed?.dosage || '1 tablet',
          scheduled_time: new Date().toTimeString().slice(0, 5),
        }),
      });
      await Promise.all([loadWorkspace(), ...(selectedPatientId ? [loadPatientDetail(selectedPatientId)] : [])]);
      const wa = res.deliveries?.find((d) => d.channel === 'WhatsApp');
      if (wa?.status === 'Sent') {
        onNotice(`WhatsApp Sent to ${wa.recipient_phone}${wa.provider_reference ? ` (${wa.provider_reference})` : ''}.`);
      } else if (wa?.status === 'Failed') {
        onNotice(`WhatsApp Failed (${wa.recipient_phone}): ${wa.error_message || 'Check Meta API credentials and recipient whitelist.'}`);
      } else if (wa?.status === 'Simulated') {
        onNotice(`WhatsApp Simulated: ${wa.error_message || 'Set Meta WhatsApp secrets for live delivery.'}`);
      } else if (wa?.status === 'Cancelled') {
        onNotice(`WhatsApp Cancelled: ${wa.error_message || 'Patient opted out of WhatsApp reminders.'}`);
      } else {
        onNotice('Multilingual WhatsApp & Voice reminder dispatched to patient phone.');
      }
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not send test reminder.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleResetPatientPassword(patientId: number) {
    setBusyAction(true);
    try {
      const creds = await apiFetch<CreatedCredentials>(`/api/patients/${patientId}/reset-password`, {
        method: 'POST',
      });
      setCreatedCreds(creds);
      setCopiedCreds(false);
      onNotice(`Temporary login password reset for ${creds.username}.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not reset patient password.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleProcessScheduler() {
    setBusyAction(true);
    try {
      const res = await apiFetch<{
        schedulesTriggered: number;
        deliveriesDispatched: number;
        voiceRetriesTriggered: number;
        escalationsCreated: number;
      }>('/api/notifications/process', { method: 'POST' });
      await Promise.all([loadWorkspace(), ...(selectedPatientId ? [loadPatientDetail(selectedPatientId)] : [])]);
      onNotice(
        `Scheduler cycle: ${res.schedulesTriggered} due schedules, ${res.deliveriesDispatched} dispatches, ${res.voiceRetriesTriggered} retries, ${res.escalationsCreated} escalations.`
      );
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Scheduler run failed.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSimulateVoiceRetry(deliveryId: number) {
    try {
      await apiFetch(`/api/notifications/deliveries/${deliveryId}/simulate-retry`, { method: 'POST' });
      await Promise.all([loadWorkspace(), ...(selectedPatientId ? [loadPatientDetail(selectedPatientId)] : [])]);
      onNotice('Voice call retry step processed.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Retry simulation failed.');
    }
  }

  async function handleResolveAlert(alertId: number) {
    try {
      await apiFetch(`/api/alerts/${alertId}/resolve`, { method: 'POST' });
      await Promise.all([loadWorkspace(), ...(selectedPatientId ? [loadPatientDetail(selectedPatientId)] : [])]);
      onNotice('Alert marked as resolved.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not resolve alert.');
    }
  }

  async function handleUploadDoc(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatientId || !docFile) return;
    setBusyAction(true);
    try {
      const fd = new FormData();
      fd.append('file', docFile);
      fd.append('document_type', 'Discharge Summary');
      await apiFetch(`/api/documents/upload?patient_id=${selectedPatientId}`, {
        method: 'POST',
        body: fd,
      });
      setDocFile(null);
      await loadPatientDetail(selectedPatientId);
      onNotice('Medical document uploaded securely.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Document upload failed.');
    } finally {
      setBusyAction(false);
    }
  }

  const filteredPatients = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.patient_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.diagnosis || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading && !summary) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Doctor Clinical Overview</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Post-discharge monitoring, prescriptions, nurse coordination, and reminder escalations
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {patients.length === 0 && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleSeedSample}
                  className="px-4 py-2 text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Load Fictional Sample Patient
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowRegisterModal(true)}
                className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                Register Patient
              </button>
            </div>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Registered Patients"
              value={summary?.patients ?? 0}
              detail={`${summary?.active_patients ?? 0} active recovery plans`}
              icon={Users}
            />
            <KpiCard
              label="Patients Requiring Attention"
              value={summary?.attention_required ?? 0}
              detail={`${summary?.open_alerts ?? 0} open clinical or escalation alerts`}
              icon={AlertTriangle}
              tone={summary?.attention_required ? 'danger' : 'neutral'}
            />
            <KpiCard
              label="Upcoming Follow-Ups"
              value={(summary?.upcoming_appointments ?? 0) + (summary?.pending_visits ?? 0)}
              detail={`${summary?.overdue_followups ?? 0} overdue nurse visits`}
              icon={CalendarDays}
            />
            <KpiCard
              label="Medication Adherence"
              value={`${summary?.adherence ?? 0}%`}
              detail={`${summary?.missed_reminders ?? 0} missed reminder slots`}
              icon={CheckCircle2}
              tone="teal"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Patients List */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Registered Post-Discharge Patients</h2>
                  <p className="text-xs text-slate-500">Select a patient to manage prescriptions, nurses, and charts</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('patients')}
                  className="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap"
                >
                  Open full directory
                </button>
              </div>

              {patients.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                  <p className="text-sm font-medium text-slate-700">No patients registered under your account yet</p>
                  <p className="text-xs text-slate-500 mt-1 mb-4">
                    Register a post-discharge patient to auto-create their private patient portal login.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowRegisterModal(true)}
                    className="px-4 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800"
                  >
                    Register First Patient
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {patients.slice(0, 6).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPatientId(p.id);
                        setTab('patients');
                      }}
                      className="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-slate-50/80 px-2 rounded-lg transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">{p.name}</span>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">{p.patient_code}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {p.language} · {p.monitoring_frequency} monitoring · Nurse: {p.assigned_nurses || 'Unassigned'}
                        </div>
                      </div>
                      <StatusText status={p.status} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Alerts & Escalation Summary */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Alerts & Notification Gateway</h2>
                    <p className="text-xs text-slate-500">
                      WhatsApp: {summary?.providers.whatsapp.mode === 'live' ? 'Live Meta API' : 'Sandbox Simulation'} ·
                      Voice: {summary?.providers.voice.mode === 'live' ? 'Live Twilio' : 'Sandbox Simulation'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleProcessScheduler}
                    disabled={busyAction}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Run Scheduler
                  </button>
                </div>

                {alerts.filter((a) => a.status === 'Open').length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                    <p className="text-xs text-slate-500">No open clinical flags or missed medication escalations.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {alerts
                      .filter((a) => a.status === 'Open')
                      .slice(0, 5)
                      .map((a) => (
                        <div key={a.id} className="py-3 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900">{a.title}</span>
                            <span
                              className={`text-[11px] font-semibold shrink-0 ${
                                a.severity === 'high' || a.severity === 'critical' ? 'text-red-700' : 'text-amber-700'
                              }`}
                            >
                              {a.alert_type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">{a.message}</p>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-slate-400 tabular-nums">
                              {a.patient_name} · {new Date(a.created_at).toLocaleString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleResolveAlert(a.id)}
                              className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                            >
                              Resolve
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setTab('alerts')}
                className="mt-4 w-full py-2 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Open Notification & Escalation Console
              </button>
            </div>
          </div>

          <VitalsChart readings={summary?.readings || []} title="Cohort Recent Health Readings" />
        </>
      )}

      {/* PATIENTS DIRECTORY & CLINICAL WORKSPACE */}
      {tab === 'patients' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Patient Directory & Care Plans</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Register patients, prescribe medications with automated reminder schedules, and review nurse observations
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRegisterModal(true)}
              className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              Register New Patient
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Patient List Column */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, code, diagnosis..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {filteredPatients.length === 0 ? (
                  <p className="text-xs text-slate-500 py-8 text-center">No matching patients found.</p>
                ) : (
                  filteredPatients.map((p) => {
                    const active = selectedPatientId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPatientId(p.id)}
                        className={`w-full text-left p-3 rounded-lg transition-colors cursor-pointer ${
                          active ? 'bg-teal-50/80 border border-teal-200' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">{p.name}</span>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">{p.patient_code}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {p.age ? `${p.age}y · ` : ''}
                          {p.language} · {p.phone}
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[11px]">
                          <span className="text-slate-500 truncate">Nurse: {p.assigned_nurses || 'Unassigned'}</span>
                          <StatusText status={p.status} />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Patient Detail Workspace */}
            <div className="lg:col-span-8">
              {!patientDetail ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                  <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-sm font-semibold text-slate-800">Select a patient from the directory</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    View their diagnosis, prescriptions, reminder schedules, assigned nurses, and recovery readings.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Patient Header */}
                  <div className="p-5 border-b border-slate-200 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-lg font-bold text-slate-900">{patientDetail.name}</h2>
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {patientDetail.patient_code}
                        </span>
                        <StatusText status={patientDetail.status} />
                      </div>
                      <div className="text-xs text-slate-500 mt-1 space-x-2">
                        <span>{patientDetail.age ? `${patientDetail.age} yrs` : 'Age N/A'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{patientDetail.gender}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{patientDetail.phone}</span>
                        <span aria-hidden="true">·</span>
                        <span>Language: {patientDetail.language}</span>
                        {patientDetail.account && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">Login: {patientDetail.account.username}</span>
                          </>
                        )}
                      </div>
                      {patientDetail.emergency_contact_name && (
                        <div className="text-xs text-slate-500 mt-1">
                          Emergency Contact (emergencies only): {patientDetail.emergency_contact_name} (
                          {patientDetail.emergency_contact_relation}) ·{' '}
                          <span className="tabular-nums">{patientDetail.emergency_contact_phone}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleResetPatientPassword(patientDetail.id)}
                        className="px-3.5 py-2 text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Reset Patient Password
                      </button>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleSendTestReminder(patientDetail.id)}
                        className="px-3.5 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send {patientDetail.language} Reminder
                      </button>
                    </div>
                  </div>

                  {/* Sub-Navigation Tabs */}
                  <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
                    {(
                      [
                        ['careplan', 'Care Plan'],
                        ['medications', `Prescriptions (${patientMeds.length})`],
                        ['nurses', 'Nurse & Follow-up'],
                        ['readings', `Readings (${patientReadings.length})`],
                        ['notifications', `Reminders (${patientAlerts.length})`],
                        ['documents', `Documents (${patientDocs.length})`],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPatientSubTab(id)}
                        className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          patientSubTab === id
                            ? 'border-teal-700 text-teal-800'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="p-5">
                    {/* CARE PLAN TAB */}
                    {patientSubTab === 'careplan' && (
                      <form onSubmit={handleUpdateCarePlan} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Recovery Status</label>
                            <select
                              value={carePlanEdit.status}
                              onChange={(e) =>
                                setCarePlanEdit({ ...carePlanEdit, status: e.target.value as Patient['status'] })
                              }
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                            >
                              <option value="Monitoring">Monitoring</option>
                              <option value="Attention Required">Attention Required</option>
                              <option value="Stable">Stable</option>
                              <option value="Discharged">Discharged</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Monitoring Frequency
                            </label>
                            <select
                              value={carePlanEdit.monitoring_frequency}
                              onChange={(e) =>
                                setCarePlanEdit({
                                  ...carePlanEdit,
                                  monitoring_frequency: e.target.value as Patient['monitoring_frequency'],
                                })
                              }
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="fortnightly">Fortnightly</option>
                              <option value="as_needed">As Needed</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Reminder Language
                            </label>
                            <select
                              value={carePlanEdit.language}
                              onChange={(e) =>
                                setCarePlanEdit({
                                  ...carePlanEdit,
                                  language: e.target.value as SupportedLanguage,
                                })
                              }
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                            >
                              <option value="English">English</option>
                              <option value="Tamil">Tamil</option>
                              <option value="Malayalam">Malayalam</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Patient Phone (WhatsApp & Voice)
                            </label>
                            <input
                              value={carePlanEdit.phone}
                              onChange={(e) => setCarePlanEdit({ ...carePlanEdit, phone: e.target.value })}
                              placeholder="+91 98000 00000"
                              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Diagnosis</label>
                            <input
                              value={carePlanEdit.diagnosis}
                              onChange={(e) => setCarePlanEdit({ ...carePlanEdit, diagnosis: e.target.value })}
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Discharge & Care Instructions
                          </label>
                          <textarea
                            rows={3}
                            value={carePlanEdit.discharge_instructions}
                            onChange={(e) =>
                              setCarePlanEdit({ ...carePlanEdit, discharge_instructions: e.target.value })
                            }
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Warning Signs (When to Seek Urgent Care)
                          </label>
                          <textarea
                            rows={2}
                            value={carePlanEdit.warning_signs}
                            onChange={(e) => setCarePlanEdit({ ...carePlanEdit, warning_signs: e.target.value })}
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                          />
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={busyAction}
                            className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
                          >
                            Save Treatment & Monitoring Plan
                          </button>
                        </div>
                      </form>
                    )}

                    {/* MEDICATIONS TAB */}
                    {patientSubTab === 'medications' && (
                      <div className="space-y-6">
                        <form
                          onSubmit={handleAddMedication}
                          className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
                        >
                          <h3 className="text-xs font-bold text-slate-900">Prescribe New Medication</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <input
                              required
                              placeholder="Medicine name"
                              value={medForm.name}
                              onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
                              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                            <input
                              required
                              placeholder="Dosage (e.g. 1 tablet / 500 mg)"
                              value={medForm.dosage}
                              onChange={(e) => setMedForm({ ...medForm, dosage: e.target.value })}
                              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                            <select
                              value={medForm.frequency}
                              onChange={(e) => {
                                const freq = e.target.value;
                                const preset =
                                  freq === 'Once daily'
                                    ? '08:00'
                                    : freq === 'Three times daily'
                                    ? '08:00, 14:00, 20:00'
                                    : '08:00, 20:00';
                                setMedForm({ ...medForm, frequency: freq, timings: preset });
                              }}
                              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                            >
                              <option value="Once daily">Once daily</option>
                              <option value="Twice daily">Twice daily</option>
                              <option value="Three times daily">Three times daily</option>
                              <option value="Custom">Custom</option>
                            </select>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                Reminder Timings (24h HH:MM)
                              </label>
                              <input
                                required
                                value={medForm.timings}
                                onChange={(e) => setMedForm({ ...medForm, timings: e.target.value })}
                                placeholder="08:00, 20:00"
                                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">Start Date</label>
                              <input
                                type="date"
                                required
                                value={medForm.start_date}
                                onChange={(e) => setMedForm({ ...medForm, start_date: e.target.value })}
                                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">End Date</label>
                              <input
                                type="date"
                                required
                                value={medForm.end_date}
                                onChange={(e) => setMedForm({ ...medForm, end_date: e.target.value })}
                                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <input
                              placeholder="Doctor instructions (e.g. Take after meals)"
                              value={medForm.instructions}
                              onChange={(e) => setMedForm({ ...medForm, instructions: e.target.value })}
                              className="flex-1 min-w-[200px] px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                            <button
                              type="submit"
                              disabled={busyAction}
                              className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Prescription & Generate Schedules
                            </button>
                          </div>
                        </form>

                        <div>
                          <h4 className="text-xs font-bold text-slate-800 mb-2">Active Prescriptions</h4>
                          {patientMeds.length === 0 ? (
                            <p className="text-xs text-slate-500">No prescriptions added yet.</p>
                          ) : (
                            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                              {patientMeds.map((m) => (
                                <div key={m.id} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {m.name} · <span className="font-normal text-slate-600">{m.dosage}</span>
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                                      {m.frequency} · Timings: {JSON.parse(m.timings || '[]').join(', ')} · {m.start_date}{' '}
                                      to {m.end_date}
                                    </div>
                                    {m.instructions && (
                                      <div className="text-xs text-slate-600 mt-0.5">{m.instructions}</div>
                                    )}
                                  </div>
                                  <span
                                    className={`text-xs font-semibold ${
                                      m.is_active ? 'text-emerald-700' : 'text-slate-400'
                                    }`}
                                  >
                                    {m.is_active ? 'Active & Verified' : 'Inactive'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <h4 className="text-xs font-bold text-slate-800 mb-2">
                            Upcoming Reminder Schedule ({patientSchedules.length} slots)
                          </h4>
                          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                            {patientSchedules.slice(0, 14).map((s) => (
                              <div key={s.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                <div>
                                  <span className="font-semibold text-slate-900">{s.medication_name}</span>
                                  <span className="text-slate-500 ml-2 font-mono tabular-nums">
                                    {s.scheduled_date} {s.scheduled_time}
                                  </span>
                                </div>
                                <span
                                  className={`font-semibold ${
                                    s.status === 'Taken' || s.status === 'Acknowledged'
                                      ? 'text-emerald-700'
                                      : s.status === 'Missed'
                                      ? 'text-red-700'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  {s.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {patientMedLogs.length > 0 && (
                          <div>
                            <h4 className="text-xs font-bold text-slate-800 mb-2">
                              Acknowledgement vs Intake History
                            </h4>
                            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto">
                              {patientMedLogs.map((l) => (
                                <div key={l.id} className="px-3.5 py-2 flex items-center justify-between text-xs">
                                  <div>
                                    <span className="font-semibold text-slate-800">{l.medication_name}</span>
                                    <span className="text-slate-500 ml-2">{l.notes}</span>
                                  </div>
                                  <span className="font-mono text-[11px] text-slate-600 whitespace-nowrap">
                                    {l.status} · {new Date(l.recorded_at).toLocaleDateString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* NURSE ASSIGNMENT TAB */}
                    {patientSubTab === 'nurses' && (
                      <div className="space-y-6">
                        <form
                          onSubmit={handleAssignNurse}
                          className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
                        >
                          <h3 className="text-xs font-bold text-slate-900">Assign Nurse & Monitoring Schedule</h3>
                          {nurses.length === 0 ? (
                            <p className="text-xs text-amber-800">
                              No nurse accounts registered yet. Ask a nurse to register via the Nurse Portal tab on the sign-in screen.
                            </p>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <select
                                  required
                                  value={assignForm.nurse_id}
                                  onChange={(e) => setAssignForm({ ...assignForm, nurse_id: e.target.value })}
                                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                                >
                                  <option value="">Select Nurse</option>
                                  {nurses.map((n) => (
                                    <option key={n.id} value={n.id}>
                                      {n.name} ({n.assigned_count} assigned)
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={assignForm.monitoring_frequency}
                                  onChange={(e) =>
                                    setAssignForm({ ...assignForm, monitoring_frequency: e.target.value })
                                  }
                                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                                >
                                  <option value="daily">Daily follow-up</option>
                                  <option value="weekly">Weekly follow-up</option>
                                  <option value="fortnightly">Fortnightly follow-up</option>
                                </select>
                                <input
                                  type="datetime-local"
                                  value={assignForm.first_visit_at}
                                  onChange={(e) => setAssignForm({ ...assignForm, first_visit_at: e.target.value })}
                                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                                />
                              </div>
                              <div className="flex flex-wrap gap-3">
                                <input
                                  placeholder="Instructions for nurse (e.g. Check BP & surgical wound)"
                                  value={assignForm.instructions}
                                  onChange={(e) => setAssignForm({ ...assignForm, instructions: e.target.value })}
                                  className="flex-1 min-w-[200px] px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                                />
                                <button
                                  type="submit"
                                  disabled={busyAction}
                                  className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
                                >
                                  Assign Nurse
                                </button>
                              </div>
                            </>
                          )}
                        </form>

                        <div>
                          <h4 className="text-xs font-bold text-slate-800 mb-2">Currently Assigned Nurses</h4>
                          {!patientDetail.assigned_nurses?.length ? (
                            <p className="text-xs text-slate-500">No nurses currently assigned to this patient.</p>
                          ) : (
                            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                              {patientDetail.assigned_nurses.map((n) => (
                                <div key={n.id} className="p-3.5 flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">{n.name}</div>
                                    <div className="text-xs text-slate-500">
                                      {n.qualification} · {n.phone} · {n.monitoring_frequency} monitoring
                                    </div>
                                    {n.instructions && (
                                      <div className="text-xs text-slate-600 mt-0.5">{n.instructions}</div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleUnassignNurse(n.id)}
                                    className="text-xs font-semibold text-red-700 hover:underline cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* READINGS & RECOVERY TAB */}
                    {patientSubTab === 'readings' && (
                      <div className="space-y-5">
                        <VitalsChart readings={patientReadings} title={`${patientDetail.name} — Recovery Trends`} />

                        <div>
                          <h4 className="text-xs font-bold text-slate-800 mb-2">
                            Nurse & Patient Recorded Observations
                          </h4>
                          {patientReadings.length === 0 ? (
                            <p className="text-xs text-slate-500">No observations recorded yet.</p>
                          ) : (
                            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                              {[...patientReadings].reverse().map((r) => (
                                <div key={r.id} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold text-slate-900">{r.metric}:</span>
                                      <span className="font-mono text-sm font-bold text-teal-800 tabular-nums">
                                        {r.value} {r.unit}
                                      </span>
                                      {Boolean(r.flagged_for_doctor) && (
                                        <span className="text-xs font-semibold text-red-700">Flagged for Review</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                      Recorded by {r.recorded_by_name} ({r.recorded_by_role}) ·{' '}
                                      {new Date(r.recorded_at).toLocaleString()}
                                    </div>
                                    {r.notes && <div className="text-xs text-slate-600 mt-0.5">{r.notes}</div>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-slate-600">{r.review_status}</span>
                                    {r.review_status !== 'Reviewed' && (
                                      <button
                                        type="button"
                                        onClick={() => handleReviewReading(r.id, 'Reviewed')}
                                        className="px-2.5 py-1 text-xs font-semibold border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                                      >
                                        Mark Reviewed
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* NOTIFICATIONS & REMINDERS TAB */}
                    {patientSubTab === 'notifications' && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-xs text-slate-700">
                            Reminders are sent exclusively to patient phone{' '}
                            <span className="font-mono font-semibold">{patientDetail.phone}</span> in{' '}
                            <strong>{patientDetail.language}</strong>. Family contact is reserved for emergencies.
                          </div>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleSendTestReminder(patientDetail.id)}
                            className="px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 whitespace-nowrap cursor-pointer"
                          >
                            Dispatch Test Reminder Now
                          </button>
                        </div>

                        {patientAlerts.length === 0 ? (
                          <p className="text-xs text-slate-500">No alerts or reminder deliveries for this patient yet.</p>
                        ) : (
                          <div className="space-y-3">
                            {patientAlerts.map((al) => (
                              <div key={al.id} className="border border-slate-200 rounded-xl p-4 space-y-2.5">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">{al.title}</div>
                                    <div className="text-xs text-slate-500">
                                      {al.alert_type} · Severity: {al.severity} · Status: {al.status}
                                    </div>
                                  </div>
                                  {al.status !== 'Resolved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleResolveAlert(al.id)}
                                      className="px-2.5 py-1 text-xs font-semibold border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                                    >
                                      Resolve Alert
                                    </button>
                                  )}
                                </div>
                                <p className="text-xs text-slate-700">{al.message}</p>
                                {al.deliveries && al.deliveries.length > 0 && (
                                  <div className="border-t border-slate-100 pt-2.5 space-y-2">
                                    {al.deliveries.map((d) => (
                                      <div
                                        key={d.id}
                                        className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2"
                                      >
                                        <div>
                                          <span className="font-semibold text-slate-800">{d.channel}</span>
                                          <span className="text-slate-500 ml-2">
                                            {d.language} · {d.recipient_phone} · Attempt {d.attempt_number}/
                                            {d.max_attempts}
                                          </span>
                                          {d.error_message && (
                                            <div className="text-[11px] text-amber-700 mt-0.5">{d.error_message}</div>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-[11px] font-semibold text-slate-700">
                                            {d.status} · {d.confirmation_status}
                                          </span>
                                          {d.channel === 'Voice' &&
                                            d.confirmation_status === 'Awaiting' && (
                                              <button
                                                type="button"
                                                onClick={() => handleSimulateVoiceRetry(d.id)}
                                                className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                                              >
                                                {d.attempt_number < d.max_attempts
                                                  ? `Retry (${d.attempt_number + 1}/3)`
                                                  : 'Trigger Escalation'}
                                              </button>
                                            )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* DOCUMENTS TAB */}
                    {patientSubTab === 'documents' && (
                      <div className="space-y-4">
                        <form onSubmit={handleUploadDoc} className="flex flex-wrap items-center gap-3">
                          <input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                            className="text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                          />
                          <button
                            type="submit"
                            disabled={!docFile || busyAction}
                            className="px-3.5 py-2 text-xs font-semibold bg-teal-700 disabled:bg-slate-300 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            Upload Record
                          </button>
                        </form>
                        {patientDocs.length === 0 ? (
                          <p className="text-xs text-slate-500">No medical documents uploaded yet.</p>
                        ) : (
                          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                            {patientDocs.map((doc) => (
                              <div key={doc.id} className="p-3 flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-slate-400" />
                                  <span className="font-medium text-slate-800">{doc.original_name}</span>
                                </div>
                                <span className="text-slate-500 tabular-nums">
                                  {Math.round(doc.size_bytes / 1024)} KB ·{' '}
                                  {new Date(doc.uploaded_at).toLocaleDateString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* APPOINTMENTS & FOLLOW-UPS TAB */}
      {tab === 'appointments' && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Follow-Up Schedule & Nurse Visits</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Schedule clinician follow-ups and monitor home-care nurse visit completion
            </p>
          </div>

          <form
            onSubmit={handleCreateAppointment}
            className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Patient</label>
              <select
                required
                value={apptForm.patient_id}
                onChange={(e) => setApptForm({ ...apptForm, patient_id: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                <option value="">Choose patient</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.patient_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
              <select
                value={apptForm.appointment_type}
                onChange={(e) => setApptForm({ ...apptForm, appointment_type: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                <option value="Doctor Follow-up">Doctor Follow-up</option>
                <option value="Teleconsultation">Teleconsultation</option>
                <option value="Lab Review">Lab Review</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date & Time</label>
              <input
                type="datetime-local"
                required
                value={apptForm.appointment_date}
                onChange={(e) => setApptForm({ ...apptForm, appointment_date: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
              <input
                placeholder="Review wound & BP"
                value={apptForm.notes}
                onChange={(e) => setApptForm({ ...apptForm, notes: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={busyAction}
              className="py-2 px-4 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Schedule Follow-Up
            </button>
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Doctor Appointments</h2>
              {appointments.length === 0 ? (
                <p className="text-xs text-slate-500">No appointments scheduled.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {appointments.map((a) => (
                    <div key={a.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {a.patient_name} · {a.appointment_type}
                        </div>
                        <div className="text-slate-500 mt-0.5 tabular-nums">
                          {new Date(a.appointment_date).toLocaleString()} · {a.notes || a.provider}
                        </div>
                      </div>
                      <span className="font-semibold text-slate-700">{a.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Nurse Home / Tele Follow-Up Visits</h2>
              {followups.length === 0 ? (
                <p className="text-xs text-slate-500">No nurse follow-up visits scheduled.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {followups.map((f) => (
                    <div key={f.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {f.patient_name} · Assigned: {f.nurse_name}
                        </div>
                        <div className="text-slate-500 mt-0.5 tabular-nums">
                          {new Date(f.scheduled_at).toLocaleString()} · {f.visit_notes}
                        </div>
                        {Boolean(f.flagged_for_doctor) && (
                          <div className="text-red-700 font-semibold mt-1">Flagged: {f.flag_reason}</div>
                        )}
                      </div>
                      <span
                        className={`font-semibold shrink-0 ${
                          f.status === 'Completed'
                            ? 'text-emerald-700'
                            : f.status === 'Overdue' || f.status === 'Missed'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ALERTS & NOTIFICATION DELIVERIES TAB */}
      {tab === 'alerts' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Medication Reminders & Escalation Console
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Track WhatsApp and Voice delivery status, 3-attempt retries, and clinical escalation alerts
              </p>
            </div>
            <button
              type="button"
              disabled={busyAction}
              onClick={handleProcessScheduler}
              className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Run Due Reminder Cycle
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-2">
            <span>
              <strong>WhatsApp Cloud API:</strong>{' '}
              {summary?.providers.whatsapp.configured
                ? 'Configured (Live Meta Graph API)'
                : 'Sandbox Simulation (set META_WHATSAPP_ACCESS_TOKEN & META_WHATSAPP_PHONE_NUMBER_ID for live delivery)'}
            </span>
            <span>
              <strong>Twilio Voice API:</strong>{' '}
              {summary?.providers.voice.configured
                ? 'Configured (Live Twilio Voice + DTMF)'
                : 'Sandbox Simulation (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN & TWILIO_PHONE_NUMBER for live calls)'}
            </span>
          </div>

          <div className="space-y-3">
            {alerts.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
                No reminders or alerts generated yet.
              </div>
            ) : (
              alerts.map((al) => (
                <div key={al.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{al.title}</span>
                        <span className="font-mono text-[11px] text-slate-500">{al.patient_code}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {al.patient_name} · {al.alert_type} · Severity: {al.severity} · Status: {al.status}
                      </div>
                    </div>
                    {al.status !== 'Resolved' && (
                      <button
                        type="button"
                        onClick={() => handleResolveAlert(al.id)}
                        className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        Mark Resolved
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-700">{al.message}</p>
                  {al.deliveries && al.deliveries.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                      {al.deliveries.map((d) => (
                        <div
                          key={d.id}
                          className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              {d.channel === 'Voice' ? (
                                <PhoneCall className="w-3.5 h-3.5 text-teal-700" />
                              ) : (
                                <Bell className="w-3.5 h-3.5 text-emerald-700" />
                              )}
                              {d.channel} · {d.language}
                            </div>
                            <div className="text-slate-500 mt-0.5 tabular-nums">
                              To: {d.recipient_phone} · Attempt {d.attempt_number}/{d.max_attempts}
                            </div>
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              Delivery: <strong>{d.status}</strong> · Confirmation:{' '}
                              <strong>{d.confirmation_status}</strong>
                              {d.provider_reference ? ` · Ref: ${d.provider_reference}` : ''}
                            </div>
                            {d.error_message && (
                              <div className="text-[11px] text-rose-700 font-medium mt-1">
                                {d.error_message}
                              </div>
                            )}
                          </div>
                          {d.channel === 'Voice' && d.confirmation_status === 'Awaiting' && (
                            <button
                              type="button"
                              onClick={() => handleSimulateVoiceRetry(d.id)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap cursor-pointer"
                            >
                              {d.attempt_number < d.max_attempts ? `Retry (${d.attempt_number + 1}/3)` : 'Escalate'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* AUDIT LOGS TAB */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Clinical & Security Audit Trail</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Immutable record of patient onboarding, prescription updates, nurse assignments, and alerts
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                    <th className="py-2.5 px-4 font-semibold">Actor</th>
                    <th className="py-2.5 px-4 font-semibold">Action</th>
                    <th className="py-2.5 px-4 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className="font-semibold text-slate-800">{log.username}</span>{' '}
                        <span className="text-slate-500">({log.role})</span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-teal-800 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* REGISTER PATIENT MODAL */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleRegisterPatient}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Register Discharged Patient</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically creates a unique Patient portal account with a one-time temporary password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Full Name *</label>
                <input
                  required
                  value={regForm.name}
                  onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                  placeholder="Enter patient name"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Age</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={regForm.age}
                  onChange={(e) => setRegForm({ ...regForm, age: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Phone *</label>
                <input
                  required
                  value={regForm.phone}
                  onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                  placeholder="+91 98000 00001"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Preferred Language *</label>
                <select
                  value={regForm.language}
                  onChange={(e) => setRegForm({ ...regForm, language: e.target.value as SupportedLanguage })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="English">English</option>
                  <option value="Tamil">Tamil</option>
                  <option value="Malayalam">Malayalam</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Discharge Date</label>
                <input
                  type="date"
                  value={regForm.discharge_date}
                  onChange={(e) => setRegForm({ ...regForm, discharge_date: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency / Family Contact</label>
                <input
                  value={regForm.emergency_contact_name}
                  onChange={(e) => setRegForm({ ...regForm, emergency_contact_name: e.target.value })}
                  placeholder="Contact name"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Phone</label>
                <input
                  value={regForm.emergency_contact_phone}
                  onChange={(e) => setRegForm({ ...regForm, emergency_contact_phone: e.target.value })}
                  placeholder="+91 98000 00002"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Relationship</label>
                <input
                  value={regForm.emergency_contact_relation}
                  onChange={(e) => setRegForm({ ...regForm, emergency_contact_relation: e.target.value })}
                  placeholder="Son / Spouse"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Diagnosis</label>
                <input
                  value={regForm.diagnosis}
                  onChange={(e) => setRegForm({ ...regForm, diagnosis: e.target.value })}
                  placeholder="Primary discharge diagnosis"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Discharge Instructions</label>
                <textarea
                  rows={2}
                  value={regForm.discharge_instructions}
                  onChange={(e) => setRegForm({ ...regForm, discharge_instructions: e.target.value })}
                  placeholder="Home recovery instructions and precautions"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Monitoring Frequency</label>
                <select
                  value={regForm.monitoring_frequency}
                  onChange={(e) =>
                    setRegForm({
                      ...regForm,
                      monitoring_frequency: e.target.value as Patient['monitoring_frequency'],
                    })
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="as_needed">As Needed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Nurse (Optional)</label>
                <select
                  value={regForm.nurse_id}
                  onChange={(e) => setRegForm({ ...regForm, nurse_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Assign later</option>
                  {nurses.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                Clinician-Requested Health Measurements (select only what applies)
              </span>
              <div className="flex flex-wrap gap-3">
                {MONITORING_METRICS.map((metric) => {
                  const checked = regForm.monitoring_requirements.includes(metric);
                  return (
                    <label key={metric} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setRegForm((prev) => ({
                            ...prev,
                            monitoring_requirements: e.target.checked
                              ? [...prev.monitoring_requirements, metric]
                              : prev.monitoring_requirements.filter((m) => m !== metric),
                          }));
                        }}
                        className="accent-teal-700"
                      />
                      {metric}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-6 text-xs text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={regForm.opt_in_whatsapp}
                  onChange={(e) => setRegForm({ ...regForm, opt_in_whatsapp: e.target.checked })}
                  className="accent-teal-700"
                />
                Patient opted in to WhatsApp reminders
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={regForm.opt_in_voice}
                  onChange={(e) => setRegForm({ ...regForm, opt_in_voice: e.target.checked })}
                  className="accent-teal-700"
                />
                Patient opted in to automated voice reminders
              </label>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="px-4 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
              >
                {busyAction ? 'Creating Record & Account...' : 'Create Patient & Generate Login'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ONE-TIME CREDENTIALS MODAL */}
      {createdCreds && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2.5 text-teal-800">
              <KeyRound className="w-5 h-5" />
              <h2 className="text-base font-bold text-slate-900">One-Time Patient Login Credentials</h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{createdCreds.note}</p>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Patient Code</span>
                <span className="font-mono font-bold text-slate-900">{createdCreds.patient_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Patient Username</span>
                <span className="font-mono font-bold text-slate-900">{createdCreds.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Temporary Password</span>
                <span className="font-mono font-bold text-teal-800">{createdCreds.temporary_password}</span>
              </div>
            </div>

            {createdCreds.sample_nurse && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
                <div className="font-semibold text-slate-800">Sample Nurse Account (Fictional)</div>
                <div className="font-mono text-slate-700">
                  Username: {createdCreds.sample_nurse.username} · Password:{' '}
                  {createdCreds.sample_nurse.temporary_password}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  const text = `SmartCare Patient Login\nPatient Code: ${createdCreds.patient_code}\nUsername: ${createdCreds.username}\nTemporary Password: ${createdCreds.temporary_password}`;
                  void navigator.clipboard?.writeText(text);
                  setCopiedCreds(true);
                }}
                className="px-3.5 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedCreds ? 'Copied' : 'Copy Credentials'}
              </button>
              <button
                type="button"
                onClick={() => setCreatedCreds(null)}
                className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Activity;
  tone?: 'neutral' | 'teal' | 'danger';
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <Icon
          className={`w-4 h-4 ${
            tone === 'danger' ? 'text-red-600' : tone === 'teal' ? 'text-teal-700' : 'text-slate-400'
          }`}
        />
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{detail}</div>
    </div>
  );
}

function StatusText({ status }: { status: string }) {
  const color =
    status === 'Attention Required'
      ? 'text-red-700'
      : status === 'Stable'
      ? 'text-emerald-700'
      : 'text-teal-700';
  return <span className={`text-xs font-semibold whitespace-nowrap ${color}`}>{status}</span>;
}
