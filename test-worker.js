
// Quick test to verify worker starts and health endpoints respond
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

async function testWorker() {
  console.log('Starting worker...');
  const worker = spawn('node', ['dist/worker/index.js'], {
    cwd: '/var/lib/alan-portfolio/workspaces/alan/cobalt-foundry-144',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  worker.stdout.on('data', (data) => {
    output += data.toString();
  });
  worker.stderr.on('data', (data) => {
    output += data.toString();
  });

  // Wait for worker to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test health endpoint
  console.log('Testing /api/health...');
  const healthRes = await fetch('http://127.0.0.1:37777/api/health');
  const health = await healthRes.json();
  console.log('Health:', JSON.stringify(health, null, 2));

  // Test readiness endpoint
  console.log('Testing /api/readiness...');
  const readyRes = await fetch('http://127.0.0.1:37777/api/readiness');
  const ready = await readyRes.json();
  console.log('Readiness:', JSON.stringify(ready, null, 2));

  // Kill worker
  worker.kill('SIGTERM');
  await new Promise((resolve) => worker.on('exit', resolve));
  
  console.log('Worker test passed!');
  process.exit(0);
}

testWorker().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
