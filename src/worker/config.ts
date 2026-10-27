import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { parse } from 'yaml';

export interface WorkerConfig {
  port: number;
  host: string;
  dataDir: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  startToken: string;
  bootId: string;
  apiTimeoutMs: number;
  healthProbeTimeoutMs: number;
  gracefulShutdownMs: number;
}

function generateStartToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

function generateBootId(): string {
  return `${process.pid}-${Date.now()}`;
}

export function loadConfig(): WorkerConfig {
  const configPath = resolve(process.cwd(), 'claude-mem.yaml');
  let fileConfig: Partial<WorkerConfig> = {};
  
  try {
    const content = readFileSync(configPath, 'utf-8');
    fileConfig = parse(content) as Partial<WorkerConfig>;
  } catch {
    // Config file optional, use defaults
  }

  const startToken = generateStartToken();
  const bootId = generateBootId();

  return {
    port: fileConfig.port ?? parseInt(process.env.CLAUDE_MEM_WORKER_PORT ?? '37777', 10),
    host: fileConfig.host ?? process.env.CLAUDE_MEM_WORKER_HOST ?? '127.0.0.1',
    dataDir: fileConfig.dataDir ?? process.env.CLAUDE_MEM_DATA_DIR ?? resolve(process.env.HOME ?? '~', '.claude-mem'),
    logLevel: (fileConfig.logLevel as WorkerConfig['logLevel']) ?? (process.env.CLAUDE_MEM_LOG_LEVEL as WorkerConfig['logLevel']) ?? 'info',
    startToken,
    bootId,
    apiTimeoutMs: fileConfig.apiTimeoutMs ?? parseInt(process.env.CLAUDE_MEM_API_TIMEOUT_MS ?? '30000', 10),
    healthProbeTimeoutMs: fileConfig.healthProbeTimeoutMs ?? parseInt(process.env.CLAUDE_MEM_HEALTH_PROBE_TIMEOUT_MS ?? '5000', 10),
    gracefulShutdownMs: fileConfig.gracefulShutdownMs ?? parseInt(process.env.CLAUDE_MEM_GRACEFUL_SHUTDOWN_MS ?? '10000', 10),
  };
}
