const { hardwareScanHandler } = require('../src');

/**
 * Simple harness to demonstrate the hardware handler without HTTP server.
 * Invokes the handler with mocked request/response objects and logs the payload.
 */
async function run() {
  const res = createMockResponse();
  await hardwareScanHandler({}, res);
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  console.log('Body:', res.body);
}

function createMockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload;
    }
  };
}

run().catch((error) => {
  console.error('Demo failed:', error);
  process.exitCode = 1;
});
