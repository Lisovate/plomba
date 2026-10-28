/**
 * A stand-in for the Meta Model API in end-to-end tests: deterministic,
 * offline and free. It answers the requests Plomba makes with recorded or
 * fixed outputs, in the API's own response format. The server under test
 * reaches it through META_API_BASE_URL; no test code runs in production.
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.FAKE_META_PORT ?? 4010);

/** SAM 3.1's real output for "shipping container" on fixtures/container-side.jpg. */
const samContainer = readFileSync(join(here, 'fixtures', 'sam-shipping-container.txt'), 'utf8');

/** What Muse Spark answers, by the name of the JSON schema Plomba asks for. */
const SPARK_ANSWERS: Record<string, unknown> = {
  container_markings: {
    containerNumber: 'CSQU3054383',
    sizeTypeCode: '22G1',
    sealNumbers: ['PL123456'],
    hazardClasses: [],
    notes: 'Clear markings.',
  },
  container_number_choice: { choice: null, reason: 'Not clear.' },
  container_damage: { findings: [] },
};

interface ResponsesBody {
  model: string;
  input: { content?: { type: string; text?: string }[] }[];
  text?: { format?: { name?: string } };
}

function respond(text: string) {
  return {
    id: `resp_fake_${Date.now()}`,
    object: 'response',
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== 'Bearer e2e-test-key')
      return send(401, { error: 'bad key' });

    if (request.url === '/v1/asr/transcribe') {
      return send(200, {
        transcript: 'wgniecenie przy drzwiach',
        audioDurationMs: 1000,
        turns: [],
      });
    }
    if (request.url !== '/v1/responses') return send(404, { error: 'not found' });

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ResponsesBody;
    if (body.model === 'sam-3.1') {
      const prompt = body.input[0]?.content?.find((c) => c.type === 'input_text')?.text;
      return send(200, respond(prompt === 'shipping container' ? samContainer : ''));
    }
    const answer = SPARK_ANSWERS[body.text?.format?.name ?? ''];
    if (!answer) return send(400, { error: `no fake answer for ${body.text?.format?.name}` });
    return send(200, respond(JSON.stringify(answer)));
  });
}).listen(port, () => console.log(`Fake Meta Model API on http://127.0.0.1:${port}/v1`));
