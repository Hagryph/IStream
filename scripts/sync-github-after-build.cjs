class GitHubBuildSynchronizer {
  static expectedRemote = /github\.com[/:]Hagryph\/IStream(?:\.git)?$/i;

  static allowedPaths = [
    '.github',
    '.gitignore',
    'CONTRIBUTING.md',
    'LICENSE.md',
    'NOTICE',
    'README.md',
    'SECURITY.md',
    'THIRD_PARTY_NOTICES.md',
    'docs',
    'electron-builder.yml',
    'electron.vite.config.ts',
    'package-lock.json',
    'package.json',
    'scripts',
    'src',
    'tests',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsconfig.web.json',
    'vitest.config.ts'
  ];

  static blockedContent = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bghp_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:client_secret|access_token)\s*[:=]\s*["'][^"']{12,}["']/i
  ];

  static async synchronize(projectRoot) {
    if (process.env.ISTREAM_SKIP_GITHUB_SYNC === '1') {
      process.stdout.write('  - GitHub build synchronization skipped by ISTREAM_SKIP_GITHUB_SYNC.\n');
      return;
    }
    const childProcess = require('node:child_process');
    const fileSystem = require('node:fs');
    const path = require('node:path');
    if (GitHubBuildSynchronizer.run(childProcess, projectRoot, ['rev-parse', '--is-inside-work-tree'], true) !== 'true') {
      process.stdout.write('  - GitHub build synchronization skipped: project is not a Git repository yet.\n');
      return;
    }
    const remote = GitHubBuildSynchronizer.run(
      childProcess,
      projectRoot,
      ['remote', 'get-url', 'origin'],
      true
    );
    if (!remote) {
      process.stdout.write('  - GitHub build synchronization skipped: origin is not configured yet.\n');
      return;
    }
    if (!GitHubBuildSynchronizer.expectedRemote.test(remote)) {
      throw new Error(`Refusing automatic push to unexpected remote: ${remote}`);
    }
    const branch = GitHubBuildSynchronizer.run(childProcess, projectRoot, ['branch', '--show-current']);
    if (branch !== 'main') {
      throw new Error(`Automatic build synchronization is restricted to main, not ${branch || '<detached>'}.`);
    }
    const existingPaths = GitHubBuildSynchronizer.allowedPaths.filter((relativePath) =>
      fileSystem.existsSync(path.join(projectRoot, relativePath))
    );
    GitHubBuildSynchronizer.run(childProcess, projectRoot, ['add', '-A', '--', ...existingPaths]);
    const stagedFiles = GitHubBuildSynchronizer.run(
      childProcess,
      projectRoot,
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
      true
    ).split(/\r?\n/).filter(Boolean);
    GitHubBuildSynchronizer.assertNoSecrets(fileSystem, path, projectRoot, stagedFiles);
    if (GitHubBuildSynchronizer.runStatus(childProcess, projectRoot, ['diff', '--cached', '--quiet']) === 0) {
      process.stdout.write('  - GitHub build synchronization: no project changes to commit.\n');
      return;
    }
    const manifest = JSON.parse(fileSystem.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    GitHubBuildSynchronizer.run(childProcess, projectRoot, ['commit', '-m', `build: synchronize IStream ${manifest.version}`]);
    GitHubBuildSynchronizer.run(childProcess, projectRoot, ['push', 'origin', 'main']);
    process.stdout.write('  - committed and pushed verified project changes to GitHub main.\n');
  }

  static assertNoSecrets(fileSystem, path, projectRoot, stagedFiles) {
    for (const relativePath of stagedFiles) {
      const absolutePath = path.join(projectRoot, relativePath);
      if (!fileSystem.existsSync(absolutePath) || fileSystem.statSync(absolutePath).size > 2_000_000) {
        continue;
      }
      const content = fileSystem.readFileSync(absolutePath, 'utf8');
      if (GitHubBuildSynchronizer.blockedContent.some((pattern) => pattern.test(content))) {
        throw new Error(`Refusing automatic GitHub commit because ${relativePath} resembles a secret-bearing file.`);
      }
    }
  }

  static run(childProcess, projectRoot, argumentsList, allowFailure = false) {
    const result = childProcess.spawnSync('git', argumentsList, {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status !== 0) {
      if (allowFailure) {
        return '';
      }
      throw new Error((result.stderr || result.stdout || `git ${argumentsList[0]} failed`).trim());
    }
    return result.stdout.trim();
  }

  static runStatus(childProcess, projectRoot, argumentsList) {
    return childProcess.spawnSync('git', argumentsList, {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true
    }).status;
  }
}

module.exports = GitHubBuildSynchronizer;
