import { Conversation } from "@voquill/types";
import { invoke } from "@tauri-apps/api/core";
import dayjs from "dayjs";
import { BaseRepo } from "./base.repo";

type LocalConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
};

const fromLocalConversation = (local: LocalConversation): Conversation => ({
  id: local.id,
  title: local.title,
  createdAt: dayjs(local.createdAt).toISOString(),
  updatedAt: dayjs(local.updatedAt).toISOString(),
  isDeleted: local.isDeleted,
});

const toLocalConversation = (
  conversation: Conversation,
): LocalConversation => ({
  id: conversation.id,
  title: conversation.title,
  createdAt: dayjs(conversation.createdAt).valueOf(),
  updatedAt: dayjs(conversation.updatedAt).valueOf(),
  isDeleted: conversation.isDeleted,
});

export abstract class BaseConversationRepo extends BaseRepo {
  abstract listConversations(): Promise<Conversation[]>;
  abstract createConversation(
    conversation: Conversation,
  ): Promise<Conversation>;
  abstract updateConversation(
    conversation: Conversation,
  ): Promise<Conversation>;
  abstract deleteConversation(id: string): Promise<void>;
  listConversationsAll?(): Promise<Conversation[]>;
}

export class LocalConversationRepo extends BaseConversationRepo {
  async listConversations(): Promise<Conversation[]> {
    const locals = await invoke<LocalConversation[]>("conversation_list");
    return locals.map(fromLocalConversation);
  }

  async createConversation(conversation: Conversation): Promise<Conversation> {
    const created = await invoke<LocalConversation>("conversation_create", {
      conversation: toLocalConversation(conversation),
    });
    return fromLocalConversation(created);
  }

  async updateConversation(conversation: Conversation): Promise<Conversation> {
    const updated = await invoke<LocalConversation>("conversation_update", {
      conversation: toLocalConversation(conversation),
    });
    return fromLocalConversation(updated);
  }

  async deleteConversation(id: string): Promise<void> {
    await invoke("conversation_delete", { id });
  }

  async listConversationsAll(): Promise<Conversation[]> {
    const locals = await invoke<LocalConversation[]>("conversation_list_all");
    return locals.map(fromLocalConversation);
  }
}
