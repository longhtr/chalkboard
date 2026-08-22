/**
 * Server process entry. Startup owns configuration and the listening socket;
 * shutdown first makes the application unready, then drains collaboration and
 * persistence through Fastify's close hooks before the process exits.
 */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import {
  logOperationalError,
  writeOperationalError,
} from './operations/errorDiagnostics.js';

async function startServer(): Promise<void> {
  const config = loadConfig();
  const app = buildApp({ config });
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.beginDrain();
    app.log.info({ signal }, 'Draining before shutdown');

    const forceShutdown = setTimeout(() => {
      app.log.fatal(
        { timeoutMs: config.shutdownTimeoutMs },
        'Graceful shutdown timed out',
      );
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceShutdown.unref();
    try {
      await app.close();
    } catch (error) {
      logOperationalError(app.log, 'server.shutdown', error);
      process.exitCode = 1;
    } finally {
      clearTimeout(forceShutdown);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    try {
      await app.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Server startup failed and cleanup could not close the application',
        { cause: closeError },
      );
    }
    throw error;
  }
}

startServer().catch((error: unknown) => {
  writeOperationalError('server.startup', error);
  process.exitCode = 1;
});
