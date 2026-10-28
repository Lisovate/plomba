import type { z } from 'zod';
import { UpstreamError } from '../../errors.ts';
import type { ImageInput } from '../../ports.ts';
import { type MetaClient, outputText, toDataUrl } from './client.ts';

/** `responses` for the Meta Model API; `chat-completions` for it or any OpenAI-compatible server. */
export type ApiStyle = 'responses' | 'chat-completions';

export interface StructuredCall {
  readonly api?: ApiStyle;
  readonly model: string;
  readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  readonly instructions: string;
  readonly prompt: string;
  readonly image: ImageInput;
  readonly schemaName: string;
  /** JSON schema sent to the model (strict mode). */
  readonly schema: Record<string, unknown>;
}

/**
 * Asks a vision model a question about one image and gets JSON back, checked
 * twice: by the API against the JSON schema, and here against a zod schema.
 */
export async function askStructured<T>(
  client: MetaClient,
  call: StructuredCall,
  parser: z.ZodType<T>,
): Promise<T> {
  const text =
    call.api === 'chat-completions'
      ? await viaChat(client, call)
      : await viaResponses(client, call);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new UpstreamError(`${call.model} returned text that is not JSON`, { cause });
  }
  const parsed = parser.safeParse(json);
  if (!parsed.success) {
    throw new UpstreamError(`${call.model} returned JSON that does not match the schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function viaChat(client: MetaClient, call: StructuredCall): Promise<string> {
  const completion = await client.createChatCompletion({
    model: call.model,
    reasoning_effort: call.reasoningEffort,
    messages: [
      { role: 'system', content: call.instructions },
      {
        role: 'user',
        content: [
          { type: 'text', text: call.prompt },
          { type: 'image_url', image_url: { url: toDataUrl(call.image) } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: call.schemaName, schema: call.schema, strict: true },
    },
  });
  return completion.choices[0]?.message.content ?? '';
}

async function viaResponses(client: MetaClient, call: StructuredCall): Promise<string> {
  const response = await client.createResponse({
    model: call.model,
    instructions: call.instructions,
    reasoning: { effort: call.reasoningEffort },
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: call.prompt },
          { type: 'input_image', image_url: toDataUrl(call.image) },
        ],
      },
    ],
    text: {
      format: { type: 'json_schema', name: call.schemaName, schema: call.schema, strict: true },
    },
  });
  return outputText(response);
}
