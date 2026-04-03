import { Nullable } from "./common.types";

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
};

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  metadata: Nullable<Record<string, unknown>>;
  isDeleted: boolean;
  updatedAt: string | null;
};
