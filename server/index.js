/**
 * CardVoice Express Server
 * Entry point — works standalone (CLI) and embedded (Electron require).
 */
const express = require('express');
const cors = require('cors');
const { openDb } = require('./db');
const { createRoutes } = require('./routes');

/**
 * Create and configure the Express app + HTTP server.
 * @param {{ port?: number, dbPath?: string }} opts
 * @returns {{ app: express.Express, server: import('http').Server, db: import('better-sqlite3').Database }}
 */
function createServer(opts = {}) {
  const port = opts.port || 8000;
  const db = openDb(opts.dbPath);

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use(createRoutes(db));

  const server = app.listen(port, () => {
    console.log(`CardVoice server listening on http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    server.close();
    db.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, db };
}


// CLI entry: node index.js [--port N]
if (require.main === module) {
  let port = 8000;
  const portIdx = process.argv.indexOf('--port');
  if (portIdx !== -1 && process.argv[portIdx + 1]) {
    port = parseInt(process.argv[portIdx + 1], 10);
  }
  createServer({ port });
}


module.exports = { createServer };
