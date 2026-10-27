import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fastify, FastifyInstance } from 'fastify';
import { registerHealthRoutes, HealthResponse, ReadinessResponse } from '../../src/worker/health.js';
import { loadConfig } from '../../src/worker/config.js';

describe('Health Routes', () => {
  let app: FastifyInstance;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  let baseUrl: string;

  beforeAll(async () => {
    config = loadConfig();
    // Use a different port for testing
    config.port = 37778;
    
    app = fastify({ logger: false });
    registerHealthRoutes(app, config);
    
    await app.listen({ port: config.port, host: config.host });
    baseUrl = `http://${config.host}:${config.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok status with startToken and bootId', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    
    const data: HealthResponse = await response.json();
    expect(data.status).toBe('ok');
    expect(data.startToken).toBeDefined();
    expect(data.bootId).toBeDefined();
    expect(data.timestamp).toBeDefined();
    expect(data.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/readiness returns ready true with checks', async () => {
    const response = await fetch(`${baseUrl}/api/readiness`);
    expect(response.status).toBe(200);
    
    const data: ReadinessResponse = await response.json();
    expect(data.ready).toBe(true);
    expect(data.checks.database).toBe(true);
    expect(data.checks.port).toBe(true);
    expect(data.timestamp).toBeDefined();
  });
});
