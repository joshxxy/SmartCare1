import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AlertItem,
  Appointment,
  DashboardSummary,
  FollowUpVisit,
  HealthReading,
  Medication,
  Patient,
  Session,
} from '../types';
import { VitalsChart } from './VitalsChart';

export type NurseTab = 'overview' | 'patients' | 'followups' | 'alerts';

interface NursePortalProps {
  tab: NurseTab;
  setTab: (tab: NurseTab) => void;
  session: Session;
  onNotice: (msg: string) => void;
}

export function NursePortal({ tab, setTab, onNotice }: NursePortalProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [followups, setFollowups] = useState<FollowUpVisit[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [patientDetail, setPatientDetail] = useState<Patient | null>(null);
  const [patientMeds, setPatientMeds] = useState<Medication[]>([]);
  const [patientReadings, setPatientReadings] = useState<HealthReading[]>([]);

  // Observation form
  const [obsForm, setObsForm] = useState({
    metric: 'Blood Pressure',
    value: '',
    unit: 'mmHg',
    notes: '',
    flagged_for_doctor: false,
    flag_reason: '',
  });
  const [visitNoteEdit, setVisitNoteEdit] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [sumData, patData, fuData, apptData, alertData] = await Promise.all([
        apiFetch<DashboardSummary>('/api/summary'),
        apiFetch<Patient[]>('/api/patients'),
        apiFetch<FollowUpVisit[]>('/api/follow-ups'),
        apiFetch<Appointment[]>('/api/appointments'),
        apiFetch<AlertItem[]>('/api/alerts'),
      ]);
      setSummary(sumData);
      setPatients(patData);
      setFollowups(fuData);
      setAppointments(apptData);
      setAlerts(alertData);
      if (patData.length > 0 && !selectedPatientId) {
        setSelectedPatientId(patData[0].id);
      }
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Unable to load nurse workspace.');
    } finally {
      setLoading(false);
    }
  }, [onNotice, selectedPatientId]);

  const loadAssignedPatient = useCallback(async (patientId: number) => {
    try {
      const [detail, medBundle, readData] = await Promise.all([
        apiFetch<Patient>(`/api/patients/${patientId}`),
        apiFetch<{ medications: Medication[] }>(`/api/patients/${patientId}/medications`),
        apiFetch<HealthReading[]>(`/api/patients/${patientId}/readings`),
      ]);
      setPatientDetail(detail);
      setPatientMeds(medBundle.medications);
      setPatientReadings(readData);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not load assigned patient.');
    }
  }, [onNotice]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (selectedPatientId) {
      void loadAssignedPatient(selectedPatientId);
    }
  }, [selectedPatientId, loadAssignedPatient]);

  async function handleRecordObservation(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) return;
    setBusy(true);
    try {
      await apiFetch('/api/readings', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: selectedPatientId,
          metric: obsForm.metric,
          value: obsForm.value,
          unit: obsForm.unit,
          notes: obsForm.notes,
          flagged_for_doctor: obsForm.flagged_for_doctor,
          flag_reason: obsForm.flag_reason,
        }),
      });
      setObsForm({
        metric: 'Blood Pressure',
        value: '',
        unit: 'mmHg',
        notes: '',
        flagged_for_doctor: false,
        flag_reason: '',
      });
      await Promise.all([loadAssignedPatient(selectedPatientId), loadWorkspace()]);
      onNotice(
        obsForm.flagged_for_doctor
          ? 'Observation recorded and flagged for immediate Doctor review.'
          : 'Observation recorded in patient chart.'
      );
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Failed to save observation.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateVisit(
    visitId: number,
    status: 'Completed' | 'Missed',
    flaggedForDoctor = false
  ) {
    setBusy(true);
    try {
      const note = visitNoteEdit[visitId] || '';
      await apiFetch(`/api/follow-ups/${visitId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          visit_notes: note || undefined,
          flagged_for_doctor: flaggedForDoctor || status === 'Missed',
          flag_reason:
            status === 'Missed'
              ? note || 'Patient missed scheduled nurse follow-up visit.'
              : flaggedForDoctor
              ? note || 'Nurse requested doctor review.'
              : '',
        }),
      });
      await loadWorkspace();
      onNotice(`Follow-up marked as ${status}.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not update follow-up visit.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveAlert(alertId: number) {
    try {
      await apiFetch(`/api/alerts/${alertId}/resolve`, { method: 'POST' });
      await loadWorkspace();
      onNotice('Alert resolved after nursing follow-up.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not resolve alert.');
    }
  }

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
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Nursing Care Overview</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Strictly scoped to patients assigned to you by attending doctors
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NurseKpi label="Assigned Patients" value={patients.length} detail="Active doctor assignments" icon={Users} />
            <NurseKpi
              label="Today's Follow-Ups"
              value={summary?.today_followups ?? 0}
              detail={`${summary?.pending_visits ?? 0} total pending visits`}
              icon={CalendarDays}
            />
            <NurseKpi
              label="Overdue Follow-Ups"
              value={summary?.overdue_followups ?? 0}
              detail="Requires prompt check-in"
              icon={Clock}
              danger={(summary?.overdue_followups ?? 0) > 0}
            />
            <NurseKpi
              label="Patients Requiring Attention"
              value={summary?.attention_required ?? 0}
              detail={`${summary?.open_alerts ?? 0} open alerts`}
              icon={AlertTriangle}
              danger={(summary?.attention_required ?? 0) > 0}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-900">Your Assigned Patients</h2>
                <button
                  type="button"
                  onClick={() => setTab('patients')}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  Record observations
                </button>
              </div>
              {patients.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 text-xs text-slate-500">
                  No patients have been assigned to your nurse profile yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {patients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPatientId(p.id);
                        setTab('patients');
                      }}
                      className="w-full py-3 px-2 flex items-center justify-between text-left hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {p.name} <span className="font-mono text-[11px] text-slate-500">{p.patient_code}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {p.monitoring_frequency} monitoring · {p.language} · {p.phone}
                        </div>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          p.status === 'Attention Required' ? 'text-red-700' : 'text-teal-700'
                        }`}
                      >
                        {p.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-900">Pending & Overdue Visits</h2>
                <button
                  type="button"
                  onClick={() => setTab('followups')}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  Manage visits
                </button>
              </div>
              {followups.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">No follow-up visits scheduled.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {followups.slice(0, 5).map((f) => (
                    <div key={f.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">{f.patient_name}</div>
                        <div className="text-slate-500 mt-0.5 tabular-nums">
                          {new Date(f.scheduled_at).toLocaleString()} · {f.visit_notes}
                        </div>
                      </div>
                      <span
                        className={`font-semibold ${
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

          <VitalsChart readings={summary?.readings || []} title="Recent Observations Across Assigned Patients" />
        </>
      )}

      {/* ASSIGNED PATIENTS & OBSERVATIONS TAB */}
      {tab === 'patients' && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Assigned Patients & Observations</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Record vitals, visit notes, and flag clinical concerns. Prescriptions remain read-only (Doctor-authorized).
            </p>
          </div>

          {patients.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              You have no assigned patients yet. Only doctors can assign patients to nurses.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-3 divide-y divide-slate-100">
                {patients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors cursor-pointer ${
                      selectedPatientId === p.id ? 'bg-teal-50/80 border border-teal-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                      <span className="font-mono text-[11px] text-slate-500">{p.patient_code}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {p.monitoring_frequency} · {p.diagnosis || 'Post-discharge care'}
                    </div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-8 space-y-5">
                {patientDetail && (
                  <>
                    {/* Patient Clinical Summary */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-lg font-bold text-slate-900">{patientDetail.name}</h2>
                        <span className="text-xs font-semibold text-teal-800">{patientDetail.status}</span>
                      </div>
                      <div className="text-xs text-slate-600">
                        Diagnosis: <strong>{patientDetail.diagnosis || 'Not specified'}</strong> · Doctor:{' '}
                        {patientDetail.doctor_name}
                      </div>
                      <div className="text-xs text-slate-600">
                        Instructions: {patientDetail.discharge_instructions || 'Follow standard monitoring'}
                      </div>
                      {patientDetail.monitoring_requirements && (
                        <div className="text-xs text-slate-500">
                          Clinician-requested checks:{' '}
                          {JSON.parse(patientDetail.monitoring_requirements || '[]').join(', ') || 'As needed'}
                        </div>
                      )}
                    </div>

                    {/* Record Observations Form */}
                    <form
                      onSubmit={handleRecordObservation}
                      className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                    >
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-teal-700" />
                        Record Health Observation
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <select
                          value={obsForm.metric}
                          onChange={(e) => {
                            const m = e.target.value;
                            const u =
                              m === 'Blood Pressure'
                                ? 'mmHg'
                                : m === 'Blood Sugar'
                                ? 'mg/dL'
                                : m === 'SpO2'
                                ? '%'
                                : m === 'Temperature'
                                ? '°F'
                                : m === 'Weight'
                                ? 'kg'
                                : 'bpm';
                            setObsForm({ ...obsForm, metric: m, unit: u });
                          }}
                          className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        >
                          <option value="Blood Pressure">Blood Pressure</option>
                          <option value="Blood Sugar">Blood Sugar</option>
                          <option value="Heart Rate">Heart Rate</option>
                          <option value="SpO2">SpO2</option>
                          <option value="Temperature">Temperature</option>
                          <option value="Weight">Weight</option>
                        </select>
                        <input
                          required
                          value={obsForm.value}
                          onChange={(e) => setObsForm({ ...obsForm, value: e.target.value })}
                          placeholder={obsForm.metric === 'Blood Pressure' ? 'e.g. 128/82' : 'Measured value'}
                          className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                        <input
                          value={obsForm.unit}
                          onChange={(e) => setObsForm({ ...obsForm, unit: e.target.value })}
                          className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                      <textarea
                        rows={2}
                        placeholder="Nurse clinical visit notes..."
                        value={obsForm.notes}
                        onChange={(e) => setObsForm({ ...obsForm, notes: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />

                      <label className="flex items-center gap-2 text-xs font-semibold text-red-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={obsForm.flagged_for_doctor}
                          onChange={(e) => setObsForm({ ...obsForm, flagged_for_doctor: e.target.checked })}
                          className="accent-red-700"
                        />
                        <ShieldAlert className="w-4 h-4" />
                        Flag concerning observation for immediate Doctor review
                      </label>

                      {obsForm.flagged_for_doctor && (
                        <input
                          required
                          placeholder="Reason for doctor alert (e.g. Elevated systolic BP > 155)"
                          value={obsForm.flag_reason}
                          onChange={(e) => setObsForm({ ...obsForm, flag_reason: e.target.value })}
                          className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg bg-red-50/40"
                        />
                      )}

                      <button
                        type="submit"
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
                      >
                        Save Observation
                      </button>
                    </form>

                    {/* Read-Only Medications */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <ClipboardList className="w-4 h-4 text-slate-500" />
                          Prescribed Medication Schedule (Read-Only)
                        </h3>
                        <span className="text-[11px] text-slate-500">Doctor authorization required for changes</span>
                      </div>
                      {patientMeds.length === 0 ? (
                        <p className="text-xs text-slate-500">No active prescriptions.</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {patientMeds.map((m) => (
                            <div key={m.id} className="py-2.5 text-xs flex justify-between">
                              <div>
                                <strong className="text-slate-900">{m.name}</strong> · {m.dosage} ({m.frequency})
                                <div className="text-slate-500 mt-0.5">{m.instructions}</div>
                              </div>
                              <span className="font-mono text-slate-600">
                                {JSON.parse(m.timings || '[]').join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <VitalsChart readings={patientReadings} title={`${patientDetail.name} — Observation History`} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* FOLLOW-UPS TAB */}
      {tab === 'followups' && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Scheduled Visits & Follow-Ups</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Mark visits completed, document notes, or report missed visits to notify the doctor
            </p>
          </div>

          <div className="space-y-3">
            {followups.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
                No follow-up visits assigned.
              </div>
            ) : (
              followups.map((v) => (
                <div key={v.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {v.patient_name}{' '}
                        <span className="font-mono text-xs font-normal text-slate-500">{v.patient_code}</span>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                        Scheduled: {new Date(v.scheduled_at).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        v.status === 'Completed'
                          ? 'text-emerald-700'
                          : v.status === 'Overdue' || v.status === 'Missed'
                          ? 'text-red-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {v.status}
                    </span>
                  </div>

                  {v.visit_notes && <p className="text-xs text-slate-600">{v.visit_notes}</p>}

                  {v.status !== 'Completed' && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                      <input
                        placeholder="Add visit summary or missed-visit reason..."
                        value={visitNoteEdit[v.id] || ''}
                        onChange={(e) => setVisitNoteEdit({ ...visitNoteEdit, [v.id]: e.target.value })}
                        className="flex-1 min-w-[220px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUpdateVisit(v.id, 'Completed', false)}
                        className="px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                      >
                        Mark Completed
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUpdateVisit(v.id, 'Completed', true)}
                        className="px-3 py-1.5 text-xs font-semibold border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-50 cursor-pointer"
                      >
                        Complete & Flag Doctor
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUpdateVisit(v.id, 'Missed', true)}
                        className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                      >
                        Report Missed
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {appointments.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-3">Doctor Appointments (Assigned Patients)</h2>
              <div className="divide-y divide-slate-100">
                {appointments.map((a) => (
                  <div key={a.id} className="py-2.5 flex justify-between text-xs">
                    <span>
                      <strong>{a.patient_name}</strong> · {a.appointment_type} ({new Date(a.appointment_date).toLocaleString()})
                    </span>
                    <span className="font-semibold text-slate-700">{a.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ALERTS & ESCALATIONS TAB */}
      {tab === 'alerts' && (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Assigned Patient Alerts</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Follow up on unacknowledged medication escalations and clinical flags
            </p>
          </div>

          {alerts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              No active alerts for your assigned patients.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((al) => (
                <div key={al.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <Bell className="w-4 h-4 text-teal-700" />
                      {al.title}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{al.message}</p>
                    <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {al.patient_name} · {al.alert_type} · Status: {al.status}
                    </div>
                  </div>
                  {al.status !== 'Resolved' ? (
                    <button
                      type="button"
                      onClick={() => handleResolveAlert(al.id)}
                      className="px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                    >
                      Mark Followed Up & Resolve
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Resolved
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NurseKpi({
  label,
  value,
  detail,
  icon: Icon,
  danger = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Users;
  danger?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <Icon className={`w-4 h-4 ${danger ? 'text-red-600' : 'text-slate-400'}`} />
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{detail}</div>
    </div>
  );
}
