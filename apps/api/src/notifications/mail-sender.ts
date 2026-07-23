import { Resend } from 'resend';
import { requireEnvPairOrNone } from '../config/env';

export interface MailSender {
  send(to: string, subject: string, html: string, idempotencyKey?: string): Promise<void>;
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
    const { error } = await this.client.emails.send(
      { from: this.from, to, subject, html },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (error) {
      throw new Error(`Resend refused the send: ${error.name} - ${error.message}`);
    }
  }
}

const resendCredentials = requireEnvPairOrNone('RESEND_API_KEY', 'MAIL_FROM');

export const mailSender: MailSender & {
  lastSentTo?(to: string): { to: string; subject: string; html: string } | undefined;
} = resendCredentials
  ? new ResendMailSender(resendCredentials.first, resendCredentials.second)
  : new ConsoleMailSender();
