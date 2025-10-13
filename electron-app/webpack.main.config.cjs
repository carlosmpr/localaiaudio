const path = require('path');
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const outputPath = path.resolve(__dirname, 'build');
const resolve = {
  extensions: ['.js', '.cjs']
};
const moduleRules = [
  {
    test: /\.c?js$/,
    exclude: /node_modules/,
    use: {
      loader: 'babel-loader',
      options: {
        presets: [['@babel/preset-env', { targets: { node: '18' } }]]
      }
    }
  }
];

module.exports = [
  {
    mode,
    target: 'electron-main',
    entry: './source/main.cjs',
    output: {
      path: outputPath,
      filename: 'main.js'
    },
    resolve,
    module: {
      rules: moduleRules
    }
  },
  {
    mode,
    target: 'electron-preload',
    entry: './source/preload.cjs',
    output: {
      path: outputPath,
      filename: 'preload.js'
    },
    resolve,
    module: {
      rules: moduleRules
    }
  }
];
