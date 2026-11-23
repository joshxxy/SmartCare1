import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { DoctorPortal, type DoctorTab } from './components/DoctorPortal';
import { LoginScreen } from './components/LoginScreen';
import { NursePortal, type NurseTab } from './components/NursePortal';
import { PatientPortal, type PatientTab } from './components/PatientPortal';
import { setAuthToken, setUnauthorizedHandler } from './lib/api';
import { UI_COPY } from './lib/i18n';
import type { Session, SupportedLanguage } from './types';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [language, setLanguage] = useState<SupportedLanguage>('English');
  const [doctorTab, setDoctorTab] = useState<DoctorTab>('overview');
  const [nurseTab, setNurseTab] = useState<NurseTab>('overview');
  const [patientTab, setPatientTab] = useState<PatientTab>('overview');
  const [notice, setNotice] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = useCallback(() => {
    setAuthToken(null);
    setSession(null);
    setDoctorTab('overview');
    setNurseTab('overview');
    setPatientTab('overview');
    setMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      handleLogout();
      setNotice('Your session expired. Please sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, [handleLogout]);

  function handleLogin(nextSession: Session) {
    setAuthToken(nextSession.access_token);
    setSession(nextSession);
    setDoctorTab('overview');
    setNurseTab('overview');
    setPatientTab('overview');
    setNotice('');
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const t = UI_COPY[language];

  const doctorNav: Array<{ id: DoctorTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Clinical Overview', icon: LayoutDashboard },
    { id: 'patients', label: 'Patients & Plans', icon: Users },
    { id: 'appointments', label: 'Follow-Ups', icon: CalendarDays },
    { id: 'alerts', label: 'Reminders & Alerts', icon: Bell },
    { id: 'audit', label: 'Audit Logs', icon: ShieldCheck },
  ];

  const nurseNav: Array<{ id: NurseTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Nursing Overview', icon: LayoutDashboard },
    { id: 'patients', label: 'Assigned Patients', icon: Users },
    { id: 'followups', label: 'Visit Schedule', icon: CalendarDays },
    { id: 'alerts', label: 'Patient Alerts', icon: Bell },
  ];

  const patientNav: Array<{ id: PatientTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: t.overview, icon: LayoutDashboard },
    { id: 'medications', label: t.medications, icon: ClipboardList },
    { id: 'appointments', label: t.appointments, icon: CalendarDays },
    { id: 'readings', label: 'Readings & Reports', icon: Activity },
    { id: 'alerts', label: t.alerts, icon: Bell },
    { id: 'settings', label: t.settings, icon: Settings },
  ];

  const activePortalTitle =
    session.role === 'doctor' ? 'Doctor Portal' : session.role === 'nurse' ? 'Nurse Portal' : 'Patient Portal';

  const currentTabLabel =
    session.role === 'doctor'
      ? doctorNav.find((n) => n.id === doctorTab)?.label
      : session.role === 'nurse'
      ? nurseNav.find((n) => n.id === nurseTab)?.label
      : patientNav.find((n) => n.id === patientTab)?.label;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-base font-bold text-slate-900 tracking-tight whitespace-nowrap shrink-0">
              <HeartPulse className="w-5 h-5 text-teal-700" />
              <span>SmartCare</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="p-1.5 text-slate-500 hover:text-slate-900 lg:hidden"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-4 py-4 border-b border-slate-100">
            <div className="text-xs font-semibold text-teal-800">{activePortalTitle}</div>
            <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
              {session.full_name || session.username}
            </div>
            <div className="font-mono text-[11px] text-slate-500 truncate">{session.username}</div>
          </div>

          <nav className="p-3 space-y-1">
            {session.role === 'doctor' &&
              doctorNav.map((item) => {
                const Icon = item.icon;
                const active = doctorTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setDoctorTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

            {session.role === 'nurse' &&
              nurseNav.map((item) => {
                const Icon = item.icon;
                const active = nurseTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setNurseTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

            {session.role === 'patient' &&
              patientNav.map((item) => {
                const Icon = item.icon;
                const active = patientTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPatientTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
          </nav>
        </div>

        <div className="p-3 border-t border-slate-200">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.signOut}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (3-zone contract) */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -ml-2 text-slate-600 hover:text-slate-900 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
              <span className="whitespace-nowrap">{activePortalTitle}</span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold text-slate-900 truncate">{currentTabLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <select
              aria-label="Interface language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
              className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="English">English</option>
              <option value="Tamil">Tamil</option>
              <option value="Malayalam">Malayalam</option>
            </select>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {notice && (
            <div
              role="status"
              className="mb-5 p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-950 flex items-center justify-between gap-3"
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-teal-700 hover:text-teal-950 p-1"
                aria-label="Dismiss notice"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {session.role === 'doctor' && (
            <DoctorPortal
              tab={doctorTab}
              setTab={setDoctorTab}
              session={session}
              onNotice={setNotice}
            />
          )}

          {session.role === 'nurse' && (
            <NursePortal
              tab={nurseTab}
              setTab={setNurseTab}
              session={session}
              onNotice={setNotice}
            />
          )}

          {session.role === 'patient' && (
            <PatientPortal
              tab={patientTab}
              setTab={setPatientTab}
              session={session}
              language={language}
              setLanguage={setLanguage}
              onPasswordChanged={() =>
                setSession((prev) => (prev ? { ...prev, must_change_password: false } : prev))
              }
              onNotice={setNotice}
            />
          )}
        </main>
      </div>
    </div>
  );
}
