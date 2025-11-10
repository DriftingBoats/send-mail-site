const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { v4: uuid } = require('uuid');
const { DateTime } = require('luxon');
const Scheduler = require('./scheduler');
const { addTask, listTasks, removeTask, updateTask } = require('./store/taskStore');
const { sendEmail } = require('./services/mailer');

dotenv.config();

const app = express();
const scheduler = new Scheduler();

const ALLOWED_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];
const SESSIONS = new Map();
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 12);

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.warn('ADMIN_USERNAME / ADMIN_PASSWORD 未在环境变量中设置，登录将无法使用。');
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/api/session', (req, res) => {
  const session = getSession(req.cookies?.sid);
  res.json({ authenticated: Boolean(session) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!isCredentialMatch(username, password)) {
    return res.status(401).json({ error: '凭证错误。' });
  }

  const session = createSession();
  setSessionCookie(res, session);
  res.json({ authenticated: true });
});

app.post('/api/logout', requireAuth, (req, res) => {
  destroySession(req.cookies?.sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

const apiRouter = express.Router();
apiRouter.use(requireAuth);

apiRouter.get('/tasks', (_req, res) => {
  res.json({ tasks: listTasks() });
});

apiRouter.post('/tasks', (req, res) => {
  const { errors, payload } = validateTaskPayload(req.body);

  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const {
    recipients,
    subject,
    body,
    sendTime,
    isRecurring,
    recurrenceValue,
    recurrenceUnit,
    timezone,
    name,
    smtp,
  } = payload;

  const scheduledAt = DateTime.fromISO(sendTime).toUTC();

  const task = {
    id: uuid(),
    name,
    recipients,
    subject,
    body,
    sendTime: scheduledAt.toISO(),
    nextRunAt: scheduledAt.toISO(),
    isRecurring,
    recurrenceValue: isRecurring ? recurrenceValue : null,
    recurrenceUnit: isRecurring ? recurrenceUnit : null,
    timezone,
    createdAt: DateTime.utc().toISO(),
    status: 'scheduled',
    lastSentAt: null,
    lastError: null,
    smtp,
  };

  addTask(task);

  res.status(201).json(task);
});

apiRouter.delete('/tasks/:id', (req, res) => {
  try {
    removeTask(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

apiRouter.patch('/tasks/:id/recipients', (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在。' });
  }

  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

  if (!['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'action 必须是 add 或 remove。' });
  }

  if (!email || !isEmail(email)) {
    return res.status(400).json({ error: '请输入合法的邮箱地址。' });
  }

  if (action === 'add') {
    if (task.recipients.includes(email)) {
      return res.status(400).json({ error: '收件人已存在。' });
    }
    task.recipients.push(email);
  } else {
    task.recipients = task.recipients.filter((item) => item !== email);
    if (!task.recipients.length) {
      return res.status(400).json({ error: '任务至少需要一个收件人。' });
    }
  }

  const updated = updateTask(task.id, { recipients: task.recipients });
  res.json(updated);
});

apiRouter.patch('/tasks/:id', (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在。' });
  }

  const { errors, updates } = buildUpdatePayload(task, req.body || {});

  if (errors.length) {
    return res.status(400).json({ errors });
  }

  if (!Object.keys(updates).length) {
    return res.json(task);
  }

  const updated = updateTask(task.id, { ...updates, updatedAt: DateTime.utc().toISO() });
  res.json(updated);
});

app.post('/api/tasks/:id/send-now', async (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在。' });
  }

  if (!task.smtp) {
    return res.status(400).json({ error: '任务缺少 SMTP 设置，无法发送。' });
  }

  try {
    const nowIso = DateTime.utc().toISO();
    const nextRunAt = task.isRecurring
      ? scheduler.nextExecution({ ...task, nextRunAt: nowIso, sendTime: task.sendTime })
      : null;

    await sendEmail(task);
    const updates = {
      lastSentAt: nowIso,
      lastError: null,
      status: task.isRecurring ? 'scheduled' : 'sent',
      nextRunAt,
    };
    const updated = updateTask(task.id, updates);
    res.json({ ok: true, task: updated });
  } catch (error) {
    updateTask(task.id, {
      status: 'error',
      lastError: error.message,
    });
    console.error(`任务 ${task.id} 立即发送失败`, error);
    res.status(502).json({ error: error.message || '立即发送失败，请检查配置。' });
  }
});

app.use('/api', apiRouter);

app.get('*', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('服务器异常', err);
  res.status(500).json({ error: '服务器开小差了，请稍后重试。' });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Scheduler server started on http://localhost:${port}`);
  scheduler.start();
});

function validateTaskPayload(body) {
  const errors = [];

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '邮件任务';
  const recipients = normalizeRecipients(body.recipients);
  if (!recipients.length) {
    errors.push('请至少添加一个合法的收件人。');
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) {
    errors.push('主题不能为空。');
  }

  const emailBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!emailBody) {
    errors.push('正文不能为空。');
  }

  const sendTime = parseSendTime(body.sendTime);
  if (!sendTime) {
    errors.push('发送时间不合法。');
  } else if (sendTime < DateTime.utc().minus({ minutes: 1 })) {
    errors.push('发送时间必须大于当前时间。');
  }

  const timezone =
    typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : DateTime.local().zoneName;

  const shouldLoop = Boolean(body.isRecurring);
  const recurrenceRawValue = Number(body.recurrenceValue);
  const isRecurring = shouldLoop && !Number.isNaN(recurrenceRawValue) && recurrenceRawValue > 0;
  let recurrenceValue = null;
  let recurrenceUnit = null;

  if (isRecurring) {
    recurrenceValue = recurrenceRawValue;
    const unit = typeof body.recurrenceUnit === 'string' ? body.recurrenceUnit : '';

    if (!ALLOWED_UNITS.includes(unit)) {
      errors.push('循环单位不支持。');
    } else {
      recurrenceUnit = unit;
    }
  } else if (shouldLoop) {
    errors.push('循环配置不完整，请检查次数与单位。');
  }

  const smtpResult = validateSmtpConfig(body.smtp || body.smtpConfig);
  errors.push(...smtpResult.errors);

  return {
    errors,
    payload: errors.length
      ? null
      : {
          name,
          recipients,
          subject,
          body: emailBody,
          sendTime: sendTime.toISO(),
          isRecurring,
          recurrenceValue,
          recurrenceUnit,
          timezone,
          smtp: smtpResult.config,
        },
  };
}

function normalizeRecipients(rawRecipients) {
  if (!rawRecipients) {
    return [];
  }

  if (Array.isArray(rawRecipients)) {
    return rawRecipients
      .map((recipient) => String(recipient).trim())
      .filter((recipient) => recipient && recipient.includes('@'));
  }

  if (typeof rawRecipients === 'string') {
    return rawRecipients
      .split(',')
      .map((recipient) => recipient.trim())
      .filter((recipient) => recipient && recipient.includes('@'));
  }

  return [];
}

function parseSendTime(value) {
  if (!value) {
    return null;
  }

  const parsed = DateTime.fromISO(value);
  if (!parsed.isValid) {
    return null;
  }

  return parsed.toUTC();
}

function validateSmtpConfig(raw = {}) {
  const errors = [];
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const port = Number(raw.port || 587);
  const secure = Boolean(raw.secure);
  const user =
    typeof raw.user === 'string'
      ? raw.user.trim()
      : typeof raw.auth?.user === 'string'
      ? raw.auth.user.trim()
      : '';
  const pass =
    typeof raw.pass === 'string'
      ? raw.pass.trim()
      : typeof raw.auth?.pass === 'string'
      ? raw.auth.pass.trim()
      : '';
  const from = typeof raw.from === 'string' && raw.from.trim() ? raw.from.trim() : user;

  if (!host) {
    errors.push('SMTP 主机不能为空。');
  }

  if (!Number.isInteger(port) || port <= 0) {
    errors.push('SMTP 端口不合法。');
  }

  if (!user || !pass) {
    errors.push('SMTP 用户名与密码不能为空。');
  }

  if (!from) {
    errors.push('SMTP 发件人不能为空。');
  }

  return {
    errors,
    config: errors.length
      ? null
      : {
          host,
          port,
          secure,
          from,
          auth: {
            user,
            pass,
          },
        },
  };
}

function buildUpdatePayload(task, body) {
  const errors = [];
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    updates.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : task.name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'recipients')) {
    const recipients = normalizeRecipients(body.recipients);
    if (!recipients.length) {
      errors.push('请至少添加一个合法的收件人。');
    } else {
      updates.recipients = recipients;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'subject')) {
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (!subject) {
      errors.push('主题不能为空。');
    } else {
      updates.subject = subject;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'body')) {
    const emailBody = typeof body.body === 'string' ? body.body.trim() : '';
    if (!emailBody) {
      errors.push('正文不能为空。');
    } else {
      updates.body = emailBody;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sendTime')) {
    const sendTime = parseSendTime(body.sendTime);
    if (!sendTime) {
      errors.push('发送时间不合法。');
    } else if (sendTime < DateTime.utc().minus({ minutes: 1 })) {
      errors.push('发送时间必须大于当前时间。');
    } else {
      updates.sendTime = sendTime.toISO();
      updates.nextRunAt = sendTime.toISO();
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'isRecurring') ||
    Object.prototype.hasOwnProperty.call(body, 'recurrenceValue') ||
    Object.prototype.hasOwnProperty.call(body, 'recurrenceUnit')
  ) {
    const shouldLoop = body.isRecurring ?? task.isRecurring;
    const recurrenceRawValue = Number(body.recurrenceValue ?? task.recurrenceValue);
    const isRecurring = Boolean(shouldLoop && !Number.isNaN(recurrenceRawValue) && recurrenceRawValue > 0);
    if (isRecurring) {
      const unit = typeof (body.recurrenceUnit ?? task.recurrenceUnit) === 'string' ? body.recurrenceUnit ?? task.recurrenceUnit : '';
      if (!ALLOWED_UNITS.includes(unit)) {
        errors.push('循环单位不支持。');
      } else {
        updates.isRecurring = true;
        updates.recurrenceValue = recurrenceRawValue;
        updates.recurrenceUnit = unit;
      }
    } else if (shouldLoop) {
      errors.push('循环配置不完整，请检查次数与单位。');
    } else {
      updates.isRecurring = false;
      updates.recurrenceValue = null;
      updates.recurrenceUnit = null;
    }
  }

  if (body.smtp || body.smtpConfig) {
    const smtpResult = validateSmtpConfig(body.smtp || body.smtpConfig);
    if (smtpResult.errors.length) {
      errors.push(...smtpResult.errors);
    } else {
      updates.smtp = smtpResult.config;
    }
  }

  return { errors, updates };
}

function isCredentialMatch(username, password) {
  return (
    typeof username === 'string' &&
    typeof password === 'string' &&
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  );
}

function createSession() {
  const session = { id: crypto.randomUUID(), createdAt: Date.now() };
  SESSIONS.set(session.id, session);
  return session;
}

function getSession(id) {
  if (!id || !SESSIONS.has(id)) {
    return null;
  }

  const session = SESSIONS.get(id);
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    SESSIONS.delete(id);
    return null;
  }

  return session;
}

function destroySession(id) {
  if (id) {
    SESSIONS.delete(id);
  }
}

function setSessionCookie(res, session) {
  res.cookie('sid', session.id, getCookieOptions({ includeMaxAge: true }));
}

function clearSessionCookie(res) {
  res.clearCookie('sid', getCookieOptions({ includeMaxAge: false }));
}

function requireAuth(req, res, next) {
  const session = getSession(req.cookies?.sid);
  if (!session) {
    return res.status(401).json({ error: '未登录或会话已过期。' });
  }

  req.session = session;
  next();
}

function getTaskById(id) {
  return listTasks().find((task) => task.id === id);
}

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getCookieOptions({ includeMaxAge = false } = {}) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
  };

  if (includeMaxAge) {
    options.maxAge = SESSION_TTL_MS;
  }

  if (process.env.COOKIE_SECURE === 'true') {
    options.secure = true;
  }

  return options;
}
