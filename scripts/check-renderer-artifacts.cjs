class RendererArtifactChecker {
  static verify() {
    const fileSystem = require('node:fs');
    const path = require('node:path');
    const projectRoot = process.cwd();
    const preloadPath = path.join(projectRoot, 'out', 'preload', 'index.cjs');
    const mainPath = path.join(projectRoot, 'out', 'main', 'index.js');
    const rendererPath = path.join(projectRoot, 'out', 'renderer', 'index.html');
    RendererArtifactChecker.assertFile(fileSystem, preloadPath);
    RendererArtifactChecker.assertFile(fileSystem, mainPath);
    RendererArtifactChecker.assertFile(fileSystem, rendererPath);
    const preload = fileSystem.readFileSync(preloadPath, 'utf8');
    if (/^\s*import\s/m.test(preload) || !preload.includes('require("electron")')) {
      throw new Error('Sandboxed preload artifact is not a self-contained CommonJS bundle.');
    }
    const main = fileSystem.readFileSync(mainPath, 'utf8');
    if (!main.includes('../preload/index.cjs')) {
      throw new Error('Main artifact does not reference the sandbox-compatible CommonJS preload.');
    }
    process.stdout.write('Packaged renderer artifact check passed.\n');
  }

  static assertFile(fileSystem, filePath) {
    if (!fileSystem.existsSync(filePath) || fileSystem.statSync(filePath).size === 0) {
      throw new Error(`Required renderer artifact is missing or empty: ${filePath}`);
    }
  }
}

RendererArtifactChecker.verify();
