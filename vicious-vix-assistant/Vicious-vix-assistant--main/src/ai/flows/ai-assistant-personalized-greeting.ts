'use server';
/**
 * @fileOverview Generates a personalized greeting from Vicious Assistant via Groq.
 *
 * - personalizeGreeting - A function that generates a personalized greeting.
 * - PersonalizeGreetingInput - The input type for the personalizeGreeting function.
 * - PersonalizeGreetingOutput - The return type for the personalizeGreeting function.
 */

import { groqText } from '@/ai/groq-client';

export type PersonalizeGreetingInput = { userName: string };
export type PersonalizeGreetingOutput = string;

export async function personalizeGreeting(
  input: PersonalizeGreetingInput
): Promise<PersonalizeGreetingOutput> {
  return groqText(`Hello, ${input.userName}! How can I assist you today?`);
}
