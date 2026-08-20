import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TEXT_MODEL = 'openai/gpt-oss-120b';
const VISION_MODEL = 'qwen/qwen3.6-27b';

/** Plain-text completion. */
export async function groqText(prompt: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}

/** JSON-constrained completion — prompt must instruct the model to return JSON. */
export async function groqJson<T>(prompt: string): Promise<T> {
  const completion = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content ?? '{}';
  return JSON.parse(raw) as T;
}

/** Vision completion — photoDataUri is a data: URI, e.g. from a file input. */
export async function groqVision(prompt: string, photoDataUri: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: photoDataUri } },
        ],
      },
    ],
  });
  return completion.choices[0]?.message?.content ?? '';
}
