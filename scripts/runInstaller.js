const { runInstaller } = require('../src');

async function run() {
  try {
    const result = await runInstaller();
    console.log('Local installer completed.');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Installer failed:', error);
    process.exitCode = 1;
  }
}

run();
