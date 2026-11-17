export type PushMessage = {
  token: string;
  template: string;
  payload: Record<string, unknown>;
};

export interface PushSender {
  send(message: PushMessage): Promise<void>;
}

export const PUSH_SENDER = Symbol("PUSH_SENDER");

export class RecordingPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  private nextFailureCount = 0;

  failNext(times: number): void {
    this.nextFailureCount = times;
  }

  clear(): void {
    this.sent.length = 0;
    this.nextFailureCount = 0;
  }

  send(message: PushMessage): Promise<void> {
    if (this.nextFailureCount > 0) {
      this.nextFailureCount -= 1;
      return Promise.reject(new Error("Fallo simulado en envío push"));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

export class FcmPushSender implements PushSender {
  constructor(private readonly serverKey: string) {}

  async send(message: PushMessage): Promise<void> {
    if (this.serverKey.trim() === "") {
      throw new Error("Credencial FCM no configurada");
    }
    const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${this.serverKey}`,
      },
      body: JSON.stringify({
        to: message.token,
        data: { template: message.template, ...message.payload },
      }),
    });
    if (!response.ok) {
      throw new Error(`FCM respondió ${String(response.status)}`);
    }
  }
}

export function createPushSenderFromEnv(env: NodeJS.ProcessEnv = process.env): PushSender {
  const fcmKey = env["FCM_SERVER_KEY"]?.trim() ?? "";
  if (fcmKey !== "" && env["NODE_ENV"] !== "test") {
    return new FcmPushSender(fcmKey);
  }
  return new RecordingPushSender();
}
