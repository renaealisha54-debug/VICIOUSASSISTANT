export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  repo?: string;
  details?: string;
}

const STORAGE_KEY = "vicious_conversations";

export const saveConversation = (messages: Message[], currentId?: string, repo?: string, details?: string): string => {
  if (messages.length === 0) return "";
  const existing = getSavedConversations();
  const id = currentId || "conv_" + Date.now();
  const title = messages[0]?.content.slice(0, 30) + "...";

  const updated = existing.filter(c => c.id !== id);
  updated.unshift({ id, title, messages, updatedAt: Date.now(), repo, details });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return id;
};

export const getSavedConversations = (): Conversation[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const deleteConversation = (id: string): void => {
  const remaining = getSavedConversations().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
};
