import { FastifyInstance } from 'fastify';
import { WorkerConfig } from './config.js';

export interface HealthResponse {
  status: 'ok';
  startToken: string;
  bootId: string;
  timestamp: string;
  uptimeMs: number;
}

export interface ReadinessResponse {
  ready: boolean;
  checks: {
    database: boolean;
    port: boolean;
  };
  timestamp: string;
}

let startTime = Date.now();

export function registerHealthRoutes(app: FastifyInstance, config: WorkerConfig): void {
  app.get('/api/health', async (_request, reply) => {
    const response: HealthResponse = {
      status: 'ok',
      startToken: config.startToken,
      bootId: config.bootId,
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - startTime,
    };
    return reply.send(response);
  });

  app.get('/api/readiness', async (_request, reply) => {
    const checks = {
      database: true,
      port: true,
    };
    
    const response: ReadinessResponse = {
      ready: Object.values(checks).every(v => v),
      checks,
      timestamp: new Date().toISOString(),
    };
    return reply.send(response);
  });
}

export function setStartTime(time: number): void {
  startTime = time;
}

export function getStartTime(): number {
  return startTime;
}
