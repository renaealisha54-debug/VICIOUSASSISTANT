'use server';
/**
 * @fileOverview Analyzes images and provides contextual descriptions via Groq vision.
 *
 * - aiAssistantImageContextualAnalysis - A function that handles the image analysis process.
 * - AiAssistantImageContextualAnalysisInput - The input type for the aiAssistantImageContextualAnalysis function.
 * - AiAssistantImageContextualAnalysisOutput - The return type for the aiAssistantImageContextualAnalysis function.
 */

import { groqVision } from '@/ai/groq-client';

export type AiAssistantImageContextualAnalysisInput = {
  /** A photo as a data URI, e.g. 'data:<mimetype>;base64,<encoded_data>'. */
  photoDataUri: string;
};
export type AiAssistantImageContextualAnalysisOutput = {
  description: string;
};

export async function aiAssistantImageContextualAnalysis(
  input: AiAssistantImageContextualAnalysisInput
): Promise<AiAssistantImageContextualAnalysisOutput> {
  const description = await groqVision(
    `You are Vicious Assistant, a highly intelligent AI designed to analyze images and provide detailed, contextual descriptions.
Carefully examine the provided image and describe what you see, including any relevant context, objects, people, or activities.
Provide a comprehensive description.`,
    input.photoDataUri
  );
  return { description };
}
