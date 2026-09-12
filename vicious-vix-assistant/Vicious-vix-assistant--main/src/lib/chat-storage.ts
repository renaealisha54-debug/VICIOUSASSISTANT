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

export const importConversations = (raw: any, sourceLabel: string): number => {
  try {
    const list = Array.isArray(raw) ? raw : (raw?.conversations || []);
    const existing = getSavedConversations();
    const newOnes: Conversation[] = [];

    for (const conv of list) {
      const rawMessages = conv.chat_messages || conv.messages || [];
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) continue;

      const messages: Message[] = rawMessages.map((m: any, i: number) => {
        const role: "user" | "assistant" = (m.sender === "human" || m.role === "user") ? "user" : "assistant";
        const content = m.text || (Array.isArray(m.content) ? m.content.map((c: any) => c.text || '').join('\n') : (m.content || ''));
        const ts = m.created_at ? new Date(m.created_at).getTime() : Date.now() + i;
        return { id: m.uuid || `${conv.uuid || 'imp'}_${i}`, role, content, timestamp: ts };
      });

      const id = "imported_" + (conv.uuid || (Date.now() + Math.random()));
      newOnes.push({
        id,
        title: `[${sourceLabel}] ` + (conv.name || messages[0]?.content.slice(0, 30) || "Imported session"),
        messages,
        updatedAt: conv.updated_at ? new Date(conv.updated_at).getTime() : Date.now(),
      });
    }

    const merged = [...newOnes, ...existing.filter(e => !newOnes.some(n => n.id === e.id))];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return newOnes.length;
  } catch {
    return 0;
  }
};
