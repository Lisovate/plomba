/**
 * Muse Spark as a tool-using agent through the Responses API. Requests are
 * sent with `store: false`, so the conversation (including the model's
 * encrypted reasoning items) is replayed with every request instead of being
 * referenced by `previous_response_id`.
 */

import { UpstreamError } from '../../errors.ts';
import type { Agent, AgentRun, AgentTask } from '../../ports.ts';
import {
  type MetaClient,
  outputText,
  type ResponsesInputItem,
  type ResponsesResponse,
  toDataUrl,
} from './client.ts';
import type { MuseSparkOptions } from './muse-spark.ts';

/** Model turns per `answer()`; each turn can call several tools. */
const MAX_TURNS = 8;

type FunctionCall = Extract<ResponsesResponse['output'][number], { type: 'function_call' }>;

const isFunctionCall = (item: ResponsesResponse['output'][number]): item is FunctionCall =>
  item.type === 'function_call' && 'call_id' in item;

export class MuseSparkAgent implements Agent {
  readonly #client: MetaClient;
  readonly #options: MuseSparkOptions;

  constructor(client: MetaClient, options: MuseSparkOptions) {
    this.#client = client;
    this.#options = options;
  }

  start<T>(task: AgentTask<T>): AgentRun<T> {
    const client = this.#client;
    const options = this.#options;
    const toolCalls: string[] = [];
    const history: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: task.prompt },
          ...(task.images ?? []).map((image) => ({
            type: 'input_image' as const,
            image_url: toDataUrl(image),
          })),
        ],
      },
    ];
    const tools = task.tools.map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    return {
      toolCalls,
      correct(feedback: string) {
        history.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: feedback }],
        });
      },
      async answer(): Promise<T> {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = await client.createResponse({
            model: options.model,
            reasoning: { effort: options.reasoningEffort },
            instructions: task.instructions,
            input: history,
            tools,
            text: {
              format: {
                type: 'json_schema',
                name: task.answer.name,
                schema: task.answer.schema,
                strict: true,
              },
            },
          });
          history.push(...response.output);
          const calls = response.output.filter(isFunctionCall);
          if (calls.length === 0) return parseAnswer(response, task);

          for (const call of calls) {
            toolCalls.push(call.name);
            const tool = task.tools.find((t) => t.name === call.name);
            let output: unknown;
            try {
              if (!tool) throw new Error(`Unknown tool ${call.name}`);
              output = await tool.run(
                JSON.parse(call.arguments || '{}') as Record<string, unknown>,
              );
            } catch (error) {
              output = { error: (error as Error).message };
            }
            history.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: JSON.stringify(output),
            });
          }
        }
        throw new UpstreamError(`The agent did not finish within ${MAX_TURNS} turns`);
      },
    };
  }
}

function parseAnswer<T>(response: ResponsesResponse, task: AgentTask<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(outputText(response));
  } catch (cause) {
    throw new UpstreamError('The agent answered with text that is not JSON', { cause });
  }
  const parsed = task.parser.safeParse(json);
  if (!parsed.success) {
    throw new UpstreamError('The agent answered with JSON that does not match the schema', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
