/**
 * Stubbed hardware scanner used during early development.
 * Returns canned hardware characteristics so other modules
 * can be developed before real detection is implemented.
 */
async function scanHardware() {
  return {
    os: 'Windows 11',
    cpu: {
      vendor: 'Intel',
      model: 'Core i7-12700K',
      physicalCores: 8,
      logicalCores: 16
    },
    ramGb: 16,
    gpu: {
      vendor: 'NVIDIA',
      model: 'RTX 3060',
      vramGb: 8
    },
    disk: {
      freeGb: 150,
      totalGb: 512
    },
    network: {
      connected: true
    }
  };
}

module.exports = {
  scanHardware
};
