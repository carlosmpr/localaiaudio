const { scanHardware } = require('../hardware/hardwareScanStub');

/**
 * Minimal request handler returning canned hardware specs.
 * Designed to plug into an HTTP server or Express-like framework.
 */
async function hardwareScanHandler(req, res) {
  try {
    const payload = await scanHardware();
    // Support both Node http.ServerResponse and Express response objects.
    if (typeof res.status === 'function') {
      res.status(200).json(payload);
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  } catch (error) {
    if (typeof res.status === 'function') {
      res.status(500).json({ error: 'Hardware scan failed', detail: error.message });
      return;
    }
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Hardware scan failed' }));
  }
}

module.exports = {
  hardwareScanHandler
};
