import http from 'node:http';
import { handle } from './app';
import { config } from './config';
import { logger } from './log';

/*
 * The standalone Node server (start.bat, or any Node host). On Vercel the same
 * handler runs as functions instead; see api/ and DEPLOY.md.
 */

const log = logger('server');

// One listener per address: "localhost" can mean 127.0.0.1 or ::1 depending on the caller.
for (const host of config.hosts) {
  const server = http.createServer(handle);
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') log.error(`Port ${config.port} is already in use on ${host}. Close the other server or set PORT.`);
    else if (err.code !== 'EADDRNOTAVAIL') log.error(`server error on ${host}`, err);
  });
  server.listen(config.port, host, () => log.info(`PlayzAnime Web server on http://${host.includes(':') ? `[${host}]` : host}:${config.port}${config.relay ? '' : ' (video relay off)'}`));
}
