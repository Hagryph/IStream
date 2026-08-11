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
    const destination = path.join(projectRoot, path.basename(installerArtifact));
    fileSystem.copyFileSync(installerArtifact, destination);
    process.stdout.write(`  - copied installer to project root: ${destination}\n`);
    const GitHubBuildSynchronizer = require('./sync-github-after-build.cjs');
    await GitHubBuildSynchronizer.synchronize(projectRoot);
    const GitHubReleasePublisher = require('./publish-github-release.cjs');
    await GitHubReleasePublisher.publish(projectRoot, buildResult.outDir);
    return [];
  }
}

module.exports = IStreamInstallerArtifactCopier.afterAllArtifactBuild;
