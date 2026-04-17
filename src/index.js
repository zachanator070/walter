import { spawn } from 'child_process';
import logger from './utils/logger.js';
import stateMachine from './pipeline/stateMachine.js';

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down');

  try {
    const killer = spawn('sh', ['-c', `sleep 1; kill -9 ${process.pid} >/dev/null 2>&1 || true`], {
      detached: true,
      stdio: 'ignore',
    });
    killer.unref();
  } catch {}

  void Promise.resolve(stateMachine.stop()).catch(err => {
    logger.error({ err, signal }, 'Error during shutdown');
  });

  process.exitCode = 0;
  setTimeout(() => process.exit(0), 25).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', err => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
  process.exit(1);
});

logger.info('Starting Walter');

stateMachine.start().catch(err => {
  logger.error({ err }, 'Failed to start');
  process.exit(1);
});
