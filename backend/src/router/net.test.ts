import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { modelsUrl, normalizeBaseUrl, probeEndpoint } from './net.js';

let server: http.Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe('probeEndpoint', () => {
  it('returns model ids and sends the bearer key', async () => {
    server = http.createServer((req, res) => {
      if (req.url !== '/v1/models' || req.headers.authorization !== 'Bearer secret') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"error":"unauthorized"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server!.address() as AddressInfo).port;

    await expect(probeEndpoint(`http://127.0.0.1:${port}`, 'secret')).resolves.toEqual(['model-a', 'model-b']);
    await expect(probeEndpoint(`http://127.0.0.1:${port}`)).resolves.toBeNull();
    await expect(probeEndpoint(`http://127.0.0.1:${port}`, 'wrong')).resolves.toBeNull();
  });

  it('returns an empty list for a valid endpoint without models', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[]}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server!.address() as AddressInfo).port;
    await expect(probeEndpoint(`http://127.0.0.1:${port}`)).resolves.toEqual([]);
  });
});

describe('modelsUrl', () => {
  it('appends /v1/models to the base path and preserves a detail suffix', () => {
    expect(modelsUrl('https://api.example.com')).toBe('https://api.example.com/v1/models');
    expect(modelsUrl('http://localhost:11434/openai/')).toBe('http://localhost:11434/openai/v1/models');
    expect(modelsUrl('https://api.example.com/openai', '/gpt-4o')).toBe('https://api.example.com/openai/v1/models/gpt-4o');
  });
});

describe('normalizeBaseUrl', () => {
  it('strips a version suffix and trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com');
    expect(normalizeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeBaseUrl('ftp://example.com')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
  });
});
