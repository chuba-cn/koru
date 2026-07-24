import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { requireEnv, requireEnvPairOrNone } from '../config/env';

export interface MailSender {
  send(
    to: string,
    subject: string,
    html: string,
    idempotencyKey?: string,
  ): Promise<string | undefined>;
}

/**
 * Logs to the console and keeps a small in-memory tail, so tests can read what
 * KORU just "sent" without a real mail provider. Refuses to run in production
 * rather than silently drop real emails — mirrors ConsoleSmsSender exactly.
 */
class ConsoleMailSender implements MailSender {
  private readonly tail: { to: string; subject: string; html: string }[] = [];

  async send(to: string, subject: string, html: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ConsoleMailSender must not run in production; wire a real MailSender first.',
      );
    }

    console.log(`[mail] to=${to} subject="${subject}"`);
    this.tail.push({ to, subject, html });

    if (this.tail.length > 20) this.tail.shift();

    return undefined;
  }

  /** This is for test only: the most recent message sent to this address */
  lastSentTo(to: string) {
    return [...this.tail].reverse().find((message) => message.to === to);
  }
}

class ResendMailSender implements MailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(to: string, subject: string, html: string, idempotencyKey?: string) {
    const { data, error } = await this.client.emails.send(
      { from: this.from, to, subject, html },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (error) {
      throw new Error(`Resend refused the send: ${error.name} - ${error.message}`);
    }

    return data?.id;
  }
}
/**
 * Local development only, backed by Mailpit, never selected in prod
 * (SMTP_HOST/PORT are dev-only env vars nobody sets in a deployed environment,
 * but the guard is explicit rather than assumed , matching the other two senders).
 */
class SmtpMailSender implements MailSender {
  private readonly transport: nodemailer.Transporter;

  constructor(
    host: string,
    port: number,
    private readonly from: string,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SmtpMailSender must not run in production, wire a real MailSender first.');
    }

    this.transport = nodemailer.createTransport({ host, port, secure: false });
  }

  async send(to: string, subject: string, html: string) {
    const info = await this.transport.sendMail({ from: this.from, to, subject, html });
    return info.messageId;
  }
}

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const smtpCredentials = requireEnvPairOrNone('SMTP_HOST', 'SMTP_PORT');

export const mailSender: MailSender & {
  lastSentTo?(to: string): { to: string; subject: string; html: string } | undefined;
} = resendApiKey
  ? new ResendMailSender(resendApiKey, requireEnv('MAIL_FROM'))
  : smtpCredentials
    ? new SmtpMailSender(
        smtpCredentials.first,
        Number(smtpCredentials.second),
        requireEnv('MAIL_FROM'),
      )
    : new ConsoleMailSender();
