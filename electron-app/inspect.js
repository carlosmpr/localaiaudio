require('electron')
  .app.whenReady()
  .then(() => {
    const path = require('path');
    const { app } = require('electron');
    console.log('app.getAppPath()', app.getAppPath());
    console.log('process.resourcesPath', process.resourcesPath);
    console.log('source path', path.join(app.getAppPath(), 'source', 'main.cjs'));
    console.log('backend path', path.join(app.getAppPath(), 'resources', 'backend', 'public', 'index.html'));
    app.quit();
  });
