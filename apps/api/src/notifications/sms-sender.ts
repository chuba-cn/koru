export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

/**
 * Logs to the console and keeps a small in-memory tail, so e2e tests can read
 * the OTP code Better Auth just "sent" without a real SMS provider. Refuses to
 * run in production rather than silently leak login codes into server logs —
 * a real provider (Termii, Africa's Talking) lands in the nudges epic, behind
 * this same interface.
 */
class ConsoleSmsSender implements SmsSender {
  private readonly tail: { to: string; body: string }[] = [];

  async send(to: string, body: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ConsoleSmsSender must not run in production; wire a real SmsSender first.');
    }

    console.log(`[sms] to=${to} body="${body}"`);
    this.tail.push({ to, body });

    if (this.tail.length > 20) this.tail.shift();
  }

  /** This is for test only: the most recent message sent to this number */
  lastSentTo(to: string) {
    return [...this.tail].reverse().find((message) => message.to === to);
  }
}

export const smsSender: SmsSender & {
  lastSentTo(to: string): { to: string; body: string } | undefined;
} = new ConsoleSmsSender();
