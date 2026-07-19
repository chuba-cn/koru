export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

/**
 * Logs to the console and keeps a small in-memory tail, so e2e tests can read
 * the OTP code Better Auth just "sent" withot a real sms provider.
 */
class ConsoleSmsSender implements SmsSender {
  private readonly tail: { to: string; body: string }[] = [];

  async send(to: string, body: string) {
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
