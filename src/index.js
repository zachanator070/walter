import logger from './utils/logger.js';
import stateMachine from './pipeline/stateMachine.js';

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  await stateMachine.stop();
  process.exit(0);
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
