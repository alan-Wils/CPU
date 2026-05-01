const nodemailer = require("nodemailer");

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendInviteEmail({ to, inviteUrl, companyName, role }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("Email SMTP not configured. Use this invite link:");
    console.log(inviteUrl);
    return;
  }

  const transporter = getTransporter();

  await transporter.sendMail({
    from:
      process.env.EMAIL_FROM ||
      process.env.SMTP_FROM ||
      process.env.SMTP_USER,
    to,
    subject: `You're invited to ${companyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>You were invited to ${companyName}</h2>
        <p>Your role: <b>${role}</b></p>
        <p>Click below to accept your invite and set your password.</p>
        <p><a href="${inviteUrl}">Accept Invite</a></p>
        <p>${inviteUrl}</p>
      </div>
    `,
  });
}

module.exports = {
  sendInviteEmail,
};