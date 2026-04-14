export type MessageEnvelope = {
  from: string;
  to: string;
  messageId?: string;
  sentAt?: Date;
  body: string;
};

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trimEnd();
}

export function formatMessageEnvelope(envelope: MessageEnvelope): string {
  const messageId = envelope.messageId ?? crypto.randomUUID();
  const sentAt = (envelope.sentAt ?? new Date()).toISOString();
  const body = normalizeBody(envelope.body);
  return [
    "[tmaxx-message v1]",
    `message_id: ${messageId}`,
    `from: ${envelope.from}`,
    `to: ${envelope.to}`,
    `sent_at: ${sentAt}`,
    "body:",
    body,
    "[/tmaxx-message]",
  ].join("\n");
}
