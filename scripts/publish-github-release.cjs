class GitHubReleasePublisher {
  static repository = 'Hagryph/IStream';

  static expectedRemote = /github\.com[/:]Hagryph\/IStream(?:\.git)?$/i;

  static async publish(projectRoot, outputDirectory) {
    if (process.env.ISTREAM_SKIP_GITHUB_RELEASE === '1') {
      process.stdout.write('  - GitHub Release publishing skipped by ISTREAM_SKIP_GITHUB_RELEASE.\n');
      return;
    }
    const childProcess = require('node:child_process');
    const crypto = require('node:crypto');
    const fileSystem = require('node:fs');
    const path = require('node:path');
    if (GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      true
    ) !== 'true') {
      process.stdout.write('  - GitHub Release publishing skipped: project is not a Git repository yet.\n');
      return;
    }
    const remote = GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'git',
      ['remote', 'get-url', 'origin'],
      true
    );
    if (!remote) {
      process.stdout.write('  - GitHub Release publishing skipped: origin is not configured yet.\n');
      return;
    }
    if (!GitHubReleasePublisher.expectedRemote.test(remote)) {
      throw new Error(`Refusing automatic release publishing to unexpected remote: ${remote}`);
    }
    const branch = GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'git',
      ['branch', '--show-current']
    );
    if (branch !== 'main') {
      throw new Error(`Automatic release publishing is restricted to main, not ${branch || '<detached>'}.`);
    }
    const workingTreeStatus = GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'git',
      ['status', '--porcelain', '--untracked-files=normal']
    );
    if (workingTreeStatus) {
      throw new Error('Refusing automatic release publishing because the Git working tree is not clean.');
    }
    const head = GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'git',
      ['rev-parse', 'HEAD']
    );
    const remoteDifference = GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'git',
      ['rev-list', '--left-right', '--count', 'HEAD...origin/main']
    ).split(/\s+/).join(' ');
    if (remoteDifference !== '0 0') {
      throw new Error(`Refusing automatic release publishing because HEAD and origin/main differ: ${remoteDifference}`);
    }
    GitHubReleasePublisher.run(childProcess, projectRoot, 'gh', ['auth', 'status']);
    const repositoryDetails = JSON.parse(GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'gh',
      ['repo', 'view', GitHubReleasePublisher.repository, '--json', 'nameWithOwner,visibility']
    ));
    if (repositoryDetails.nameWithOwner !== GitHubReleasePublisher.repository || repositoryDetails.visibility !== 'PUBLIC') {
      throw new Error('Refusing automatic release publishing because the configured GitHub repository is not the expected public repository.');
    }
    const manifest = JSON.parse(fileSystem.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    GitHubReleasePublisher.assertVersion(manifest.version);
    const tag = `v${manifest.version}`;
    const releaseAssets = GitHubReleasePublisher.resolveReleaseAssets(
      fileSystem,
      crypto,
      path,
      outputDirectory,
      manifest.version
    );
    const releaseExists = GitHubReleasePublisher.runStatus(
      childProcess,
      projectRoot,
      'gh',
      ['release', 'view', tag, '--repo', GitHubReleasePublisher.repository]
    ) === 0;
    if (releaseExists) {
      const taggedCommit = GitHubReleasePublisher.run(
        childProcess,
        projectRoot,
        'gh',
        ['api', `repos/${GitHubReleasePublisher.repository}/commits/${tag}`, '--jq', '.sha']
      );
      if (taggedCommit !== head) {
        throw new Error(
          `Release ${tag} already points to ${taggedCommit.slice(0, 12)}, not current HEAD ${head.slice(0, 12)}. ` +
          'Bump package.json version before publishing changed source.'
        );
      }
      GitHubReleasePublisher.run(
        childProcess,
        projectRoot,
        'gh',
        ['release', 'upload', tag, ...releaseAssets, '--clobber', '--repo', GitHubReleasePublisher.repository]
      );
      GitHubReleasePublisher.run(
        childProcess,
        projectRoot,
        'gh',
        ['release', 'edit', tag, '--latest', '--title', `IStream ${tag}`, '--repo', GitHubReleasePublisher.repository]
      );
    } else {
      GitHubReleasePublisher.run(
        childProcess,
        projectRoot,
        'gh',
        [
          'release',
          'create',
          tag,
          ...releaseAssets,
          '--repo',
          GitHubReleasePublisher.repository,
          '--target',
          head,
          '--title',
          `IStream ${tag}`,
          '--generate-notes',
          '--latest'
        ]
      );
    }
    const releaseUrl = GitHubReleasePublisher.run(
      childProcess,
      projectRoot,
      'gh',
      ['release', 'view', tag, '--repo', GitHubReleasePublisher.repository, '--json', 'url', '--jq', '.url']
    );
    process.stdout.write(`  - published ${tag} as the latest GitHub Release: ${releaseUrl}\n`);
  }

  static assertVersion(version) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`package.json version is not a supported semantic version: ${String(version)}`);
    }
  }

  static resolveReleaseAssets(fileSystem, crypto, path, outputDirectory, version) {
    const assetPaths = [
      path.join(outputDirectory, `IStream-${version}-Setup.exe`),
      path.join(outputDirectory, `IStream-${version}-Setup.exe.blockmap`),
      path.join(outputDirectory, 'latest.yml')
    ];
    for (const assetPath of assetPaths) {
      if (!fileSystem.existsSync(assetPath) || fileSystem.statSync(assetPath).size === 0) {
        throw new Error(`Required release artifact is missing or empty: ${assetPath}`);
      }
    }
    const checksumPath = path.join(outputDirectory, `IStream-${version}-SHA256SUMS.txt`);
    const checksumLines = assetPaths.map((assetPath) => {
      const digest = crypto.createHash('sha256').update(fileSystem.readFileSync(assetPath)).digest('hex');
      return `${digest}  ${path.basename(assetPath)}`;
    });
    fileSystem.writeFileSync(checksumPath, `${checksumLines.join('\n')}\n`, 'utf8');
    return [...assetPaths, checksumPath];
  }

  static run(childProcess, projectRoot, command, argumentsList, allowFailure = false) {
    const result = childProcess.spawnSync(command, argumentsList, {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300_000
    });
    if (result.status !== 0) {
      if (allowFailure) {
        return '';
      }
      throw new Error(
        (result.error?.message || result.stderr || result.stdout || `${command} ${argumentsList[0]} failed`).trim()
      );
    }
    return result.stdout.trim();
  }

  static runStatus(childProcess, projectRoot, command, argumentsList) {
    return childProcess.spawnSync(command, argumentsList, {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300_000
    }).status;
  }
}

module.exports = GitHubReleasePublisher;
