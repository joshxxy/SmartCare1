import cron from 'node-cron';
import { db, runInTransaction } from './db.ts';
import { recordAuditLog } from './security.ts';

export type SupportedLanguage = 'English' | 'Tamil' | 'Malayalam';

export const WHATSAPP_MESSAGES: Record<SupportedLanguage, (medName: string, dosage: string, time: string) => string> = {
  English: (medName, dosage, time) =>
    `Hello! This is your SmartCare medication reminder. It is time for your prescribed medicine (${medName} - ${dosage}, scheduled ${time}). Please check your medication schedule and acknowledge this reminder.`,
  Tamil: (medName, dosage, time) =>
    `வணக்கம்! இது உங்கள் SmartCare மருந்து நினைவூட்டல். உங்கள் பரிந்துரைக்கப்பட்ட மருந்தை (${medName} - ${dosage}, நேரம் ${time}) எடுத்துக்கொள்ளும் நேரம் இது. தயவுசெய்து உங்கள் மருந்து அட்டவணையைப் பார்த்து இந்த நினைவூட்டலை உறுதிப்படுத்தவும்.`,
  Malayalam: (medName, dosage, time) =>
    `നമസ്കാരം! ഇത് നിങ്ങളുടെ SmartCare മരുന്ന് ഓർമ്മപ്പെടുത്തലാണ്. നിശ്ചിത മരുന്ന് (${medName} - ${dosage}, സമയം ${time}) കഴിക്കാനുള്ള സമയമായി. ദയവായി നിങ്ങളുടെ മരുന്ന് പട്ടിക പരിശോധിച്ച് ഈ ഓർമ്മപ്പെടുത്തൽ സ്ഥിരീകരിക്കുക.`,
};

export const VOICE_PROMPTS: Record<SupportedLanguage, { langCode: string; text: (medName: string, dosage: string) => string }> = {
  English: {
    langCode: 'en-IN',
    text: (medName, dosage) =>
      `Hello, this is a SmartCare medication reminder. It is time for your prescribed medicine, ${medName}, dosage ${dosage}. Please press 1 on your phone keypad to acknowledge this reminder.`,
  },
  Tamil: {
    langCode: 'ta-IN',
    text: (medName, dosage) =>
      `Vanakkam. Idhu ungal SmartCare marundhu ninaivoottal. ${medName}, ${dosage} edukkavendiya neram idhu. Thayaavu seidhu urudhipadutha 1 azhuthavum.`,
  },
  Malayalam: {
    langCode: 'ml-IN',
    text: (medName, dosage) =>
      `Namaskaram. Idhu ningalude SmartCare marunnu ormmappeduthal aanu. ${medName}, ${dosage} kazhikkenda samayamayi. Dayavayi sthirikarikkan 1 amarthuka.`,
  },
};

export function getProviderConfigStatus() {
  const whatsappConfigured = Boolean(
    process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() &&
      process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim()
  );
  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_PHONE_NUMBER?.trim()
  );
  return {
    whatsapp: {
      configured: whatsappConfigured,
      mode: whatsappConfigured ? 'live' : 'simulated',
      apiVersion: process.env.META_WHATSAPP_API_VERSION?.trim() || 'v21.0',
    },
    voice: {
      configured: twilioConfigured,
      mode: twilioConfigured ? 'live' : 'simulated',
      maxAttempts: 3,
      retryIntervalMinutes: 5,
    },
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildTwimlForDelivery(
  deliveryId: number,
  language: SupportedLanguage,
  medName: string,
  dosage: string,
  webhookBaseUrl?: string
): string {
  const prompt = VOICE_PROMPTS[language] || VOICE_PROMPTS.English;
  const spoken = escapeXml(prompt.text(medName, dosage));
  const actionUrl = webhookBaseUrl
    ? `${webhookBaseUrl.replace(/\/$/, '')}/api/webhooks/twilio/gather?deliveryId=${deliveryId}`
    : `/api/webhooks/twilio/gather?deliveryId=${deliveryId}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" timeout="10" action="${escapeXml(actionUrl)}" method="POST">
    <Say language="${prompt.langCode}">${spoken}</Say>
  </Gather>
  <Say language="${prompt.langCode}">We did not receive a keypad confirmation. SmartCare will follow up shortly. Goodbye.</Say>
</Response>`;
}

export function generateMedicationSchedules(params: {
  medicationId: number;
  patientId: number;
  startDate: string;
  endDate: string;
  timings: string[];
}): number {
  const start = new Date(`${params.startDate}T00:00:00Z`);
  const end = new Date(`${params.endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }

  // Cap schedule expansion at 90 days per prescription for safety
  const maxDays = 90;
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO medication_schedules
      (medication_id, patient_id, scheduled_date, scheduled_time, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, 'Scheduled')`
  );

  let created = 0;
  const cursor = new Date(start);
  let days = 0;

  while (cursor <= end && days < maxDays) {
    const dateStr = cursor.toISOString().slice(0, 10);
    for (const rawTime of params.timings) {
      const cleanTime = rawTime.trim();
      if (!/^\d{2}:\d{2}$/.test(cleanTime)) continue;
      const scheduledAt = `${dateStr}T${cleanTime}:00`;
      const res = insertStmt.run(
        params.medicationId,
        params.patientId,
        dateStr,
        cleanTime,
        scheduledAt
      );
      if (res.changes > 0) created += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    days += 1;
  }

  return created;
}

function getWhatsAppTemplateName(language: SupportedLanguage): string {
  if (language === 'Tamil') {
    return process.env.META_WHATSAPP_TEMPLATE_TA?.trim() || 'smartcare_med_reminder_ta';
  }
  if (language === 'Malayalam') {
    return process.env.META_WHATSAPP_TEMPLATE_ML?.trim() || 'smartcare_med_reminder_ml';
  }
  return process.env.META_WHATSAPP_TEMPLATE_EN?.trim() || 'smartcare_med_reminder_en';
}

function getWhatsAppTemplateLangCode(language: SupportedLanguage): string {
  if (language === 'Tamil') return 'ta';
  if (language === 'Malayalam') return 'ml';
  return 'en';
}

function normalizePhoneE164(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

export async function dispatchWhatsAppDelivery(deliveryId: number): Promise<void> {
  const row = db
    .prepare(
      `SELECT nd.*, p.name AS patient_name, p.opt_in_whatsapp, a.title AS alert_title, a.message AS alert_message
       FROM notification_deliveries nd
       JOIN patients p ON p.id = nd.patient_id
       JOIN alerts a ON a.id = nd.alert_id
       WHERE nd.id = ?`
    )
    .get(deliveryId) as
    | {
        id: number;
        patient_id: number;
        recipient_phone: string;
        language: SupportedLanguage;
        status: string;
        opt_in_whatsapp: number;
        patient_name: string;
        alert_message: string;
      }
    | undefined;

  if (!row || row.status === 'Cancelled') return;

  const nowIso = new Date().toISOString();

  if (!row.opt_in_whatsapp) {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Cancelled', error_message = 'Patient opted out of WhatsApp reminders.'
       WHERE id = ?`
    ).run(deliveryId);
    return;
  }

  const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const apiVersion = process.env.META_WHATSAPP_API_VERSION?.trim() || 'v21.0';

  if (!token || !phoneNumberId) {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Simulated', sent_at = ?,
           error_message = 'Meta WhatsApp credentials not configured; recorded in sandbox simulation mode.'
       WHERE id = ?`
    ).run(nowIso, deliveryId);
    return;
  }

  const toNumber = normalizePhoneE164(row.recipient_phone).replace(/^\+/, '');
  if (!toNumber) {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Failed', error_message = 'Invalid patient phone number for WhatsApp delivery.'
       WHERE id = ?`
    ).run(deliveryId);
    return;
  }

  try {
    const templateName = getWhatsAppTemplateName(row.language);
    const isHelloWorld = templateName === 'hello_world';
    const langCode = isHelloWorld ? 'en_US' : getWhatsAppTemplateLangCode(row.language);

    const templatePayload: Record<string, unknown> = {
      name: templateName,
      language: { code: langCode },
    };

    if (!isHelloWorld) {
      templatePayload.components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: row.patient_name },
            { type: 'text', text: row.alert_message.slice(0, 200) },
          ],
        },
      ];
    }

    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toNumber,
          type: 'template',
          template: templatePayload,
        }),
      }
    );

    const data = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(data.error?.message || `WhatsApp API HTTP ${response.status}`);
    }

    const wamid = data.messages?.[0]?.id || null;
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Sent', sent_at = ?, provider_reference = ?, error_message = NULL
       WHERE id = ?`
    ).run(nowIso, wamid, deliveryId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WhatsApp delivery error';
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Failed', sent_at = ?, error_message = ?
       WHERE id = ?`
    ).run(nowIso, msg, deliveryId);
  }
}

export async function dispatchVoiceDelivery(deliveryId: number): Promise<void> {
  const row = db
    .prepare(
      `SELECT nd.*, p.name AS patient_name, p.opt_in_voice, a.title AS alert_title, a.message AS alert_message
       FROM notification_deliveries nd
       JOIN patients p ON p.id = nd.patient_id
       JOIN alerts a ON a.id = nd.alert_id
       WHERE nd.id = ?`
    )
    .get(deliveryId) as
    | {
        id: number;
        alert_id: number;
        patient_id: number;
        medication_schedule_id: number | null;
        recipient_phone: string;
        language: SupportedLanguage;
        status: string;
        confirmation_status: string;
        attempt_number: number;
        max_attempts: number;
        opt_in_voice: number;
        patient_name: string;
        alert_title: string;
        alert_message: string;
      }
    | undefined;

  if (!row || row.status === 'Cancelled' || row.confirmation_status === 'Confirmed') return;

  const now = new Date();
  const nowIso = now.toISOString();

  if (!row.opt_in_voice) {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Cancelled', error_message = 'Patient opted out of voice call reminders.'
       WHERE id = ?`
    ).run(deliveryId);
    return;
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromPhone = process.env.TWILIO_PHONE_NUMBER?.trim();
  const webhookBase = process.env.TWILIO_VOICE_WEBHOOK_BASE_URL?.trim() || process.env.APP_URL?.trim();

  const retryMinutes = 5;
  const nextRetryIso =
    row.attempt_number < row.max_attempts
      ? new Date(now.getTime() + retryMinutes * 60 * 1000).toISOString()
      : null;

  if (!sid || !authToken || !fromPhone) {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Simulated',
           sent_at = ?,
           next_retry_at = ?,
           error_message = 'Twilio Voice credentials not configured; recorded in sandbox simulation mode.'
       WHERE id = ?`
    ).run(nowIso, nextRetryIso, deliveryId);
    return;
  }

  const toPhone = normalizePhoneE164(row.recipient_phone);
  if (!toPhone) {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Failed', sent_at = ?, next_retry_at = ?, error_message = 'Invalid patient phone number.'
       WHERE id = ?`
    ).run(nowIso, nextRetryIso, deliveryId);
    return;
  }

  try {
    const twiml = buildTwimlForDelivery(
      row.id,
      row.language,
      row.alert_title,
      row.alert_message,
      webhookBase
    );
    const form = new URLSearchParams({
      To: toPhone,
      From: fromPhone,
      Twiml: twiml,
    });
    if (webhookBase) {
      form.set(
        'StatusCallback',
        `${webhookBase.replace(/\/$/, '')}/api/webhooks/twilio/status?deliveryId=${row.id}`
      );
    }

    const basicAuth = Buffer.from(`${sid}:${authToken}`).toString('base64');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      }
    );

    const data = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };

    if (!response.ok) {
      throw new Error(data.message || `Twilio API HTTP ${response.status}`);
    }

    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Sent', sent_at = ?, provider_reference = ?, next_retry_at = ?, error_message = NULL
       WHERE id = ?`
    ).run(nowIso, data.sid || null, nextRetryIso, deliveryId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Twilio Voice call failed';
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'Failed', sent_at = ?, next_retry_at = ?, error_message = ?
       WHERE id = ?`
    ).run(nowIso, nextRetryIso, msg, deliveryId);
  }
}

export function escalateMissedVoiceReminder(deliveryId: number): void {
  runInTransaction(() => {
    const delivery = db
      .prepare(
        `SELECT nd.*, p.name AS patient_name, a.title AS alert_title
         FROM notification_deliveries nd
         JOIN patients p ON p.id = nd.patient_id
         JOIN alerts a ON a.id = nd.alert_id
         WHERE nd.id = ?`
      )
      .get(deliveryId) as
      | {
          id: number;
          alert_id: number;
          patient_id: number;
          medication_schedule_id: number | null;
          confirmation_status: string;
          patient_name: string;
          alert_title: string;
        }
      | undefined;

    if (!delivery || delivery.confirmation_status === 'Confirmed' || delivery.confirmation_status === 'Escalated') {
      return;
    }

    db.prepare(
      `UPDATE notification_deliveries
       SET confirmation_status = 'Escalated', next_retry_at = NULL
       WHERE id = ?`
    ).run(deliveryId);

    if (delivery.medication_schedule_id) {
      db.prepare(
        `UPDATE medication_schedules
         SET status = 'Missed'
         WHERE id = ? AND status IN ('Scheduled', 'Reminder Sent')`
      ).run(delivery.medication_schedule_id);

      const sched = db
        .prepare(`SELECT medication_id FROM medication_schedules WHERE id = ?`)
        .get(delivery.medication_schedule_id) as { medication_id: number } | undefined;

      if (sched) {
        db.prepare(
          `INSERT INTO medication_logs
            (medication_id, schedule_id, patient_id, action_type, status, source, notes)
           VALUES (?, ?, ?, 'missed', 'Missed', 'SmartCare Escalation Engine', 'All 3 voice call reminder attempts went unacknowledged.')`
        ).run(sched.medication_id, delivery.medication_schedule_id, delivery.patient_id);
      }
    }

    db.prepare(
      `INSERT INTO alerts
        (patient_id, medication_schedule_id, title, message, alert_type, severity, status, scheduled_at, created_by)
       VALUES (?, ?, ?, ?, 'Escalation', 'high', 'Open', ?, 'SmartCare Escalation Engine')`
    ).run(
      delivery.patient_id,
      delivery.medication_schedule_id,
      `Missed medication escalation: ${delivery.patient_name}`,
      `Patient did not acknowledge "${delivery.alert_title}" after 3 automated voice reminder attempts. Caregiver / Nurse follow-up is required.`,
      new Date().toISOString()
    );

    db.prepare(
      `UPDATE patients SET status = 'Attention Required' WHERE id = ? AND status != 'Discharged'`
    ).run(delivery.patient_id);

    recordAuditLog({
      action: 'VOICE_RETRY_ESCALATED',
      entityType: 'notification_delivery',
      entityId: deliveryId,
      details: `Escalated unacknowledged reminder for patient #${delivery.patient_id} after 3 attempts.`,
    });
  });
}

export function confirmAlertAndStopRetries(
  alertId: number,
  acknowledgedBy: string,
  markIntakeVerified = false
): { updatedDeliveries: number } {
  return runInTransaction(() => {
    const nowIso = new Date().toISOString();
    const alert = db
      .prepare(`SELECT id, patient_id, medication_schedule_id FROM alerts WHERE id = ?`)
      .get(alertId) as
      | { id: number; patient_id: number; medication_schedule_id: number | null }
      | undefined;

    if (!alert) {
      throw new Error('Alert not found.');
    }

    const result = db
      .prepare(
        `UPDATE notification_deliveries
         SET confirmation_status = 'Confirmed',
             confirmed_at = COALESCE(confirmed_at, ?),
             next_retry_at = NULL,
             status = CASE WHEN channel = 'Voice' AND status = 'Pending' THEN 'Cancelled' ELSE status END
         WHERE alert_id = ? AND recipient_type = 'Patient'`
      )
      .run(nowIso, alertId);

    db.prepare(
      `UPDATE alerts
       SET status = 'Acknowledged'
       WHERE id = ? AND status = 'Open'`
    ).run(alertId);

    if (alert.medication_schedule_id) {
      const newSchedStatus = markIntakeVerified ? 'Taken' : 'Acknowledged';
      db.prepare(
        `UPDATE medication_schedules
         SET status = ?,
             acknowledged_at = COALESCE(acknowledged_at, ?),
             acknowledged_by = COALESCE(acknowledged_by, ?),
             taken_at = CASE WHEN ? = 1 THEN COALESCE(taken_at, ?) ELSE taken_at END
         WHERE id = ?`
      ).run(newSchedStatus, nowIso, acknowledgedBy, markIntakeVerified ? 1 : 0, nowIso, alert.medication_schedule_id);

      const sched = db
        .prepare(`SELECT medication_id FROM medication_schedules WHERE id = ?`)
        .get(alert.medication_schedule_id) as { medication_id: number } | undefined;

      if (sched) {
        db.prepare(
          `INSERT INTO medication_logs
            (medication_id, schedule_id, patient_id, action_type, status, source, notes)
           VALUES (?, ?, ?, 'acknowledgement', 'Acknowledged', ?, 'Patient/family acknowledged reminder; distinct from verified physical intake.')`
        ).run(sched.medication_id, alert.medication_schedule_id, alert.patient_id, acknowledgedBy);
      }
    }

    return { updatedDeliveries: Number(result.changes || 0) };
  });
}

let isProcessing = false;

export async function processDueNotifications(): Promise<{
  schedulesTriggered: number;
  deliveriesDispatched: number;
  voiceRetriesTriggered: number;
  escalationsCreated: number;
  overdueVisitsMarked: number;
}> {
  if (isProcessing) {
    return {
      schedulesTriggered: 0,
      deliveriesDispatched: 0,
      voiceRetriesTriggered: 0,
      escalationsCreated: 0,
      overdueVisitsMarked: 0,
    };
  }
  isProcessing = true;

  try {
    const nowIso = new Date().toISOString();
    const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19);

    let schedulesTriggered = 0;
    const deliveriesToDispatch: Array<{ id: number; channel: 'WhatsApp' | 'Voice' }> = [];

    // 1. Convert due medication_schedules into Alerts + NotificationDeliveries atomically
    runInTransaction(() => {
      const dueSchedules = db
        .prepare(
          `SELECT ms.id AS schedule_id, ms.medication_id, ms.patient_id, ms.scheduled_time, ms.scheduled_at,
                  m.name AS med_name, m.dosage, p.phone, p.language, p.opt_in_whatsapp, p.opt_in_voice
           FROM medication_schedules ms
           JOIN medications m ON m.id = ms.medication_id
           JOIN patients p ON p.id = ms.patient_id
           WHERE ms.status = 'Scheduled'
             AND m.is_active = 1
             AND (ms.scheduled_at <= ? OR ms.scheduled_at <= ?)
           LIMIT 50`
        )
        .all(nowIso, localNow) as Array<{
        schedule_id: number;
        medication_id: number;
        patient_id: number;
        scheduled_time: string;
        scheduled_at: string;
        med_name: string;
        dosage: string;
        phone: string;
        language: SupportedLanguage;
        opt_in_whatsapp: number;
        opt_in_voice: number;
      }>;

      for (const s of dueSchedules) {
        const lang: SupportedLanguage =
          s.language === 'Tamil' || s.language === 'Malayalam' ? s.language : 'English';
        const msgBuilder = WHATSAPP_MESSAGES[lang];
        const msg = msgBuilder(s.med_name, s.dosage, s.scheduled_time);

        const alertRes = db
          .prepare(
            `INSERT INTO alerts
              (patient_id, medication_schedule_id, title, message, alert_type, severity, status, scheduled_at, created_by)
             VALUES (?, ?, ?, ?, 'Medication reminder', 'medium', 'Open', ?, 'SmartCare Scheduler')`
          )
          .run(
            s.patient_id,
            s.schedule_id,
            `${s.med_name} (${s.dosage}) · ${s.scheduled_time}`,
            msg,
            s.scheduled_at
          );
        const alertId = Number(alertRes.lastInsertRowid);

        if (s.phone && s.phone.trim()) {
          if (s.opt_in_whatsapp) {
            const waRes = db
              .prepare(
                `INSERT INTO notification_deliveries
                  (alert_id, patient_id, medication_schedule_id, recipient_type, recipient_phone, language, channel, status, confirmation_status, scheduled_at, attempt_number, max_attempts)
                 VALUES (?, ?, ?, 'Patient', ?, ?, 'WhatsApp', 'Pending', 'Awaiting', ?, 1, 1)`
              )
              .run(alertId, s.patient_id, s.schedule_id, s.phone, lang, s.scheduled_at);
            deliveriesToDispatch.push({ id: Number(waRes.lastInsertRowid), channel: 'WhatsApp' });
          }

          if (s.opt_in_voice) {
            const voiceRes = db
              .prepare(
                `INSERT INTO notification_deliveries
                  (alert_id, patient_id, medication_schedule_id, recipient_type, recipient_phone, language, channel, status, confirmation_status, scheduled_at, attempt_number, max_attempts)
                 VALUES (?, ?, ?, 'Patient', ?, ?, 'Voice', 'Pending', 'Awaiting', ?, 1, 3)`
              )
              .run(alertId, s.patient_id, s.schedule_id, s.phone, lang, s.scheduled_at);
            deliveriesToDispatch.push({ id: Number(voiceRes.lastInsertRowid), channel: 'Voice' });
          }
        }

        db.prepare(`UPDATE medication_schedules SET status = 'Reminder Sent' WHERE id = ?`).run(
          s.schedule_id
        );
        schedulesTriggered += 1;
      }

      // Also pick up manually created Pending deliveries that are now due
      const pendingManual = db
        .prepare(
          `SELECT id, channel FROM notification_deliveries
           WHERE status = 'Pending' AND scheduled_at <= ?
           LIMIT 50`
        )
        .all(nowIso) as Array<{ id: number; channel: 'WhatsApp' | 'Voice' }>;

      for (const row of pendingManual) {
        if (!deliveriesToDispatch.some((d) => d.id === row.id)) {
          deliveriesToDispatch.push(row);
        }
      }
    });

    // 2. Dispatch queued WhatsApp & Voice notifications
    let deliveriesDispatched = 0;
    for (const item of deliveriesToDispatch) {
      if (item.channel === 'WhatsApp') {
        await dispatchWhatsAppDelivery(item.id);
      } else {
        await dispatchVoiceDelivery(item.id);
      }
      deliveriesDispatched += 1;
    }

    // 3. Process Voice retries (attempts 2 and 3) and Escalation after attempt 3
    let voiceRetriesTriggered = 0;
    let escalationsCreated = 0;

    const dueRetries = db
      .prepare(
        `SELECT id, attempt_number, max_attempts
         FROM notification_deliveries
         WHERE channel = 'Voice'
           AND confirmation_status = 'Awaiting'
           AND status IN ('Simulated', 'Sent', 'Failed')
           AND next_retry_at IS NOT NULL
           AND next_retry_at <= ?
         LIMIT 50`
      )
      .all(nowIso) as Array<{ id: number; attempt_number: number; max_attempts: number }>;

    for (const retry of dueRetries) {
      if (retry.attempt_number < retry.max_attempts) {
        db.prepare(
          `UPDATE notification_deliveries
           SET attempt_number = attempt_number + 1, status = 'Pending', next_retry_at = NULL
           WHERE id = ?`
        ).run(retry.id);
        await dispatchVoiceDelivery(retry.id);
        voiceRetriesTriggered += 1;
      } else {
        escalateMissedVoiceReminder(retry.id);
        escalationsCreated += 1;
      }
    }

    // 4. Escalate any voice delivery that already finished attempt 3 and passed retry window
    const exhaustedVoice = db
      .prepare(
        `SELECT id FROM notification_deliveries
         WHERE channel = 'Voice'
           AND confirmation_status = 'Awaiting'
           AND attempt_number >= max_attempts
           AND sent_at IS NOT NULL
           AND datetime(sent_at, '+5 minutes') <= datetime(?)
         LIMIT 25`
      )
      .all(nowIso) as Array<{ id: number }>;

    for (const row of exhaustedVoice) {
      escalateMissedVoiceReminder(row.id);
      escalationsCreated += 1;
    }

    // 5. Mark overdue nurse follow-up visits (>2h past scheduled_at)
    const overdueRes = db
      .prepare(
        `UPDATE follow_up_visits
         SET status = 'Overdue'
         WHERE status = 'Pending' AND datetime(scheduled_at, '+2 hours') < datetime(?)`
      )
      .run(nowIso);

    return {
      schedulesTriggered,
      deliveriesDispatched,
      voiceRetriesTriggered,
      escalationsCreated,
      overdueVisitsMarked: Number(overdueRes.changes || 0),
    };
  } finally {
    isProcessing = false;
  }
}

let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

export function startNotificationScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule('* * * * *', () => {
    void processDueNotifications().catch((err) => {
      console.error('[SmartCare Scheduler Error]', err);
    });
  });
}
