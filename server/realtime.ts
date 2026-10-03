import { EventEmitter } from "node:events";

export type ConversationEvent = { conversationId: number; messageId: number; senderId: number };
const broker = new EventEmitter();

export function publishConversationMessage(event: ConversationEvent) {
  broker.emit(`conversation:${event.conversationId}`, event);
}

export function subscribeConversation(conversationId: number, listener: (event: ConversationEvent) => void) {
  const channel = `conversation:${conversationId}`;
  broker.on(channel, listener);
  return () => broker.off(channel, listener);
}
