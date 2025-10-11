const { scanHardware } = require('./hardware/hardwareScanStub');
const { hardwareScanHandler } = require('./api/hardwareHandler');
const { runInstaller } = require('./installer/runInstaller');
const { sendMessage, getSessionMessages } = require('./chat/chatService');
const { createServer } = require('./server/httpServer');

module.exports = {
  scanHardware,
  hardwareScanHandler,
  runInstaller,
  chatService: {
    sendMessage,
    getSessionMessages
  },
  createServer
};
