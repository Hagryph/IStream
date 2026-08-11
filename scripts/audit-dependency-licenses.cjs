class DependencyLicenseAuditor {
  static allowedLicenses = new Set([
    '0BSD',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'BlueOak-1.0.0',
    'CC-BY-4.0',
    'CC0-1.0',
    'ISC',
    'MIT',
    'Python-2.0',
    'Unlicense',
    'WTFPL',
    'WTFPL OR ISC',
    '(WTFPL OR MIT)',
    '(MIT OR CC0-1.0)'
  ]);

  static run() {
    const fileSystem = require('node:fs');
    const path = require('node:path');
    const projectRoot = process.cwd();
    const lock = JSON.parse(fileSystem.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
    const packages = Object.entries(lock.packages)
      .filter(([packagePath]) => packagePath.length > 0)
      .map(([packagePath, metadata]) => ({
        name: DependencyLicenseAuditor.packageName(packagePath),
        version: metadata.version ?? '<missing>',
        license: metadata.license ?? '<missing>',
        developmentOnly: metadata.dev === true,
        optional: metadata.optional === true
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
    const violations = packages.filter((dependency) => !DependencyLicenseAuditor.allowedLicenses.has(dependency.license));
    const licenseSummary = {};
    for (const dependency of packages) {
      licenseSummary[dependency.license] = (licenseSummary[dependency.license] ?? 0) + 1;
    }
    const report = {
      schemaVersion: 1,
      projectLicense: 'PolyForm-Noncommercial-1.0.0',
      scope: 'Exact package-lock.json dependency graph. Runtime binaries also retain their upstream license files.',
      packageCount: packages.length,
      licenseSummary,
      packages
    };
    const reportDirectory = path.join(projectRoot, 'docs', 'legal');
    fileSystem.mkdirSync(reportDirectory, { recursive: true });
    fileSystem.writeFileSync(
      path.join(reportDirectory, 'dependency-license-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    );
    if (violations.length > 0) {
      throw new Error(`Dependency license audit failed:\n${violations.map((item) => `${item.name}@${item.version}: ${item.license}`).join('\n')}`);
    }
    process.stdout.write(`Dependency license audit passed for ${packages.length} locked packages.\n`);
  }

  static packageName(packagePath) {
    const normalized = packagePath.replaceAll('\\', '/');
    return normalized.slice(normalized.lastIndexOf('node_modules/') + 'node_modules/'.length);
  }
}

DependencyLicenseAuditor.run();
