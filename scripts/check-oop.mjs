import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import ts from 'typescript';

class OopBoundaryChecker {
  static sourceRoot = join(process.cwd(), 'src');

  run() {
    const failures = [];
    for (const path of this.collectSourceFiles(OopBoundaryChecker.sourceRoot)) {
      failures.push(...this.inspect(path));
    }
    if (failures.length > 0) {
      throw new Error(`OOP boundary violations:\n${failures.join('\n')}`);
    }
    process.stdout.write('OOP boundary check passed.\n');
  }

  collectSourceFiles(directory) {
    const paths = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        paths.push(...this.collectSourceFiles(path));
      } else if (['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
        paths.push(path);
      }
    }
    return paths;
  }

  inspect(path) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const failures = [];
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) {
        failures.push(`${path}:${source.getLineAndCharacterOfPosition(statement.getStart()).line + 1}`);
      }
    }
    return failures;
  }
}

new OopBoundaryChecker().run();
