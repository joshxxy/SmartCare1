import { useEffect, useState, type FormEvent } from 'react';
import { HeartPulse, Lock, Stethoscope, UserCheck, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Session, UserRole } from '../types';

interface LoginScreenProps {
  onLogin: (session: Session) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [portal, setPortal] = useState<UserRole>('patient');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Clinician registration fields (Doctor or Nurse only)
  const [regRole, setRegRole] = useState<'doctor' | 'nurse'>('doctor');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [specialty, setSpecialty] = useState('Internal Medicine');
  const [qualification, setQualification] = useState('Registered Nurse');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<{ hasUsers: boolean; hasDoctor: boolean; hasNurse: boolean } | null>(
    null
  );
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => setAuthStatus(d))
      .catch(() => {});
  }, []);

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch<Session>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (data.role !== portal) {
        throw new Error(
          `This account is registered under the ${data.role} portal. Please select the ${data.role} portal above.`
        );
      }
      onLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterClinician(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch<Session>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          password,
          role: regRole,
          full_name: fullName.trim(),
          phone: phone.trim(),
          specialty: specialty.trim(),
          qualification: qualification.trim(),
        }),
      });
      onLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  const portals: Array<{ id: UserRole; title: string; subtitle: string; icon: typeof HeartPulse }> = [
    { id: 'patient', title: 'Patient / Family', subtitle: 'Recovery schedule, medicines & readings', icon: HeartPulse },
    { id: 'doctor', title: 'Doctor Portal', subtitle: 'Patient registration, prescriptions & review', icon: Stethoscope },
    { id: 'nurse', title: 'Nurse Portal', subtitle: 'Assigned patients & follow-up observations', icon: UserCheck },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-sm items-stretch">
        {/* Left Visual & Editorial Panel */}
        <div className="lg:col-span-5 relative min-h-[280px] lg:min-h-[640px] bg-slate-900 text-white flex flex-col justify-between overflow-hidden">
          {!imgFailed ? (
            <img
              src="/src/assets/images/login_care_hero_1795413086826.jpg"
              alt="Clinician reviewing post-discharge recovery plan with patient at home"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-slate-900 to-slate-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/55 to-slate-950/50" />

          <div className="relative z-10 p-7 sm:p-9">
            <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white">
              <HeartPulse className="w-6 h-6 text-teal-300 shrink-0" />
              <span>SmartCare</span>
            </div>
          </div>

          <div className="relative z-10 p-7 sm:p-9 space-y-3">
            <p className="text-xs font-medium tracking-wide text-teal-200">
              Post-Discharge Recovery & Care Coordination
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug text-white">
              Hospital-to-home recovery, connected safely.
            </h1>
            <p className="text-sm text-slate-200 leading-relaxed max-w-sm">
              Doctors manage discharge plans and prescriptions, nurses record home follow-ups, and patients receive multilingual reminders in English, Tamil, and Malayalam.
            </p>
            <div className="pt-3 border-t border-white/15 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
              <span>Role-based portals</span>
              <span aria-hidden="true">·</span>
              <span>Automated patient accounts</span>
              <span aria-hidden="true">·</span>
              <span>Multilingual alerts</span>
            </div>
          </div>
        </div>

        {/* Right Authentication Form Panel */}
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {mode === 'login' ? 'Sign in to SmartCare' : 'Register Clinician Account'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {mode === 'login'
                  ? 'Select your authorized portal and enter your credentials.'
                  : 'Create a Doctor or Nurse account. Patient accounts are auto-generated by Doctors.'}
              </p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              Portal Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Register Doctor / Nurse
            </button>
          </div>

          {authStatus && !authStatus.hasDoctor && mode === 'login' && (
            <div className="mb-5 p-3.5 rounded-lg border border-teal-200 bg-teal-50/70 text-xs text-teal-900 flex items-center justify-between gap-3">
              <span>
                First-time setup: no Doctor account exists yet. Register a Doctor account to start onboarding patients.
              </span>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setRegRole('doctor');
                }}
                className="px-3 py-1.5 bg-teal-700 text-white rounded-md font-medium whitespace-nowrap shrink-0 hover:bg-teal-800"
              >
                Create Doctor
              </button>
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700">Select Portal</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {portals.map((item) => {
                    const Icon = item.icon;
                    const active = portal === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setPortal(item.id);
                          setError('');
                        }}
                        className={`text-left p-3 rounded-xl border transition-colors ${
                          active
                            ? 'border-teal-700 bg-teal-50/70 text-slate-900'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <Icon className={`w-4 h-4 mb-1.5 ${active ? 'text-teal-700' : 'text-slate-400'}`} />
                        <div className="text-xs font-semibold">{item.title}</div>
                        <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{item.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="login-username">
                  Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={portal === 'patient' ? 'e.g. sc-pat-001' : 'Enter your username'}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="login-password">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                />
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:bg-teal-400 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {busy ? 'Signing in...' : `Sign in to ${portals.find((p) => p.id === portal)?.title}`}
              </button>

              <p className="text-xs text-slate-500 pt-2">
                Patients & authorized family members receive unique login credentials automatically when registered by their discharging Doctor.
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegisterClinician} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                {(['doctor', 'nurse'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRegRole(r)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      regRole === r
                        ? 'border-teal-700 bg-teal-50/70 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold capitalize">{r} Account</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {r === 'doctor' ? 'Register patients & prescribe' : 'Manage assigned follow-ups'}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={regRole === 'doctor' ? 'Dr. Arun Menon' : 'Nurse Kavitha R.'}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                  <input
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={regRole === 'doctor' ? 'dr.menon' : 'nurse.kavitha'}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98000 00000"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {regRole === 'doctor' ? 'Medical Specialty' : 'Qualification'}
                  </label>
                  <input
                    value={regRole === 'doctor' ? specialty : qualification}
                    onChange={(e) =>
                      regRole === 'doctor' ? setSpecialty(e.target.value) : setQualification(e.target.value)
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password (minimum 8 characters)
                </label>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                />
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:bg-teal-400 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {busy ? 'Creating account...' : `Create ${regRole === 'doctor' ? 'Doctor' : 'Nurse'} Account`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
