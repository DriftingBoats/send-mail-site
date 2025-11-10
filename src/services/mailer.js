const nodemailer = require('nodemailer');

const transporterCache = new Map();

function sendEmail(task) {
  if (!task || !task.smtp) {
    throw new Error('任务缺少 SMTP 设置。');
  }

  const transport = getTransporter(task.smtp);
  const htmlBody = task.body
    .split('\n')
    .map((line) => `<p>${line || '&nbsp;'}</p>`)
    .join('');

  return transport.sendMail({
    from: task.smtp.from,
    to: task.recipients.join(', '),
    subject: task.subject,
    text: task.body,
    html: htmlBody,
  });
}

function getTransporter(config) {
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.auth.user,
  });

  if (!transporterCache.has(key)) {
    transporterCache.set(
      key,
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
      })
    );
  }

  return transporterCache.get(key);
}

module.exports = {
  sendEmail,
};
