import type { SupportedLanguage } from '../types';

export const UI_COPY: Record<
  SupportedLanguage,
  {
    overview: string;
    patients: string;
    medications: string;
    appointments: string;
    followups: string;
    alerts: string;
    documents: string;
    audit: string;
    settings: string;
    signOut: string;
    welcomePatient: string;
    medReminderTitle: string;
    medReminderSample: string;
    acknowledgeBtn: string;
    logIntakeBtn: string;
    noPatients: string;
  }
> = {
  English: {
    overview: 'Overview',
    patients: 'Patients',
    medications: 'Medications',
    appointments: 'Appointments',
    followups: 'Follow-ups',
    alerts: 'Reminders & Alerts',
    documents: 'Documents',
    audit: 'Audit Logs',
    settings: 'Preferences',
    signOut: 'Sign out',
    welcomePatient: 'Recovery Overview',
    medReminderTitle: 'SmartCare Medication Reminder',
    medReminderSample:
      'Hello! This is your SmartCare medication reminder. It is time for your prescribed medicine. Please check your medication schedule and acknowledge this reminder.',
    acknowledgeBtn: 'Acknowledge Reminder',
    logIntakeBtn: 'Log Dose Taken',
    noPatients: 'No patient records found.',
  },
  Tamil: {
    overview: 'கண்ணோட்டம்',
    patients: 'நோயாளிகள்',
    medications: 'மருந்துகள்',
    appointments: 'சந்திப்புகள்',
    followups: 'தொடர் கண்காணிப்பு',
    alerts: 'நினைவூட்டல்கள்',
    documents: 'ஆவணங்கள்',
    audit: 'தணிக்கை பதிவுகள்',
    settings: 'அமைப்புகள்',
    signOut: 'வெளியேறு',
    welcomePatient: 'குணமடைதல் கண்ணோட்டம்',
    medReminderTitle: 'SmartCare மருந்து நினைவூட்டல்',
    medReminderSample:
      'வணக்கம்! இது உங்கள் SmartCare மருந்து நினைவூட்டல். உங்கள் பரிந்துரைக்கப்பட்ட மருந்தை எடுத்துக்கொள்ளும் நேரம் இது. தயவுசெய்து உங்கள் மருந்து அட்டவணையைப் பார்த்து இந்த நினைவூட்டலை உறுதிப்படுத்தவும்.',
    acknowledgeBtn: 'நினைவூட்டலை உறுதிப்படுத்து',
    logIntakeBtn: 'மருந்து எடுத்ததை பதிவு செய்',
    noPatients: 'நோயாளி பதிவுகள் இல்லை.',
  },
  Malayalam: {
    overview: 'അവലോകനം',
    patients: 'രോഗികൾ',
    medications: 'മരുന്നുകൾ',
    appointments: 'അപ്പോയിന്റ്മെന്റുകൾ',
    followups: 'തുടർപരിശോധനകൾ',
    alerts: 'ഓർമ്മപ്പെടുത്തലുകൾ',
    documents: 'രേഖകൾ',
    audit: 'ഓഡിറ്റ് രേഖകൾ',
    settings: 'ക്രമീകരണങ്ങൾ',
    signOut: 'സൈൻ ഔട്ട്',
    welcomePatient: 'വീണ്ടെടുക്കൽ അവലോകനം',
    medReminderTitle: 'SmartCare മരുന്ന് ഓർമ്മപ്പെടുത്തൽ',
    medReminderSample:
      'നമസ്കാരം! ഇത് നിങ്ങളുടെ SmartCare മരുന്ന് ഓർമ്മപ്പെടുത്തലാണ്. നിശ്ചിത മരുന്ന് കഴിക്കാനുള്ള സമയമായി. ദയവായി നിങ്ങളുടെ മരുന്ന് പട്ടിക പരിശോധിച്ച് ഈ ഓർമ്മപ്പെടുത്തൽ സ്ഥിരീകരിക്കുക.',
    acknowledgeBtn: 'ഓർമ്മപ്പെടുത്തൽ സ്ഥിരീകരിക്കുക',
    logIntakeBtn: 'മരുന്ന് കഴിച്ചതായി രേഖപ്പെടുത്തുക',
    noPatients: 'രോഗി രേഖകൾ ലഭ്യമല്ല.',
  },
};
