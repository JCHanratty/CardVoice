/**
 * CardVoice Express Server
 * Entry point — works standalone (CLI) and embedded (Electron require).
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const { openDb } = require('./db');
const { createRoutes } = require('./routes');
const { SyncService } = require('./pricing/sync');

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

  // Merge bundled checklist catalog on startup
  const { mergeCatalog } = require('./catalog-merge');
  const isPackaged = process.env.ELECTRON_IS_PACKAGED === 'true' || false;
  const mergeResult = mergeCatalog(db, { isPackaged });
  if (mergeResult.skipped) {
    console.log(`[Catalog] Skipped: ${mergeResult.reason}`);
  }

  // Start background price sync service
  const syncService = new SyncService(db);
  app.locals.syncService = syncService;
  setTimeout(() => syncService.start(), 5000);

  // Start TCDB scraper service
  const { TcdbService } = require('./tcdb-service');
  const tcdbService = new TcdbService({
    scraperDir: path.join(__dirname, '..', 'tcdb-scraper'),
    db,
  });
  app.locals.tcdbService = tcdbService;

  // Anonymous heartbeat (delayed, non-blocking)
  const { sendHeartbeat } = require('./analytics');
  setTimeout(() => sendHeartbeat(db), 10000);

  const server = app.listen(port, () => {
    console.log(`CardVoice server listening on http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    syncService.stop();
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
