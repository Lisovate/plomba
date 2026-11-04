import { describe, expect, it } from 'vitest';
import { OPERATIONS, openApiDocument } from '../src/http/openapi.ts';
import { createTestApp } from './fakes.ts';

describe('GET /api/openapi.json', () => {
  it('describes the API, both webhooks, and is public', async () => {
    const { app } = createTestApp({ accessCode: 'correct horse battery' });
    const response = await app.request('/api/openapi.json');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      webhooks: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.webhooks)).toEqual(['handover.started', 'handover.sealed']);
    expect(Object.keys(doc.paths)).toContain('/handovers/{id}/spoken-damage');
  });

  it('lists only operations the server really has', () => {
    const { app } = createTestApp();
    const routes = new Set(
      app.routes.map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    const missing = OPERATIONS.map((op) => `${op.method} /api${op.path}`).filter(
      (key) => !routes.has(key),
    );
    expect(missing).toEqual([]);
  });

  it('describes the sample roles and container links, and the photo and clip media types', () => {
    const doc = openApiDocument({ serverUrl: 'https://plomba.example.com' });
    const list = JSON.stringify(doc.paths['/samples']);
    for (const field of ['kind', 'clip', 'photo', 'use', 'doors', 'containerNumber']) {
      expect(list).toContain(`"${field}"`);
    }
    const download = doc.paths['/samples/{file}']?.get as {
      responses: Record<string, { content: Record<string, unknown> }>;
    };
    expect(Object.keys(download.responses['200']?.content ?? {})).toEqual([
      'video/mp4',
      'video/quicktime',
      'image/jpeg',
    ]);
  });

  it('describes handover search validation and the next-page header', () => {
    const doc = openApiDocument({ serverUrl: 'https://plomba.example.com' });
    const operation = doc.paths['/handovers']?.get as {
      parameters: { name: string; schema: Record<string, unknown> }[];
      responses: Record<string, { headers?: Record<string, { description: string }> }>;
    };
    const parameters = Object.fromEntries(operation.parameters.map((p) => [p.name, p.schema]));
    expect(Object.keys(parameters)).toEqual([
      'vehicle',
      'container',
      'status',
      'direction',
      'place',
      'limit',
      'cursor',
    ]);
    expect(parameters.status).toMatchObject({ enum: ['open', 'closed'] });
    expect(parameters.direction).toMatchObject({ enum: ['in', 'out'] });
    expect(parameters.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 30,
    });
    expect(operation.responses['200']?.headers?.Link?.description).toContain('rel="next"');
  });
});
