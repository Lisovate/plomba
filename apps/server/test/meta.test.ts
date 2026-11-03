import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type MetaApiError, MetaClient } from '../src/adapters/meta/client.ts';
import {
  MAX_IMAGES_PER_CALL,
  MuseSparkFaceViewClassifier,
} from '../src/adapters/meta/muse-spark.ts';
import { parseSegmentation } from '../src/adapters/meta/sam.ts';
import { askStructured } from '../src/adapters/meta/structured.ts';
import { silentLogger } from './fakes.ts';

// One frame of SAM 3.1 output for the prompt "button", from the @meta-sam/parser README.
const SAM_OUTPUT =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

describe('parseSegmentation', () => {
  it('decodes boxes and masks', async () => {
    const objects = await parseSegmentation(SAM_OUTPUT);
    expect(objects).toHaveLength(2);
    const [first] = objects;
    // Boxes are half-open: x2=270 becomes right=271.
    expect(first?.box).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    expect(first?.mask.width).toBe(60);
    expect(first?.mask.height).toBe(27);
    expect(first?.mask.data).toHaveLength(27 * 60);
    expect(first?.mask.data.some((v) => v === 1)).toBe(true);
  });

  it('returns nothing for empty output (no instances found)', async () => {
    expect(await parseSegmentation('')).toEqual([]);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const COMPLETED = {
  id: 'resp_1',
  status: 'completed',
  error: null,
  incomplete_details: null,
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
};

describe('MetaClient', () => {
  const request = { model: 'muse-spark-1.3', input: [] };

  it('sends the key as a bearer token and never asks the API to store requests', async () => {
    const seen: { headers: Headers; body: Record<string, unknown> }[] = [];
    const client = new MetaClient({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
      timeoutMs: 1000,
      logger: silentLogger,
      fetch: async (_url, init) => {
        seen.push({
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return jsonResponse(200, COMPLETED);
      },
    });
    await client.createResponse(request);
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer test-key');
    expect(seen[0]?.body.store).toBe(false);
  });

  it('retries rate limits and server errors, then succeeds', async () => {
    const statuses = [429, 503, 200];
    const client = new MetaClient({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'k',
      timeoutMs: 1000,
      logger: silentLogger,
      backoffMs: () => 0,
      fetch: async () => {
        const status = statuses.shift() ?? 200;
        return jsonResponse(status, status === 200 ? COMPLETED : { error: 'busy' });
      },
    });
    await expect(client.createResponse(request)).resolves.toMatchObject({ id: 'resp_1' });
    expect(statuses).toEqual([]);
  });

  it('does not retry a bad request', async () => {
    let calls = 0;
    const client = new MetaClient({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'k',
      timeoutMs: 1000,
      logger: silentLogger,
      backoffMs: () => 0,
      fetch: async () => {
        calls++;
        return jsonResponse(400, { error: { message: 'bad' } });
      },
    });
    await expect(client.createResponse(request)).rejects.toMatchObject({
      name: 'MetaApiError',
      status: 400,
    } satisfies Partial<MetaApiError>);
    expect(calls).toBe(1);
  });
});

describe('MetaClient.transcribe', () => {
  it('sends the settings and the WAV as multipart form data', async () => {
    let form: FormData | undefined;
    let url = '';
    const client = new MetaClient({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'k',
      timeoutMs: 1000,
      logger: silentLogger,
      fetch: async (input, init) => {
        url = String(input);
        form = init?.body as FormData;
        return jsonResponse(200, { transcript: ' wgniecenie ', audioDurationMs: 900, turns: [] });
      },
    });
    const result = await client.transcribe(new Uint8Array([1, 2, 3]), {
      model: 'muse-voice-transcribe-1.0',
      mode: 'PUSH_TO_TALK',
    });
    expect(url).toBe('https://api.example.test/v1/asr/transcribe');
    if (!form) throw new Error('No form data was sent');
    expect(JSON.parse(await (form.get('request') as Blob).text())).toEqual({
      model: 'muse-voice-transcribe-1.0',
      mode: 'PUSH_TO_TALK',
    });
    expect((form.get('audio') as Blob).size).toBe(3);
    expect(result.audioDurationMs).toBe(900);
  });
});

describe('structured output over Chat Completions', () => {
  it('sends the image and JSON schema the way OpenAI-compatible servers expect, without a key it was not given', async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const client = new MetaClient({
      baseUrl: 'http://glimmer.local:11434/v1',
      apiKey: '',
      timeoutMs: 1000,
      logger: silentLogger,
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return jsonResponse(200, { choices: [{ message: { content: '{"colour":"red"}' } }] });
      },
    });
    const answer = await askStructured(
      client,
      {
        api: 'chat-completions',
        model: 'muse-glimmer:30b',
        reasoningEffort: 'low',
        instructions: 'Describe containers.',
        prompt: 'What colour is it?',
        image: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
        schemaName: 'colour',
        schema: { type: 'object' },
      },
      z.object({ colour: z.string() }),
    );

    expect(answer).toEqual({ colour: 'red' });
    const [request] = seen;
    expect(request?.url).toBe('http://glimmer.local:11434/v1/chat/completions');
    expect(request?.headers.has('authorization')).toBe(false);
    expect(request?.body).toMatchObject({
      model: 'muse-glimmer:30b',
      messages: [
        { role: 'system', content: 'Describe containers.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What colour is it?' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'colour', strict: true } },
    });
  });
});

describe('MuseSparkFaceViewClassifier', () => {
  it('splits a long walk-around into runs the endpoint accepts, keeping the order', async () => {
    const imagesPerRequest: number[] = [];
    let next = 0;
    const client = new MetaClient({
      baseUrl: 'http://spark-open.local/v1',
      apiKey: 'test',
      timeoutMs: 1000,
      logger: silentLogger,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: { content: string | { type: string }[] }[];
        };
        const images = body.messages
          .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
          .filter((part) => part.type === 'image_url').length;
        imagesPerRequest.push(images);
        if (images > MAX_IMAGES_PER_CALL) return jsonResponse(400, { error: 'Too many images' });
        // Each run's answer names its frames 1..n; the note says which frame it was overall.
        const views = Array.from({ length: images }, (_, i) => ({
          frame: i + 1,
          face: 'L',
          squareOn: true,
          corner: null,
          clear: true,
          confidence: 0.9,
          note: String(next++),
        }));
        return jsonResponse(200, {
          choices: [{ message: { content: JSON.stringify({ views }) } }],
        });
      },
    });
    const classifier = new MuseSparkFaceViewClassifier(client, {
      model: 'meta-models/muse-spark-open-1026',
      reasoningEffort: 'low',
      api: 'chat-completions',
    });
    const frame = { data: new Uint8Array([1]), mimeType: 'image/jpeg' as const };

    const views = await classifier.classify(Array.from({ length: 12 }, () => frame));

    expect(imagesPerRequest).toEqual([6, 6]);
    expect(views).toHaveLength(12);
    expect(new Set(views.map((v) => v.note)).size).toBe(12);
  });
});
