const fs = require('fs-extra');
const path = require('path');

module.exports = {
  postPackage: async (forgeConfig, options) => {
    console.log('Running postPackage hook to copy better-sqlite3 and dependencies...');

    const appPath = path.join(options.outputPaths[0], 'resources', 'app');
    const nodeModulesPath = path.join(appPath, 'node_modules');

    // Ensure directories exist
    await fs.ensureDir(nodeModulesPath);

    // Modules to copy (better-sqlite3, pdf2json, mammoth and their dependencies)
    const modulesToCopy = [
      'better-sqlite3',
      'bindings',
      'file-uri-to-path',
      'pdf2json',
      'mammoth',
      'xml2js',
      'underscore',
      'xmlbuilder',
      'sax',
      'lop',
      'dingbat-to-unicode',
    ];

    for (const moduleName of modulesToCopy) {
      const sourcePath = path.join(__dirname, 'node_modules', moduleName);
      const destPath = path.join(nodeModulesPath, moduleName);

      // Check if source exists before copying
      if (await fs.pathExists(sourcePath)) {
        console.log(`Copying ${moduleName} from ${sourcePath} to ${destPath}`);

        try {
          await fs.copy(sourcePath, destPath, { overwrite: true });
          console.log(`Successfully copied ${moduleName}`);
        } catch (error) {
          console.error(`Failed to copy ${moduleName}:`, error);
          throw error;
        }
      } else {
        console.warn(`Module ${moduleName} not found in project node_modules, skipping...`);
      }
    }

    console.log('All modules copied successfully');
  }
};
