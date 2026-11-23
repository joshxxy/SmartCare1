import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  KeyRound,
  Phone,
  ShieldAlert,
  Stethoscope,
  Upload,
  UserCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { UI_COPY } from '../lib/i18n';
import type {
  AlertItem,
  Appointment,
  AssignedNurseInfo,
  DashboardSummary,
  FollowUpVisit,
  HealthReading,
  Medication,
  MedicationLog,
  MedicationSchedule,
  Patient,
  PatientDocument,
  Session,
  SupportedLanguage,
} from '../types';
import { VitalsChart } from './VitalsChart';

export type PatientTab = 'overview' | 'medications' | 'appointments' | 'readings' | 'alerts' | 'settings';

interface PatientPortalProps {
  tab: PatientTab;
  setTab: (tab: PatientTab) => void;
  session: Session;
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  onPasswordChanged: () => void;
  onNotice: (msg: string) => void;
}

export function PatientPortal({
  tab,
  setTab,
  session,
  language,
  setLanguage,
  onPasswordChanged,
  onNotice,
}: PatientPortalProps) {
  const t = UI_COPY[language];
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [patient, setPatient] = useState<(Patient & { assigned_nurses?: AssignedNurseInfo[] }) | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLog[]>([]);
  const [readings, setReadings] = useState<HealthReading[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followups, setFollowups] = useState<FollowUpVisit[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // Password update form
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwBusy, setPwBusy] = useState(false);

  // Self-reading & document upload
  const [readingForm, setReadingForm] = useState({ metric: 'Blood Pressure', value: '', unit: 'mmHg', notes: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPatientWorkspace = useCallback(async () => {
    if (!session.patient_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const pid = session.patient_id;
      const [sumData, patData, medBundle, readData, apptData, fuData, alertData, docData] = await Promise.all([
        apiFetch<DashboardSummary>('/api/summary'),
        apiFetch<Patient & { assigned_nurses?: AssignedNurseInfo[] }>(`/api/patients/${pid}`),
        apiFetch<{ medications: Medication[]; schedules: MedicationSchedule[]; logs: MedicationLog[] }>(
          `/api/patients/${pid}/medications`
        ),
        apiFetch<HealthReading[]>(`/api/patients/${pid}/readings`),
        apiFetch<Appointment[]>('/api/appointments'),
        apiFetch<FollowUpVisit[]>('/api/follow-ups'),
        apiFetch<AlertItem[]>(`/api/patients/${pid}/alerts`),
        apiFetch<PatientDocument[]>(`/api/patients/${pid}/documents`),
      ]);
      setSummary(sumData);
      setPatient(patData);
      setMedications(medBundle.medications);
      setSchedules(medBundle.schedules);
      setMedLogs(medBundle.logs);
      setReadings(readData);
      setAppointments(apptData);
      setFollowups(fuData);
      setAlerts(alertData);
      setDocuments(docData);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Unable to load your recovery records.');
    } finally {
      setLoading(false);
    }
  }, [session.patient_id, onNotice]);

  useEffect(() => {
    void loadPatientWorkspace();
  }, [loadPatientWorkspace]);

  async function handleAcknowledgeSchedule(scheduleId: number) {
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string }>(`/api/schedules/${scheduleId}/acknowledge`, {
        method: 'POST',
      });
      await loadPatientWorkspace();
      onNotice(res.message);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not acknowledge reminder.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogDoseTaken(medicationId: number, scheduleId?: number) {
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/medication-logs', {
        method: 'POST',
        body: JSON.stringify({
          medication_id: medicationId,
          schedule_id: scheduleId ?? null,
          action_type: 'verified_intake',
        }),
      });
      await loadPatientWorkspace();
      onNotice(res.message);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not record dose.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmAlert(alertId: number) {
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string }>(`/api/alerts/${alertId}/confirm`, {
        method: 'POST',
      });
      await loadPatientWorkspace();
      onNotice(res.message);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not confirm alert.');
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (pwForm.new_password !== pwForm.confirm_password) {
      onNotice('New password and confirmation do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: pwForm.current_password,
          new_password: pwForm.new_password,
        }),
      });
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
      onPasswordChanged();
      onNotice('Your account password has been updated securely.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setPwBusy(false);
    }
  }

  async function handleAddSelfReading(e: FormEvent) {
    e.preventDefault();
    if (!patient) return;
    setBusy(true);
    try {
      await apiFetch('/api/readings', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: patient.id,
          metric: readingForm.metric,
          value: readingForm.value,
          unit: readingForm.unit,
          notes: readingForm.notes,
        }),
      });
      setReadingForm({ ...readingForm, value: '', notes: '' });
      await loadPatientWorkspace();
      onNotice('Health reading saved to your recovery record.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not save reading.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadDoc(e: FormEvent) {
    e.preventDefault();
    if (!patient || !docFile) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', docFile);
      fd.append('document_type', 'Patient Uploaded Report');
      await apiFetch(`/api/documents/upload?patient_id=${patient.id}`, {
        method: 'POST',
        body: fd,
      });
      setDocFile(null);
      await loadPatientWorkspace();
      onNotice('Document uploaded to your medical folder.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Document upload failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !patient) {
    return (
      <div className="space-y-4">
        <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">No linked patient profile found for this account.</p>
      </div>
    );
  }

  const nextReminder = schedules.find((s) => s.status === 'Scheduled' || s.status === 'Reminder Sent');
  const openAlerts = alerts.filter((a) => a.status === 'Open');

  return (
    <div className="space-y-6">
      {/* First-login mandatory password change prompt */}
      {session.must_change_password && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <KeyRound className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-950">
                Action Required: Change Your Temporary Password
              </div>
              <p className="text-xs text-amber-800 mt-0.5">
                Your account was provisioned with a one-time temporary password by your Doctor. Please set a private personal password now.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className="px-3.5 py-2 text-xs font-semibold bg-amber-800 hover:bg-amber-900 text-white rounded-lg whitespace-nowrap cursor-pointer"
          >
            Set New Password
          </button>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-teal-700">
                {patient.patient_code} · Preferred Reminders: {patient.language}
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
                {patient.name} — {t.welcomePatient}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Discharged {patient.discharge_date || 'Recently'} · {patient.monitoring_frequency} recovery monitoring
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Current Status</div>
              <div className="text-sm font-bold text-teal-800">{patient.status}</div>
            </div>
          </div>

          {/* Key Patient Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Next Medication Reminder */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Next Medication Reminder</span>
                  <ClipboardList className="w-4 h-4 text-teal-700" />
                </div>
                {nextReminder ? (
                  <div className="mt-3">
                    <div className="text-base font-bold text-slate-900">{nextReminder.medication_name}</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {nextReminder.dosage} ·{' '}
                      <span className="font-mono tabular-nums">
                        {nextReminder.scheduled_date} {nextReminder.scheduled_time}
                      </span>
                    </div>
                    <div className="text-xs text-teal-700 font-semibold mt-1">Status: {nextReminder.status}</div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-3">No pending medication slots right now.</p>
                )}
              </div>
              {nextReminder && (
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAcknowledgeSchedule(nextReminder.id)}
                    className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    {t.acknowledgeBtn}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleLogDoseTaken(nextReminder.medication_id, nextReminder.id)}
                    className="px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                  >
                    {t.logIntakeBtn}
                  </button>
                </div>
              )}
            </div>

            {/* Attending Doctor */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Attending Doctor</span>
                <Stethoscope className="w-4 h-4 text-slate-400" />
              </div>
              <div className="mt-3 space-y-1">
                <div className="text-base font-bold text-slate-900">{patient.doctor_name}</div>
                <div className="text-xs text-slate-600">{patient.doctor_specialty}</div>
                <div className="text-xs text-slate-500">{patient.doctor_hospital}</div>
                {patient.doctor_phone && (
                  <div className="text-xs font-mono text-teal-800 pt-1 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    {patient.doctor_phone}
                  </div>
                )}
              </div>
            </div>

            {/* Assigned Nurse */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Assigned Care Nurse</span>
                <UserCheck className="w-4 h-4 text-slate-400" />
              </div>
              {patient.assigned_nurses && patient.assigned_nurses.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {patient.assigned_nurses.map((n) => (
                    <div key={n.id}>
                      <div className="text-base font-bold text-slate-900">{n.name}</div>
                      <div className="text-xs text-slate-600">
                        {n.qualification} · {n.monitoring_frequency} check-ins
                      </div>
                      {n.phone && <div className="text-xs font-mono text-teal-800 mt-0.5">{n.phone}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-3">Nurse assignment pending from your doctor.</p>
              )}
            </div>
          </div>

          {/* Diagnosis & Discharge Instructions */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">Diagnosis & Post-Discharge Care Instructions</h2>
              <span className="text-xs text-slate-500 tabular-nums">
                Adherence rate: <strong className="text-teal-800">{summary?.adherence ?? 0}%</strong>
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <div>
                  <span className="font-semibold text-slate-700">Diagnosis: </span>
                  <span className="text-slate-600">{patient.diagnosis || 'Post-discharge monitoring'}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Care Instructions: </span>
                  <span className="text-slate-600 leading-relaxed">
                    {patient.discharge_instructions || 'Follow prescribed medication schedule and rest.'}
                  </span>
                </div>
                {patient.dietary_guidelines && (
                  <div>
                    <span className="font-semibold text-slate-700">Dietary Notes: </span>
                    <span className="text-slate-600">{patient.dietary_guidelines}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {patient.warning_signs && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900">
                    <div className="font-semibold flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-red-700" />
                      Warning Signs — Contact Care Team Immediately
                    </div>
                    <p className="mt-1 leading-relaxed">{patient.warning_signs}</p>
                  </div>
                )}
                {patient.emergency_contact_name && (
                  <div className="text-slate-600">
                    <span className="font-semibold text-slate-700">Emergency Contact: </span>
                    {patient.emergency_contact_name} ({patient.emergency_contact_relation}) ·{' '}
                    <span className="font-mono">{patient.emergency_contact_phone}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Open Reminders Banner */}
          {openAlerts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Important Notifications ({openAlerts.length})</h2>
                <button
                  type="button"
                  onClick={() => setTab('alerts')}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  View all notifications
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {openAlerts.slice(0, 3).map((al) => (
                  <div key={al.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{al.title}</div>
                      <p className="text-xs text-slate-600 mt-0.5">{al.message}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleConfirmAlert(al.id)}
                      className="px-3 py-1.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      {t.acknowledgeBtn}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <VitalsChart readings={readings} title="Your Health Readings & Recovery Progress" />
        </>
      )}

      {/* MEDICATIONS TAB */}
      {tab === 'medications' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Your Prescribed Medications</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Reminder acknowledgement confirms you saw or heard the alert; logging dose taken records self-reported intake separately.
            </p>
          </div>

          {/* Prescriptions */}
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {medications.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No medications prescribed yet.</div>
            ) : (
              medications.map((m) => (
                <div key={m.id} className="p-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold text-slate-900">{m.name}</span>
                      <span className="text-xs font-semibold text-teal-800">{m.dosage}</span>
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      Frequency: <strong>{m.frequency}</strong> · Timings:{' '}
                      <strong>{JSON.parse(m.timings || '[]').join(', ')}</strong>
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      Duration: {m.start_date} to {m.end_date} · Prescribed by {m.doctor_name}
                    </div>
                    {m.instructions && (
                      <div className="text-xs text-slate-700 pt-1">
                        Doctor Instructions: {m.instructions}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-700">
                      {m.verified_by_clinician ? 'Clinician Verified' : 'Pending Verification'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Schedule Timeline */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Medication Schedule & Reminder Acknowledgement</h2>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {schedules.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">No scheduled doses yet.</p>
              ) : (
                schedules.map((s) => (
                  <div key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {s.medication_name} · {s.dosage}
                      </div>
                      <div className="font-mono text-slate-500 mt-0.5 tabular-nums">
                        {s.scheduled_date} at {s.scheduled_time}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-semibold mr-2 ${
                          s.status === 'Taken'
                            ? 'text-emerald-700'
                            : s.status === 'Acknowledged'
                            ? 'text-teal-700'
                            : s.status === 'Missed'
                            ? 'text-red-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {s.status}
                      </span>
                      {(s.status === 'Scheduled' || s.status === 'Reminder Sent') && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAcknowledgeSchedule(s.id)}
                            className="px-3 py-1.5 font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                          >
                            {t.acknowledgeBtn}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleLogDoseTaken(s.medication_id, s.id)}
                            className="px-3 py-1.5 font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                          >
                            {t.logIntakeBtn}
                          </button>
                        </>
                      )}
                      {s.status === 'Acknowledged' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleLogDoseTaken(s.medication_id, s.id)}
                          className="px-3 py-1.5 font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                        >
                          {t.logIntakeBtn}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Acknowledgement vs Intake Log History */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Acknowledgement & Dose Log History</h2>
            {medLogs.length === 0 ? (
              <p className="text-xs text-slate-500">No medication confirmations recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {medLogs.map((l) => (
                  <div key={l.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{l.medication_name}</span>
                      <span className="text-slate-500 ml-2">{l.notes}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                      {l.status} · {new Date(l.recorded_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* APPOINTMENTS TAB */}
      {tab === 'appointments' && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Appointments & Nurse Visits</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Your upcoming clinician consultations and scheduled nurse follow-up visits
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-teal-700" />
                Doctor Appointments
              </h2>
              {appointments.length === 0 ? (
                <p className="text-xs text-slate-500">No appointments scheduled.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {appointments.map((a) => (
                    <div key={a.id} className="py-3 flex justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">{a.appointment_type}</div>
                        <div className="text-slate-500 mt-0.5 tabular-nums">
                          {new Date(a.appointment_date).toLocaleString()} · {a.provider}
                        </div>
                        {a.notes && <div className="text-slate-600 mt-0.5">{a.notes}</div>}
                      </div>
                      <span className="font-semibold text-teal-800">{a.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-teal-700" />
                Nurse Home / Tele Follow-Ups
              </h2>
              {followups.length === 0 ? (
                <p className="text-xs text-slate-500">No nurse visits scheduled yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {followups.map((f) => (
                    <div key={f.id} className="py-3 flex justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">{f.nurse_name}</div>
                        <div className="text-slate-500 mt-0.5 tabular-nums">
                          {new Date(f.scheduled_at).toLocaleString()} · {f.visit_notes}
                        </div>
                      </div>
                      <span className="font-semibold text-slate-700">{f.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* HEALTH READINGS & DOCUMENTS TAB */}
      {tab === 'readings' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Health Readings & Medical Reports</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Track your recovery measurements and share home reports with your care team
            </p>
          </div>

          <VitalsChart readings={readings} title="Recovery Vitals Trend" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <form
              onSubmit={handleAddSelfReading}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
            >
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-700" />
                Log Home Health Reading
              </h2>
              <div className="grid grid-cols-3 gap-2.5">
                <select
                  value={readingForm.metric}
                  onChange={(e) => {
                    const m = e.target.value;
                    const unit =
                      m === 'Blood Pressure'
                        ? 'mmHg'
                        : m === 'Blood Sugar'
                        ? 'mg/dL'
                        : m === 'SpO2'
                        ? '%'
                        : m === 'Temperature'
                        ? '°F'
                        : 'bpm';
                    setReadingForm({ ...readingForm, metric: m, unit });
                  }}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="Blood Pressure">Blood Pressure</option>
                  <option value="Blood Sugar">Blood Sugar</option>
                  <option value="SpO2">SpO2</option>
                  <option value="Temperature">Temperature</option>
                  <option value="Heart Rate">Heart Rate</option>
                </select>
                <input
                  required
                  value={readingForm.value}
                  onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })}
                  placeholder={readingForm.metric === 'Blood Pressure' ? '120/80' : 'Value'}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  value={readingForm.unit}
                  onChange={(e) => setReadingForm({ ...readingForm, unit: e.target.value })}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <input
                placeholder="Optional note (e.g. Fasting morning reading)"
                value={readingForm.notes}
                onChange={(e) => setReadingForm({ ...readingForm, notes: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
              >
                Save Reading
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal-700" />
                Upload Medical Reports
              </h2>
              <form onSubmit={handleUploadDoc} className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                  className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100"
                />
                <button
                  type="submit"
                  disabled={!docFile || busy}
                  className="px-3.5 py-2 text-xs font-semibold bg-teal-700 disabled:bg-slate-300 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload
                </button>
              </form>
              <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {documents.map((d) => (
                  <div key={d.id} className="py-2 flex justify-between text-xs">
                    <span className="text-slate-800 font-medium">{d.original_name}</span>
                    <span className="text-slate-500 tabular-nums">
                      {new Date(d.uploaded_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Reading History</h2>
            {readings.length === 0 ? (
              <p className="text-xs text-slate-500">No readings recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {[...readings].reverse().map((r) => (
                  <div key={r.id} className="py-2.5 flex flex-wrap justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{r.metric}: </span>
                      <span className="font-mono font-bold text-teal-800 tabular-nums">
                        {r.value} {r.unit}
                      </span>
                      <span className="text-slate-500 ml-2">
                        Recorded by {r.recorded_by_name} · {r.notes}
                      </span>
                    </div>
                    <span className="text-slate-500 tabular-nums">{new Date(r.recorded_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ALERTS / NOTIFICATIONS TAB */}
      {tab === 'alerts' && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Notification Center</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              WhatsApp and automated voice reminder status in {patient.language}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="text-xs font-semibold text-slate-500">{t.medReminderTitle} ({language} preview)</div>
            <p className="text-xs text-slate-700 leading-relaxed">{t.medReminderSample}</p>
          </div>

          {alerts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              No reminder notifications yet.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((al) => (
                <div key={al.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <Bell className="w-4 h-4 text-teal-700" />
                        {al.title}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {al.alert_type} · Status: {al.status} · {new Date(al.created_at).toLocaleString()}
                      </div>
                    </div>
                    {al.status === 'Open' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleConfirmAlert(al.id)}
                        className="px-3 py-1.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
                      >
                        {t.acknowledgeBtn}
                      </button>
                    )}
                    {al.status !== 'Open' && (
                      <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {al.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700">{al.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PREFERENCES & SECURITY TAB */}
      {tab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Dashboard Language</h2>
            <p className="text-xs text-slate-500">
              Switch portal labels between English, Tamil, and Malayalam. Automated reminder language is managed on your patient profile ({patient.language}).
            </p>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
              className="w-full max-w-xs px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              <option value="English">English</option>
              <option value="Tamil">Tamil (தமிழ்)</option>
              <option value="Malayalam">Malayalam (മലയാളം)</option>
            </select>
          </div>

          <form
            onSubmit={handleChangePassword}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
          >
            <h2 className="text-base font-bold text-slate-900">Change Account Password</h2>
            <p className="text-xs text-slate-500">
              Signed in as <span className="font-mono font-semibold">{session.username}</span>.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={pwForm.current_password}
                onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                New Password (min 8 characters)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={pwForm.new_password}
                onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={pwForm.confirm_password}
                onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={pwBusy}
              className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
            >
              {pwBusy ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
