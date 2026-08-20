'use server';
/**
 * @fileOverview Parses and confirms user reminders via Groq (JSON mode).
 *
 * - aiAssistantSetReminder - A function that handles parsing and confirming user reminders.
 * - SetReminderInput - The input type for the aiAssistantSetReminder function.
 * - SetReminderOutput - The return type for the aiAssistantSetReminder function.
 */

import { groqJson } from '@/ai/groq-client';

export type SetReminderInput = {
  /** The raw voice command or text input, e.g. "remind me to call Mom tomorrow at 10 AM". */
  query: string;
};

export type SetReminderOutput = {
  reminderText: string;
  reminderTime?: string;
  reminderDate?: string;
  confirmationMessage: string;
  isReminderParsable: boolean;
};

export async function aiAssistantSetReminder(
  input: SetReminderInput
): Promise<SetReminderOutput> {
  const output = await groqJson<SetReminderOutput>(
    `You are Vicious, a highly intelligent AI assistant designed to set reminders based on user voice commands.
Your task is to extract the reminder details from the user's query, specifically the task/event, time, and date.
Then, generate a confirmation message for the user.

If you cannot extract enough information to form a reminder (e.g., just a task but no time/date, or unrelated query), set 'isReminderParsable' to false, and ask the user for more clarification in the 'confirmationMessage'.

User Query: ${input.query}

Respond strictly as a JSON object with these fields:
- reminderText: string (the core task/event; empty string if none found)
- reminderTime: string, optional (e.g. "10:00 AM", "noon"; omit if not specified)
- reminderDate: string, optional (e.g. "tomorrow", "December 25th"; omit if not specified)
- confirmationMessage: string (friendly confirmation or clarification request)
- isReminderParsable: boolean`
  );

  if (!output) {
    throw new Error('Failed to get a response from the AI for setting reminder.');
  }
  return output;
}
