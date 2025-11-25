const hooks = require('./forge.hooks');

module.exports = {
  packagerConfig: {
    asar: false,
    icon: './resources/icon',
    executableName: 'fsp-study-tools',
  },
  rebuildConfig: {},
  hooks: {
    postPackage: hooks.postPackage,
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'fsp_study_tools',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        loggerPort: 9001, // Avoid conflict with SonarQube on port 9000
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/renderer/index.html',
              js: './src/renderer/index.tsx',
              name: 'main_window',
              preload: {
                js: './src/main/preload.ts',
              },
            },
          ],
        },
      },
    },
  ],
};
