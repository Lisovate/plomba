import type { z } from 'zod';
import { UpstreamError } from '../../errors.ts';
import type { ImageInput } from '../../ports.ts';
import { type MetaClient, outputText, toDataUrl } from './client.ts';

export interface StructuredCall {
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
  let json: unknown;
  try {
    json = JSON.parse(outputText(response));
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
