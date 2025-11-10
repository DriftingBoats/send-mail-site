const { DateTime } = require('luxon');
const { sendEmail } = require('./services/mailer');
const { listTasks, updateTask } = require('./store/taskStore');

const UNIT_MAP = {
  minutes: { minutes: 1 },
  hours: { hours: 1 },
  days: { days: 1 },
  weeks: { weeks: 1 },
  months: { months: 1 },
};

class Scheduler {
  constructor({ intervalMs = 60_000 } = {}) {
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => {
      this.tick().catch((error) => console.error('调度器执行失败', error));
    }, this.intervalMs);

    this.tick().catch((error) => console.error('调度器执行失败', error));
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  async tick() {
    const tasks = listTasks();
    const now = DateTime.utc();

    for (const task of tasks) {
      if (task.status === 'sent' && !task.isRecurring) {
        continue;
      }

      if (!task.smtp) {
        continue;
      }

      const scheduledFor = task.nextRunAt || task.sendTime;
      if (!scheduledFor) {
        continue;
      }

      const nextRun = DateTime.fromISO(scheduledFor, { zone: 'utc' });
      if (!nextRun.isValid) {
        continue;
      }

      if (nextRun <= now.plus({ seconds: 5 })) {
        await this.executeTask(task);
      }
    }
  }

  nextExecution(task) {
    if (!task.isRecurring || !task.recurrenceValue || !task.recurrenceUnit) {
      return null;
    }

    const nextRunSource = task.nextRunAt || task.sendTime;
    const current = DateTime.fromISO(nextRunSource, { zone: 'utc' });
    if (!current.isValid) {
      return null;
    }

    const unit = UNIT_MAP[task.recurrenceUnit] || UNIT_MAP.days;
    const normalizedUnit = Object.keys(unit)[0];
    const nextRun = current.plus({ [normalizedUnit]: Number(task.recurrenceValue) || 1 });
    return nextRun.toUTC().toISO();
  }

  async executeTask(task) {
    if (!task.smtp) {
      updateTask(task.id, {
        status: 'error',
        lastError: '任务缺少 SMTP 设置。',
      });
      return;
    }

    try {
      await sendEmail(task);
      const updates = {
        lastSentAt: DateTime.utc().toISO(),
        lastError: null,
        status: task.isRecurring ? 'scheduled' : 'sent',
        nextRunAt: task.isRecurring ? this.nextExecution(task) : null,
      };
      updateTask(task.id, updates);
    } catch (error) {
      updateTask(task.id, {
        status: 'error',
        lastError: error.message,
      });
      console.error(`发送任务 ${task.id} 失败`, error);
    }
  }
}

module.exports = Scheduler;
