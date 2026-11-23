import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCheck,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  Play,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AutomatedReminderStatus,
  AutomatedReminderType,
  AutomatedWhatsAppDashboardData,
  AutomatedWhatsAppReminder,
  Patient,
  SupportedLanguage,
} from '../types';

interface WhatsAppRemindersPanelProps {
  onNotice: (msg: string) => void;
}

const REMINDER_TYPES: AutomatedReminderType[] = [
  'BP',
  'Blood Sugar',
  'Medicine',
  'Doctor Appointment',
  'Nurse Visit',
];

function getTodayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentTimeString(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function maskPhoneClient(phone: string): string {
  const trimmed = (phone || '').trim();
  if (!trimmed) return 'Not registered';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return '******';
  const last4 = digits.slice(-4);
  const countryMatch = trimmed.match(/^(\+\d{1,3})[\s-]*/);
  if (countryMatch) {
    return `${countryMatch[1]} ******${last4}`;
  }
  return `******${last4}`;
}

function formatDateDisplay(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatSentTimeDisplay(isoOrNull: string | null, fallbackDate: string, fallbackTime: string): string {
  if (!isoOrNull) return `Scheduled ${formatDateDisplay(fallbackDate)} · ${fallbackTime}`;
  const dt = new Date(isoOrNull);
  if (Number.isNaN(dt.getTime())) return `${fallbackDate} ${fallbackTime}`;
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function WhatsAppRemindersPanel({ onNotice }: WhatsAppRemindersPanelProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dashboard, setDashboard] = useState<AutomatedWhatsAppDashboardData>({
    reminders: [],
    stats: { total: 0, sent: 0, pending: 0, failed: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Automated Demo runner state
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoProgress, setDemoProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const isMountedRef = useRef(true);

  // Schedule form state
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [reminderType, setReminderType] = useState<AutomatedReminderType>('BP');
  const [scheduledDate, setScheduledDate] = useState<string>(getTodayDateString());
  const [scheduledTime, setScheduledTime] = useState<string>(getCurrentTimeString());
  const [language, setLanguage] = useState<SupportedLanguage>('English');
  const [notes, setNotes] = useState<string>('');

  // History filter
  const [statusFilter, setStatusFilter] = useState<'All' | AutomatedReminderStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [patData, autoData] = await Promise.all([
        apiFetch<Patient[]>('/api/patients'),
        apiFetch<AutomatedWhatsAppDashboardData>('/api/automated-whatsapp-reminders'),
      ]);
      if (!isMountedRef.current) return;
      setPatients(patData);
      setDashboard(autoData);
      if (patData.length > 0 && !selectedPatientId) {
        setSelectedPatientId(String(patData[0].id));
        setLanguage(patData[0].language);
      }
      return autoData;
    } catch (err) {
      if (isMountedRef.current) {
        onNotice(err instanceof Error ? err.message : 'Unable to load Automated WhatsApp Reminders.');
      }
      return null;
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [onNotice, selectedPatientId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Background poll every 30s so scheduled cron completions reflect automatically
  useEffect(() => {
    const timer = setInterval(() => {
      if (!demoRunning) {
        void loadData();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [demoRunning, loadData]);

  const selectedPatient = useMemo(
    () => patients.find((p) => String(p.id) === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  function handlePatientChange(nextId: string) {
    setSelectedPatientId(nextId);
    const pat = patients.find((p) => String(p.id) === nextId);
    if (pat) setLanguage(pat.language);
  }

  async function handleScheduleReminder(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      onNotice('Please select an existing patient.');
      return;
    }
    setSaving(true);
    try {
      const localDateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);
      const scheduledAtIso = Number.isNaN(localDateTime.getTime())
        ? new Date().toISOString()
        : localDateTime.toISOString();

      await apiFetch('/api/automated-whatsapp-reminders', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          reminder_type: reminderType,
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
          scheduled_at_iso: scheduledAtIso,
          language,
          notes,
        }),
      });
      setNotes('');
      await loadData();
      onNotice(
        `DEMO MODE: Scheduled ${reminderType} automated reminder for ${selectedPatient.name} (${formatDateDisplay(scheduledDate)} at ${scheduledTime}).`
      );
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Failed to schedule automated reminder.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStartAutomatedDemo() {
    if (demoRunning) return;
    if (patients.length === 0) {
      onNotice('Please register or assign at least one patient before starting the automated demo.');
      return;
    }

    setDemoRunning(true);
    try {
      let currentData = await loadData();
      let pendingList = (currentData?.reminders || []).filter((r) => r.status === 'Pending');

      if (pendingList.length === 0) {
        await apiFetch('/api/automated-whatsapp-reminders/seed-demo', { method: 'POST' });
        currentData = await loadData();
        pendingList = (currentData?.reminders || []).filter((r) => r.status === 'Pending');
      }

      if (pendingList.length === 0) {
        onNotice('No pending demo reminders available to process.');
        return;
      }

      // Process oldest/earliest pending reminders first
      const queue = [...pendingList].reverse();
      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < queue.length; i++) {
        if (!isMountedRef.current) break;
        const item = queue[i];
        setDemoProgress({
          current: i + 1,
          total: queue.length,
          label: `Sending automated WhatsApp (${item.reminder_type}) to ${item.patient_name}...`,
        });

        // Step 1: Transition Pending -> Sending
        await apiFetch(`/api/automated-whatsapp-reminders/${item.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Sending' }),
        });
        await loadData();
        await sleep(650);

        // Step 2: Transition Sending -> Sent (or Failed if invalid phone on server)
        const result = await apiFetch<{ reminder: AutomatedWhatsAppReminder }>(
          `/api/automated-whatsapp-reminders/${item.id}/status`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Sent' }),
          }
        );
        await loadData();

        if (result.reminder.status === 'Sent') {
          sentCount += 1;
          onNotice(
            `DEMO MODE: Simulated WhatsApp sent to ${item.patient_name} (${item.reminder_type}).`
          );
        } else {
          failedCount += 1;
          onNotice(
            `DEMO MODE: Simulated delivery failed for ${item.patient_name} (${result.reminder.error_reason || 'Invalid phone'}).`
          );
        }

        await sleep(450);
      }

      if (isMountedRef.current) {
        setDemoProgress({
          current: queue.length,
          total: queue.length,
          label: `Completed: ${sentCount} simulated sent${failedCount ? `, ${failedCount} failed` : ''}.`,
        });
        onNotice(
          `DEMO MODE complete: ${sentCount} simulated WhatsApp reminder(s) processed inside SmartCare${failedCount ? ` (${failedCount} failed)` : ''}.`
        );
      }
    } catch (err) {
      if (isMountedRef.current) {
        onNotice(err instanceof Error ? err.message : 'Automated demo encountered an error.');
      }
    } finally {
      if (isMountedRef.current) {
        setDemoRunning(false);
      }
    }
  }

  async function handleRequeueReminder(reminderId: number) {
    setSaving(true);
    try {
      await apiFetch(`/api/automated-whatsapp-reminders/${reminderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Pending' }),
      });
      await loadData();
      onNotice('Reminder reset to Pending for re-testing in the automated demo.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not reset reminder.');
    } finally {
      setSaving(false);
    }
  }

  const filteredReminders = useMemo(() => {
    return dashboard.reminders.filter((r) => {
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.patient_name.toLowerCase().includes(q) ||
          r.patient_code.toLowerCase().includes(q) ||
          r.reminder_type.toLowerCase().includes(q) ||
          r.masked_phone.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [dashboard.reminders, statusFilter, searchQuery]);

  // Live WhatsApp message log displays the newest activity cleanly
  const liveMessageLog = useMemo(() => {
    return dashboard.reminders.slice(0, 12);
  }, [dashboard.reminders]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Clear DEMO MODE Label */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Automated WhatsApp Reminders
            </h1>
            <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase bg-amber-100 text-amber-900 border border-amber-300 rounded-md">
              DEMO MODE · SIMULATED
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Schedule care reminders and demonstrate end-to-end automated WhatsApp dispatch directly inside SmartCare. No external WhatsApp messages are actually delivered in DEMO MODE.
          </p>
        </div>

        <button
          type="button"
          disabled={demoRunning || patients.length === 0}
          onClick={() => void handleStartAutomatedDemo()}
          className="px-4 py-2.5 text-xs font-bold bg-[#075E54] hover:bg-[#064c44] text-white rounded-lg inline-flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {demoRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running Automated Demo...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Start Automated Reminder Demo
            </>
          )}
        </button>
      </div>

      {/* Live Demo Progress Banner */}
      {demoProgress && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-emerald-950 flex items-center gap-2">
              {demoRunning ? (
                <Loader2 className="w-4 h-4 text-emerald-700 animate-spin" />
              ) : (
                <CheckCheck className="w-4 h-4 text-emerald-700" />
              )}
              DEMO MODE Automation: {demoProgress.label}
            </span>
            <span className="font-mono text-[11px] font-bold text-emerald-800 tabular-nums">
              {demoProgress.current} / {demoProgress.total}
            </span>
          </div>
          <div className="w-full h-2 bg-emerald-200/70 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#128C7E] transition-all duration-300"
              style={{
                width: `${Math.round((demoProgress.current / Math.max(demoProgress.total, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 1. Dashboard KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Reminders</span>
            <MessageSquare className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">
            {dashboard.stats.total}
          </div>
          <div className="text-xs text-slate-500 mt-1">All scheduled &amp; demo reminders</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Successfully Sent (Simulated)</span>
            <CheckCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2 tabular-nums">
            {dashboard.stats.sent}
          </div>
          <div className="text-xs text-slate-500 mt-1">DEMO MODE simulated delivery</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pending Reminders</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700 mt-2 tabular-nums">
            {dashboard.stats.pending}
          </div>
          <div className="text-xs text-slate-500 mt-1">Queued for automated dispatch</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Failed Reminders</span>
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-700 mt-2 tabular-nums">
            {dashboard.stats.failed}
          </div>
          <div className="text-xs text-slate-500 mt-1">Invalid or missing phone check</div>
        </div>
      </div>

      {/* 2. Scheduler + 4. In-App WhatsApp-Style Message Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Automated Scheduler Form */}
        <form
          onSubmit={handleScheduleReminder}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Schedule Automated Reminder</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Future dates run automatically on schedule, or process anytime via the Demo button.
            </p>
          </div>

          {patients.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 text-xs text-slate-600">
              No accessible patients yet. Register or assign a patient first.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Existing Patient
                </label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => handlePatientChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                  required
                >
                  {patients.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.patient_code})
                    </option>
                  ))}
                </select>
                {selectedPatient && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Phone className="w-3 h-3 text-teal-700" />
                    <span>Masked Phone:</span>
                    <span className="font-mono font-semibold text-slate-700">
                      {maskPhoneClient(selectedPatient.phone)}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Reminder Type
                  </label>
                  <select
                    value={reminderType}
                    onChange={(e) => setReminderType(e.target.value as AutomatedReminderType)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                  >
                    {REMINDER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Message Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
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
                    Scheduled Date
                  </label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Scheduled Time
                  </label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Instruction / Note (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Check fasting sugar before breakfast..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                  maxLength={250}
                />
              </div>

              <button
                type="submit"
                disabled={saving || demoRunning}
                className="w-full px-4 py-2.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <CalendarClock className="w-4 h-4" />
                {saving ? 'Scheduling...' : 'Schedule Automated Reminder'}
              </button>
            </>
          )}
        </form>

        {/* Right: WhatsApp-Style Live Message Activity Log Inside the Website */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          {/* WhatsApp Header */}
          <div className="bg-[#075E54] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/25 border border-white/20 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-xs font-bold flex items-center gap-2">
                  <span>SmartCare WhatsApp Activity Log</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-amber-400 text-slate-950 font-bold rounded">
                    DEMO MODE
                  </span>
                </div>
                <div className="text-[11px] text-emerald-100">
                  Simulated automated outbound WhatsApp stream inside SmartCare
                </div>
              </div>
            </div>
            <span className="text-[11px] text-emerald-100 font-mono">
              {liveMessageLog.length} recent
            </span>
          </div>

          {/* WhatsApp Chat Canvas */}
          <div className="bg-[#EFEAE2] p-4 max-h-[420px] min-h-[340px] overflow-y-auto space-y-3">
            <div className="flex justify-center">
              <span className="bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium px-3 py-1 rounded-md shadow-2xs flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                Simulated DEMO MODE log — actual WhatsApp messages are not sent externally.
              </span>
            </div>

            {liveMessageLog.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-600">
                Schedule a reminder or click <strong>Start Automated Reminder Demo</strong> to watch simulated WhatsApp messages appear here in real time.
              </div>
            ) : (
              liveMessageLog.map((msg) => (
                <div key={msg.id} className="flex flex-col items-end">
                  <div
                    className={`w-full sm:max-w-[90%] rounded-xl rounded-tr-none px-4 py-3 shadow-2xs border transition-all ${
                      msg.status === 'Failed'
                        ? 'bg-rose-50 border-rose-200 text-slate-900'
                        : msg.status === 'Sending'
                        ? 'bg-amber-50 border-amber-200 text-slate-900'
                        : msg.status === 'Pending'
                        ? 'bg-white border-slate-200 text-slate-800'
                        : 'bg-[#D9FDD3] border-emerald-200/80 text-slate-900'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-black/5 text-[11px]">
                      <div className="font-bold text-slate-900">
                        {msg.patient_name}{' '}
                        <span className="font-mono font-normal text-slate-600 ml-1">
                          {msg.masked_phone}
                        </span>
                      </div>
                      <span className="font-semibold text-teal-800">{msg.reminder_type}</span>
                    </div>

                    <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {msg.message_text}
                    </p>

                    {msg.error_reason && (
                      <p className="text-[11px] text-rose-700 font-medium mt-1.5">
                        {msg.error_reason}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-1 text-[10px] text-slate-600">
                      <span className="tabular-nums">
                        {msg.status === 'Sent' || msg.status === 'Failed'
                          ? `Processed: ${formatSentTimeDisplay(msg.sent_at, msg.scheduled_date, msg.scheduled_time)}`
                          : `Scheduled: ${formatDateDisplay(msg.scheduled_date)} · ${msg.scheduled_time}`}
                      </span>
                      <StatusBadge status={msg.status} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 5. Saved Reminder History Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Automated Reminder History &amp; Queue</h2>
            <p className="text-xs text-slate-500">
              Saved in SQLite · Scheduled future reminders trigger automatically on the 1-minute cycle or via the Demo button
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient, type, phone..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 w-52"
              />
            </div>

            <select
              aria-label="Filter reminder history by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | AutomatedReminderStatus)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="All">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Sending">Sending</option>
              <option value="Sent">Sent (Simulated)</option>
              <option value="Failed">Failed</option>
            </select>
          </div>
        </div>

        {filteredReminders.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 text-xs text-slate-500">
            No automated reminders recorded yet. Schedule one above or click <strong>Start Automated Reminder Demo</strong>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 pr-4">Patient</th>
                  <th className="py-2.5 pr-4">Masked Phone</th>
                  <th className="py-2.5 pr-4">Reminder Type</th>
                  <th className="py-2.5 pr-4">Scheduled</th>
                  <th className="py-2.5 pr-4">Sending Time</th>
                  <th className="py-2.5 pr-4">Status (Demo Mode)</th>
                  <th className="py-2.5 text-right">Demo Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReminders.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-slate-900">{r.patient_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{r.patient_code}</div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-slate-700 whitespace-nowrap tabular-nums">
                      {r.masked_phone}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">{r.reminder_type}</div>
                      {r.notes && (
                        <div className="text-[11px] text-slate-500 max-w-xs truncate">{r.notes}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-slate-700 whitespace-nowrap tabular-nums">
                      {formatDateDisplay(r.scheduled_date)} · {r.scheduled_time}
                    </td>
                    <td className="py-3 pr-4 font-mono text-slate-600 whitespace-nowrap tabular-nums">
                      {r.sent_at
                        ? formatSentTimeDisplay(r.sent_at, r.scheduled_date, r.scheduled_time)
                        : '—'}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      {r.status !== 'Pending' && r.status !== 'Sending' && (
                        <button
                          type="button"
                          disabled={saving || demoRunning}
                          onClick={() => void handleRequeueReminder(r.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset to Pending
                        </button>
                      )}
                      {r.status === 'Pending' && (
                        <span className="text-[11px] text-slate-400">Queued</span>
                      )}
                      {r.status === 'Sending' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700">
                          <Send className="w-3 h-3 animate-pulse" />
                          Dispatching...
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AutomatedReminderStatus }) {
  if (status === 'Sent') {
    return (
      <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
        <CheckCheck className="w-3.5 h-3.5" />
        Sent (Simulated)
      </span>
    );
  }
  if (status === 'Sending') {
    return (
      <span className="inline-flex items-center gap-1 font-bold text-teal-700">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Sending...
      </span>
    );
  }
  if (status === 'Failed') {
    return (
      <span className="inline-flex items-center gap-1 font-bold text-rose-700">
        <AlertCircle className="w-3.5 h-3.5" />
        Failed (Simulated)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
      <Clock className="w-3.5 h-3.5" />
      Pending
    </span>
  );
}
