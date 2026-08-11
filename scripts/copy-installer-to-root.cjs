class IStreamInstallerArtifactCopier {
  static async afterAllArtifactBuild(buildResult) {
    const fileSystem = require('node:fs');
    const path = require('node:path');
    const projectRoot = path.resolve(buildResult.outDir, '..');
    const installerArtifact = buildResult.artifactPaths.find(
      (artifactPath) => artifactPath.toLowerCase().endsWith('-setup.exe')
    );
    if (installerArtifact === undefined) {
      throw new Error('electron-builder did not produce an NSIS setup executable.');
    }
    const PackagedApplicationSmokeTester = require('./smoke-test-packaged-app.cjs');
    await PackagedApplicationSmokeTester.verify(
      path.join(buildResult.outDir, 'win-unpacked', 'IStream.exe')
    );
    const destination = path.join(projectRoot, path.basename(installerArtifact));
    fileSystem.copyFileSync(installerArtifact, destination);
    process.stdout.write(`  - copied installer to project root: ${destination}\n`);
    IStreamInstallerArtifactCopier.removeOldRootInstallers(fileSystem, path, projectRoot, destination);
    const GitHubBuildSynchronizer = require('./sync-github-after-build.cjs');
    await GitHubBuildSynchronizer.synchronize(projectRoot);
    const GitHubReleasePublisher = require('./publish-github-release.cjs');
    await GitHubReleasePublisher.publish(projectRoot, buildResult.outDir);
    return [];
  }

  static removeOldRootInstallers(fileSystem, path, projectRoot, currentInstaller) {
    const resolvedRoot = path.resolve(projectRoot);
    const resolvedCurrentInstaller = path.resolve(currentInstaller);
    const oldInstallers = fileSystem.readdirSync(resolvedRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^IStream-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-Setup\.exe$/i.test(entry.name))
      .map((entry) => path.resolve(resolvedRoot, entry.name))
      .filter((installerPath) => installerPath !== resolvedCurrentInstaller);
    for (const oldInstaller of oldInstallers) {
      if (path.dirname(oldInstaller) !== resolvedRoot) {
        throw new Error(`Refusing to remove installer outside the project root: ${oldInstaller}`);
      }
      fileSystem.unlinkSync(oldInstaller);
      process.stdout.write(`  - removed old root installer: ${oldInstaller}\n`);
    }
  }
}

module.exports = IStreamInstallerArtifactCopier.afterAllArtifactBuild;
