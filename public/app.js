const state = {
  recipients: [],
  tasks: [],
  authenticated: false,
  editingTaskId: null,
  editRecipients: [],
};

const elements = {
  appShell: document.getElementById('app-shell'),
  authScreen: document.getElementById('auth-screen'),
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginMessage: document.getElementById('login-message'),
  logoutButton: document.getElementById('logout-btn'),
  recipientInput: document.getElementById('recipient-input'),
  addRecipient: document.getElementById('add-recipient'),
  recipientList: document.getElementById('recipient-list'),
  form: document.getElementById('task-form'),
  sendTime: document.getElementById('sendTime'),
  isRecurring: document.getElementById('isRecurring'),
  recurrenceFields: document.getElementById('recurrence-fields'),
  tasksTable: document.getElementById('tasks-table'),
  tasksBody: document.getElementById('tasks-body'),
  tasksEmpty: document.getElementById('tasks-empty'),
  formMessage: document.getElementById('form-message'),
  rowTemplate: document.getElementById('task-row-template'),
  smtpHost: document.getElementById('smtp-host'),
  smtpPort: document.getElementById('smtp-port'),
  smtpSecure: document.getElementById('smtp-secure'),
  smtpUser: document.getElementById('smtp-user'),
  smtpPass: document.getElementById('smtp-pass'),
  smtpFrom: document.getElementById('smtp-from'),
  editModal: document.getElementById('edit-modal'),
  editForm: document.getElementById('edit-form'),
  editSubject: document.getElementById('edit-subject'),
  editBody: document.getElementById('edit-body'),
  editSendTime: document.getElementById('edit-sendTime'),
  editSmtpHost: document.getElementById('edit-smtp-host'),
  editSmtpPort: document.getElementById('edit-smtp-port'),
  editSmtpSecure: document.getElementById('edit-smtp-secure'),
  editSmtpUser: document.getElementById('edit-smtp-user'),
  editSmtpPass: document.getElementById('edit-smtp-pass'),
  editSmtpFrom: document.getElementById('edit-smtp-from'),
  editCancel: document.getElementById('edit-cancel'),
  editCancelCta: document.getElementById('edit-cancel-cta'),
  editMessage: document.getElementById('edit-message'),
  editRecipientInput: document.getElementById('edit-recipient-input'),
  editAddRecipient: document.getElementById('edit-add-recipient'),
  editRecipientList: document.getElementById('edit-recipient-list'),
  editIsRecurring: document.getElementById('edit-isRecurring'),
  editRecurrenceFields: document.getElementById('edit-recurrence-fields'),
  editRecurrenceValue: document.getElementById('edit-recurrenceValue'),
  editRecurrenceUnit: document.getElementById('edit-recurrenceUnit'),
};

const UNIT_LABELS = {
  minutes: '分钟',
  hours: '小时',
  days: '天',
  weeks: '周',
  months: '月',
};

init();

async function init() {
  bindEvents();
  renderRecipients();
  renderEditRecipients();
  toggleRecurrence(elements.isRecurring.checked);
  await refreshSession();
}

function bindEvents() {
  elements.addRecipient.addEventListener('click', () => {
    addRecipient(elements.recipientInput.value);
  });

  elements.recipientInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addRecipient(elements.recipientInput.value);
    }
  });

  elements.isRecurring.addEventListener('change', (event) => {
    toggleRecurrence(event.target.checked);
  });

  elements.form.addEventListener('submit', handleSubmit);

  elements.tasksBody.addEventListener('click', async (event) => {
    const target = event.target;
    const taskId = target.dataset.taskId;

    if (target.matches('button.danger')) {
      await handleDelete(taskId);
    } else if (target.matches('button.send-now')) {
      await handleSendNow(taskId);
    } else if (target.matches('button.edit-task')) {
      openEditModal(taskId);
    }
  });

  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.editForm.addEventListener('submit', handleEditSubmit);
  elements.editCancel.addEventListener('click', closeEditModal);
  elements.editCancelCta.addEventListener('click', closeEditModal);
  elements.editModal.addEventListener('click', (event) => {
    if (event.target === elements.editModal) {
      closeEditModal();
    }
  });
  elements.editAddRecipient.addEventListener('click', () => addEditRecipient(elements.editRecipientInput.value));
  elements.editRecipientInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addEditRecipient(elements.editRecipientInput.value);
    }
  });
  elements.editIsRecurring.addEventListener('change', (event) => {
    toggleEditRecurrence(event.target.checked);
  });
}

async function refreshSession(options = {}) {
  const { withBootstrap = true, updateShell = true } = options;
  try {
    const res = await fetch('/api/session', { credentials: 'include' });
    const data = await res.json();
    state.authenticated = Boolean(data?.authenticated);
  } catch (error) {
    state.authenticated = false;
  }

  if (updateShell) {
    updateShellVisibility();
  }

  if (state.authenticated && withBootstrap) {
    await bootstrapAuthenticated();
  } else if (!state.authenticated && updateShell) {
    state.recipients = [];
    renderRecipients();
    clearFormMessage();
  }
}

function updateShellVisibility() {
  if (state.authenticated) {
    elements.appShell.classList.remove('hidden');
    elements.authScreen.classList.add('hidden');
  } else {
    elements.appShell.classList.add('hidden');
    elements.authScreen.classList.remove('hidden');
    elements.loginPassword.value = '';
  }
}

async function bootstrapAuthenticated() {
  setDefaultSendTime();
  toggleRecurrence(elements.isRecurring.checked);
  renderRecipients();
  await loadTasks();
}

async function handleLogin(event) {
  event.preventDefault();
  clearLoginMessage();

  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value;

  if (!username || !password) {
    showLoginMessage('请输入用户名和密码。', 'error');
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.error || '登录失败。');
    }

    state.authenticated = true;
    updateShellVisibility();
    elements.loginForm.reset();
    await bootstrapAuthenticated();
  } catch (error) {
    showLoginMessage(error.message || '登录失败，请稍后重试。', 'error');
  }
}

async function handleLogout() {
  try {
    await authorizedFetch('/api/logout', { method: 'POST' });
  } catch {
    // ignore
  }

  state.authenticated = false;
  updateShellVisibility();
  state.recipients = [];
  renderRecipients();
}

function setDefaultSendTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  elements.sendTime.value = toLocalInputValue(now);
}

function addRecipient(raw) {
  const email = String(raw || '').trim();
  if (!email) return;

  if (!isEmail(email)) {
    showFormMessage('请输入合法的邮箱地址。', 'error');
    return;
  }

  if (state.recipients.includes(email)) {
    showFormMessage('该邮箱已在列表中。', 'error');
    return;
  }

  state.recipients.push(email);
  elements.recipientInput.value = '';
  renderRecipients();
  clearFormMessage();
}

function removeRecipient(email) {
  state.recipients = state.recipients.filter((item) => item !== email);
  renderRecipients();
}

function renderRecipients() {
  elements.recipientList.innerHTML = '';

  if (!state.recipients.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'helper-text';
    placeholder.textContent = '暂未添加收件人';
    elements.recipientList.appendChild(placeholder);
    return;
  }

  state.recipients.forEach((email) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${email}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `删除 ${email}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeRecipient(email));
    chip.appendChild(removeBtn);
    elements.recipientList.appendChild(chip);
  });
}

function addEditRecipient(raw) {
  const email = String(raw || '').trim();
  if (!email) {
    return;
  }

  if (!isEmail(email)) {
    showEditMessage('请输入合法的邮箱地址。', 'error');
    return;
  }

  if (state.editRecipients.includes(email)) {
    showEditMessage('该邮箱已在列表中。', 'error');
    return;
  }

  state.editRecipients.push(email);
  elements.editRecipientInput.value = '';
  renderEditRecipients();
  clearEditMessage();
}

function removeEditRecipient(email) {
  state.editRecipients = state.editRecipients.filter((item) => item !== email);
  renderEditRecipients();
}

function renderEditRecipients() {
  elements.editRecipientList.innerHTML = '';

  if (!state.editRecipients.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'helper-text';
    placeholder.textContent = '暂未添加收件人';
    elements.editRecipientList.appendChild(placeholder);
    return;
  }

  state.editRecipients.forEach((email) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${email}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-edit-recipient';
    removeBtn.setAttribute('aria-label', `删除 ${email}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeEditRecipient(email));
    chip.appendChild(removeBtn);
    elements.editRecipientList.appendChild(chip);
  });
}

async function loadTasks() {
  if (!state.authenticated) return;

  try {
    const { data } = await authorizedFetch('/api/tasks');
    state.tasks = data?.tasks || [];
    renderTasks();
  } catch (error) {
    console.error('加载任务失败', error);
  }
}

function renderTasks() {
  if (!state.tasks.length) {
    elements.tasksEmpty.classList.remove('hidden');
    elements.tasksTable.classList.add('hidden');
    elements.tasksBody.innerHTML = '';
    return;
  }

  elements.tasksEmpty.classList.add('hidden');
  elements.tasksTable.classList.remove('hidden');
  elements.tasksBody.innerHTML = '';

  state.tasks.forEach((task) => {
    const rowFragment = elements.rowTemplate.content.cloneNode(true);
    const row = rowFragment.querySelector('tr');

    row.querySelector('.task-name').textContent = task.name || '未命名';
    const recipientsContainer = row.querySelector('.task-recipients .chip-list');
    recipientsContainer.innerHTML = '';

    (task.recipients || []).forEach((email) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `<span>${email}</span>`;
      recipientsContainer.appendChild(chip);
    });

    row.querySelector('.task-subject').textContent = task.subject;
    const fromCell = row.querySelector('.task-from');
    fromCell.textContent = task.smtp?.from || task.smtp?.auth?.user || task.smtp?.user || '-';
    row.querySelector('.task-next').textContent = formatDate(task.nextRunAt || task.sendTime);
    row.querySelector('.task-loop').textContent = task.isRecurring
      ? `每 ${task.recurrenceValue} ${UNIT_LABELS[task.recurrenceUnit] || task.recurrenceUnit}`
      : '否';

    const statusCell = row.querySelector('.task-status');
    const pill = document.createElement('span');
    pill.className = `status-pill status-${task.status}`;
    pill.textContent =
      task.status === 'scheduled'
        ? '排队中'
        : task.status === 'sent'
        ? '已完成'
        : task.status === 'error'
        ? '失败'
        : task.status || '--';
    statusCell.appendChild(pill);

    if (task.lastSentAt) {
      const meta = document.createElement('div');
      meta.className = 'task-meta';
      meta.textContent = `上次：${formatDate(task.lastSentAt)}`;
      statusCell.appendChild(meta);
    }

    if (task.lastError) {
      const error = document.createElement('div');
      error.className = 'task-error';
      error.textContent = task.lastError;
      statusCell.appendChild(error);
    }

    const sendBtn = row.querySelector('.task-actions .send-now');
    const deleteBtn = row.querySelector('.task-actions .danger');
    const editBtn = row.querySelector('.task-actions .edit-task');

    sendBtn.dataset.taskId = task.id;
    deleteBtn.dataset.taskId = task.id;
    editBtn.dataset.taskId = task.id;

    elements.tasksBody.appendChild(rowFragment);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFormMessage();

  if (!state.recipients.length) {
    showFormMessage('请至少添加一个收件人。', 'error');
    return;
  }

  const formData = new FormData(elements.form);
  const sendTimeValue = formData.get('sendTime');

  if (!sendTimeValue) {
    showFormMessage('请选择发送时间。', 'error');
    return;
  }

  const sendDate = new Date(sendTimeValue);
  if (Number.isNaN(sendDate.getTime())) {
    showFormMessage('发送时间格式不正确。', 'error');
    return;
  }

  const smtp = collectSmtpSettings();
  if (!smtp.ok) {
    showFormMessage(smtp.error, 'error');
    return;
  }

  const payload = {
    name: formData.get('name'),
    subject: formData.get('subject'),
    body: formData.get('body'),
    sendTime: sendDate.toISOString(),
    recipients: state.recipients,
    isRecurring: formData.get('isRecurring') === 'on',
    recurrenceValue: formData.get('recurrenceValue'),
    recurrenceUnit: formData.get('recurrenceUnit'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    smtp: smtp.value,
  };

  try {
    const { res, data } = await authorizedFetch('/api/tasks', {
      method: 'POST',
      body: payload,
    });

    if (!res.ok) {
      const message = data?.errors ? data.errors.join('；') : data?.error || '保存失败。';
      showFormMessage(message, 'error');
      return;
    }

    showFormMessage('任务保存成功。', 'success');
    elements.form.reset();
    state.recipients = [];
    renderRecipients();
    toggleRecurrence(false);
    setDefaultSendTime();
    await loadTasks();
  } catch (error) {
    showFormMessage(error.message || '网络异常，请稍后再试。', 'error');
  }
}

async function handleDelete(taskId) {
  if (!taskId) return;
  const confirmed = window.confirm('确定删除该任务吗？');
  if (!confirmed) return;

  try {
    const { res, data } = await authorizedFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok && data?.error) {
      throw new Error(data.error);
    }
    await loadTasks();
  } catch (error) {
    showFormMessage(error.message || '删除失败。', 'error');
  }
}

async function handleSendNow(taskId) {
  if (!taskId) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || '立即发送失败。');
    }
    showFormMessage('已触发立即发送。', 'success');
    await loadTasks();
  } catch (error) {
    showFormMessage(error.message || '立即发送失败，请稍后再试。', 'error');
  }
}

function openEditModal(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  state.editingTaskId = taskId;
  state.editRecipients = [...(task.recipients || [])];
  fillEditForm(task);
  elements.editRecipientInput.value = '';
  renderEditRecipients();
  clearEditMessage();
  elements.editModal.classList.remove('hidden');
  elements.editSubject.focus();
}

function closeEditModal() {
  state.editingTaskId = null;
  state.editRecipients = [];
  renderEditRecipients();
  elements.editForm.reset();
  toggleEditRecurrence(false);
  clearEditMessage();
  elements.editModal.classList.add('hidden');
}

function fillEditForm(task) {
  elements.editSubject.value = task.subject || '';
  elements.editBody.value = task.body || '';

  const referenceTime = task.nextRunAt || task.sendTime;
  if (referenceTime) {
    const date = new Date(referenceTime);
    elements.editSendTime.value = Number.isNaN(date.getTime()) ? '' : toLocalInputValue(date);
  } else {
    elements.editSendTime.value = '';
  }

  const smtp = task.smtp || {};
  elements.editSmtpHost.value = smtp.host || '';
  elements.editSmtpPort.value = smtp.port || 587;
  elements.editSmtpSecure.checked = Boolean(smtp.secure);
  elements.editSmtpUser.value = smtp.auth?.user || smtp.user || '';
  elements.editSmtpPass.value = smtp.auth?.pass || smtp.pass || '';
  elements.editSmtpFrom.value = smtp.from || '';

  const isRecurring = Boolean(task.isRecurring);
  elements.editIsRecurring.checked = isRecurring;
  elements.editRecurrenceValue.value = task.recurrenceValue || 1;
  elements.editRecurrenceUnit.value = task.recurrenceUnit || 'months';
  toggleEditRecurrence(isRecurring);
}

async function handleEditSubmit(event) {
  event.preventDefault();
  if (!state.editingTaskId) {
    return;
  }

  clearEditMessage();

  if (!state.editRecipients.length) {
    showEditMessage('请至少添加一个收件人。', 'error');
    return;
  }

  const subject = elements.editSubject.value.trim();
  if (!subject) {
    showEditMessage('主题不能为空。', 'error');
    return;
  }

  const emailBody = elements.editBody.value.trim();
  if (!emailBody) {
    showEditMessage('正文不能为空。', 'error');
    return;
  }

  const sendTimeValue = elements.editSendTime.value;
  if (!sendTimeValue) {
    showEditMessage('请选择发送时间。', 'error');
    return;
  }

  const sendDate = new Date(sendTimeValue);
  if (Number.isNaN(sendDate.getTime())) {
    showEditMessage('发送时间格式不正确。', 'error');
    return;
  }

  const editIsRecurring = elements.editIsRecurring.checked;
  let recurrenceValue = Number(elements.editRecurrenceValue.value);
  const recurrenceUnit = elements.editRecurrenceUnit.value;

  if (editIsRecurring) {
    if (Number.isNaN(recurrenceValue) || recurrenceValue <= 0) {
      showEditMessage('循环间隔必须大于 0。', 'error');
      return;
    }
    if (!recurrenceUnit) {
      showEditMessage('请选择循环单位。', 'error');
      return;
    }
  } else {
    recurrenceValue = null;
  }

  const smtp = collectEditSmtpSettings();
  if (!smtp.ok) {
    showEditMessage(smtp.error, 'error');
    return;
  }

  const payload = {
    subject,
    body: emailBody,
    sendTime: sendDate.toISOString(),
    recipients: state.editRecipients,
    isRecurring: editIsRecurring,
    recurrenceValue,
    recurrenceUnit: editIsRecurring ? recurrenceUnit : null,
    smtp: smtp.value,
  };

  try {
    const { res, data } = await authorizedFetch(`/api/tasks/${state.editingTaskId}`, {
      method: 'PATCH',
      body: payload,
    });

    if (!res.ok) {
      const message = data?.errors ? data.errors.join('；') : data?.error || '保存失败。';
      throw new Error(message);
    }

    showFormMessage('任务更新成功。', 'success');
    closeEditModal();
    await loadTasks();
  } catch (error) {
    showEditMessage(error.message || '更新失败，请稍后再试。', 'error');
  }
}

function collectSmtpSettings() {
  return buildSmtpPayloadFromFields({
    host: elements.smtpHost.value.trim(),
    port: Number(elements.smtpPort.value),
    secure: elements.smtpSecure.checked,
    user: elements.smtpUser.value.trim(),
    pass: elements.smtpPass.value.trim(),
    from: elements.smtpFrom.value.trim(),
  });
}

function collectEditSmtpSettings() {
  return buildSmtpPayloadFromFields({
    host: elements.editSmtpHost.value.trim(),
    port: Number(elements.editSmtpPort.value),
    secure: elements.editSmtpSecure.checked,
    user: elements.editSmtpUser.value.trim(),
    pass: elements.editSmtpPass.value.trim(),
    from: elements.editSmtpFrom.value.trim(),
  });
}

function buildSmtpPayloadFromFields({ host, port, secure, user, pass, from }) {
  if (!host) {
    return { ok: false, error: 'SMTP 服务器地址不能为空。' };
  }

  if (!Number.isInteger(port) || port <= 0) {
    return { ok: false, error: 'SMTP 端口不合法。' };
  }

  if (!user || !pass) {
    return { ok: false, error: 'SMTP 用户名与密码不能为空。' };
  }

  return {
    ok: true,
    value: {
      host,
      port,
      secure,
      from: from || user,
      user,
      pass,
    },
  };
}

function toggleRecurrence(enabled) {
  elements.isRecurring.checked = enabled;
  elements.recurrenceFields.classList.toggle('hidden', !enabled);
}

function toggleEditRecurrence(enabled) {
  elements.editIsRecurring.checked = enabled;
  elements.editRecurrenceFields.classList.toggle('hidden', !enabled);
}

function formatDate(value) {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function toLocalInputValue(date) {
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

function showFormMessage(message, type = 'info') {
  setFlash(elements.formMessage, message, type);
}

function clearFormMessage() {
  setFlash(elements.formMessage, '');
}

function showEditMessage(message, type = 'info') {
  setFlash(elements.editMessage, message, type);
}

function clearEditMessage() {
  setFlash(elements.editMessage, '');
}

function showLoginMessage(message, type = 'info') {
  setFlash(elements.loginMessage, message, type);
}

function clearLoginMessage() {
  setFlash(elements.loginMessage, '');
}

function setFlash(target, message, type = 'info') {
  if (!target) return;
  if (!message) {
    target.textContent = '';
    target.classList.add('hidden');
    target.classList.remove('success', 'error');
    return;
  }

  target.textContent = message;
  target.classList.remove('hidden', 'success', 'error');
  if (type === 'success') {
    target.classList.add('success');
  } else if (type === 'error') {
    target.classList.add('error');
  }
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildHeaders(headers = {}, body) {
  const result = { ...headers };
  if (body && typeof body === 'string' && !result['Content-Type']) {
    result['Content-Type'] = 'application/json';
  }
  return result;
}

async function authorizedFetch(url, options = {}, attempt = 0) {
  const opts = { credentials: 'include', ...options };

  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
  }

  opts.headers = buildHeaders(opts.headers || {}, opts.body);

  const res = await fetch(url, opts);
  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (res.status === 401) {
    if (attempt === 0) {
      await refreshSession({ withBootstrap: false, updateShell: false });
      if (state.authenticated) {
        return authorizedFetch(url, options, attempt + 1);
      }
    }

    state.authenticated = false;
    updateShellVisibility();
    throw new Error('会话失效，请重新登录。');
  }

  return { res, data };
}
