const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = {
  projectRoot: __dirname,
  watchFolders: [root],
  resolver: {
    // The library resolves react, react-native and nitro from the example's node_modules.
    blockList: [
      new RegExp(`^${escape(path.join(root, 'node_modules'))}\\/.*$`),
    ],
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    extraNodeModules: {
      [pkg.name]: root,
    },
    assetExts: [...getDefaultConfig(__dirname).resolver.assetExts, 'pdf'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
