import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './rest';

interface MockResponseInit {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
}

function mockFetchOnce(init: MockResponseInit): void {
  vi.stubGlobal('fetch', vi.fn(async () => init as unknown as Response));
}

describe('ApiClient error handling', () => {
  beforeEach(() => {
    api.clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws the parsed JSON body with the HTTP status attached', async () => {
    mockFetchOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ code: 0, message: 'Invalid token' }),
    });

    await expect(api.getMe()).rejects.toMatchObject({
      code: 0,
      message: 'Invalid token',
      status: 401,
    });
  });

  it('falls back to a synthetic error when the error body is not JSON', async () => {
    // A proxy/gateway 502 often returns an HTML page; res.json() rejects with a
    // SyntaxError. The real HTTP error must surface, not the SyntaxError.
    mockFetchOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    });

    const err = await api.getMe().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err).toMatchObject({ status: 502, message: 'Bad Gateway' });
  });

  it('returns parsed JSON on success', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: '1', username: 'test' }),
    });

    await expect(api.getMe()).resolves.toMatchObject({ id: '1', username: 'test' });
  });
});
