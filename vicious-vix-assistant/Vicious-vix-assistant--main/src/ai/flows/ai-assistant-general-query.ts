'use server';
/**
 * @fileOverview Handles general AI assistant queries via Groq.
 *
 * - aiAssistantGeneralQuery - A function that handles general text queries.
 * - AiAssistantGeneralQueryInput - The input type for the aiAssistantGeneralQuery function.
 * - AiAssistantGeneralQueryOutput - The return type for the aiAssistantGeneralQuery function.
 */

import { groqText } from '@/ai/groq-client';

export type AiAssistantGeneralQueryInput = string;
export type AiAssistantGeneralQueryOutput = string;

export async function aiAssistantGeneralQuery(
  input: AiAssistantGeneralQueryInput
): Promise<AiAssistantGeneralQueryOutput> {
  return groqText(
    `You are Vicious Assistant, an AI assistant. Your goal is to provide helpful, intelligent, and concise answers to general questions.

User Query: ${input}

Your Response:`
  );
}
