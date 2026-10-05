import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { config } from "../../config/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Correlates delivery logs without logging the recipient or body. */
  kind: "password_reset" | "new_device_login" | "admin_security_alert";
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

class SesEmailProvider implements EmailProvider {
  readonly name = "ses";
  private readonly client = new SESv2Client({ region: config.email.awsRegion });
  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: config.email.from,
        Destination: { ToAddresses: [message.to] },
        Content: { Simple: { Subject: { Data: message.subject, Charset: "UTF-8" }, Body: { Text: { Data: message.text, Charset: "UTF-8" } } } },
        EmailTags: [{ Name: "kind", Value: message.kind }],
      }),
    );
  }
}

/** Development only (config refuses it in production): prints the message so a developer can follow reset links. */
class LogEmailProvider implements EmailProvider {
  readonly name = "log";
  async send(message: EmailMessage): Promise<void> {
    console.log(JSON.stringify({ event: "dev_email", to: message.to, subject: message.subject, text: message.text }));
  }
}

/** Test double: keeps messages in memory for assertions. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly outbox: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
  }
}

class DisabledEmailProvider implements EmailProvider {
  readonly name = "disabled";
  async send(message: EmailMessage): Promise<void> {
    console.warn(JSON.stringify({ event: "email_delivery_disabled", kind: message.kind }));
  }
}

function create(): EmailProvider {
  switch (config.email.provider) {
    case "ses":
      return new SesEmailProvider();
    case "memory":
      return new MemoryEmailProvider();
    case "disabled":
      return new DisabledEmailProvider();
    default:
      return new LogEmailProvider();
  }
}

export const emailProvider: EmailProvider = create();

/** Delivery must never fail the request that triggered it (and must not reveal whether an account exists). */
export async function sendEmailSafely(message: EmailMessage): Promise<boolean> {
  try {
    await emailProvider.send(message);
    console.info(JSON.stringify({ event: "email_sent", kind: message.kind, provider: emailProvider.name }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "email_failed", kind: message.kind, provider: emailProvider.name, error: error instanceof Error ? error.name : "unknown" }));
    return false;
  }
}
