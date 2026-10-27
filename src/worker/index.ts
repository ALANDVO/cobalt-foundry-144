import { loadConfig } from './config.js';
import { registerHealthRoutes } from './health.js';
import { FastifyInstance, fastify } from 'fastify';

async function buildApp(config: Awaited<ReturnType<typeof loadConfig>>): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
  });

  registerHealthRoutes(app, config);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  
  const app = await buildApp(config);
  
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`Worker listening on ${config.host}:${config.port}`);
    console.log(`Start token: ${config.startToken}`);
    console.log(`Boot ID: ${config.bootId}`);
  } catch (err) {
    console.error('Failed to start worker:', err);
    process.exit(1);
  }
}

main();
