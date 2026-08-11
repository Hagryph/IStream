class PackagedApplicationSmokeTester {
  static async verify(executablePath) {
    const childProcess = require('node:child_process');
    const fileSystem = require('node:fs');
    const network = require('node:net');
    const operatingSystem = require('node:os');
    const path = require('node:path');
    if (process.platform !== 'win32') {
      throw new Error('The packaged IStream smoke test currently requires Windows.');
    }
    if (!fileSystem.existsSync(executablePath) || fileSystem.statSync(executablePath).size === 0) {
      throw new Error(`Packaged IStream executable is missing: ${executablePath}`);
    }
    const temporaryDirectory = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), 'istream-smoke-'));
    const remoteDebuggingPort = await PackagedApplicationSmokeTester.availablePort(network);
    const application = childProcess.spawn(
      executablePath,
      [
        `--remote-debugging-port=${remoteDebuggingPort}`,
        `--user-data-dir=${temporaryDirectory}`,
        '--istream-smoke-test',
        '--enable-logging=stderr'
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let standardError = '';
    application.stderr?.on('data', (chunk) => {
      standardError = `${standardError}${String(chunk)}`.slice(-16_000);
    });
    try {
      const debuggerUrl = await PackagedApplicationSmokeTester.waitForRenderer(
        remoteDebuggingPort,
        application
      );
      const renderer = await PackagedApplicationSmokeTester.waitForHealthyRenderer(debuggerUrl);
      if (!renderer.bridgeReady || !renderer.appShellReady) {
        throw new Error(
          `Packaged renderer did not initialize. Bridge=${renderer.bridgeReady}, shell=${renderer.appShellReady}, ` +
          `visibleText=${JSON.stringify(renderer.visibleText)}\n${standardError}`
        );
      }
      process.stdout.write('  - packaged application smoke test passed: preload bridge and React shell are ready.\n');
    } finally {
      PackagedApplicationSmokeTester.terminate(childProcess, application);
      await PackagedApplicationSmokeTester.removeTemporaryDirectory(
        fileSystem,
        operatingSystem,
        path,
        temporaryDirectory
      );
    }
  }

  static availablePort(network) {
    return new Promise((resolve, reject) => {
      const server = network.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          server.close();
          reject(new Error('Could not allocate a local smoke-test debugging port.'));
          return;
        }
        const port = address.port;
        server.close((error) => error === undefined ? resolve(port) : reject(error));
      });
    });
  }

  static async waitForRenderer(port, application) {
    const endpoint = `http://127.0.0.1:${port}/json/list`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (application.exitCode !== null) {
        throw new Error(`Packaged IStream exited before its renderer started (code ${application.exitCode}).`);
      }
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          const pages = await response.json();
          const page = Array.isArray(pages) ? pages.find((candidate) => candidate.type === 'page') : undefined;
          if (typeof page?.webSocketDebuggerUrl === 'string') {
            return page.webSocketDebuggerUrl;
          }
        }
      } catch {
        await PackagedApplicationSmokeTester.delay(200);
        continue;
      }
      await PackagedApplicationSmokeTester.delay(200);
    }
    throw new Error('Timed out waiting for the packaged IStream renderer debugging endpoint.');
  }

  static async waitForHealthyRenderer(debuggerUrl) {
    const deadline = Date.now() + 8_000;
    let latest = { bridgeReady: false, appShellReady: false, visibleText: '' };
    while (Date.now() < deadline) {
      latest = await PackagedApplicationSmokeTester.evaluateRenderer(debuggerUrl);
      if (latest.bridgeReady && latest.appShellReady) {
        return latest;
      }
      await PackagedApplicationSmokeTester.delay(200);
    }
    return latest;
  }

  static evaluateRenderer(debuggerUrl) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(debuggerUrl);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Timed out while inspecting the packaged renderer.'));
      }, 5_000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `JSON.stringify({
              bridgeReady: typeof window.istream === 'object',
              appShellReady: document.querySelector('.app-shell') !== null,
              visibleText: document.body.innerText.slice(0, 240)
            })`,
            returnByValue: true
          }
        }));
      });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) {
          return;
        }
        clearTimeout(timeout);
        socket.close();
        const value = message.result?.result?.value;
        if (typeof value !== 'string') {
          reject(new Error(`Renderer inspection returned no value: ${JSON.stringify(message)}`));
          return;
        }
        resolve(JSON.parse(value));
      });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Could not connect to the packaged renderer debugger.'));
      });
    });
  }

  static delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  static terminate(childProcess, application) {
    if (application.exitCode === null && application.pid !== undefined) {
      childProcess.spawnSync('taskkill.exe', ['/PID', String(application.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    }
  }

  static async removeTemporaryDirectory(fileSystem, operatingSystem, path, temporaryDirectory) {
    const temporaryRoot = path.resolve(operatingSystem.tmpdir());
    const resolvedDirectory = path.resolve(temporaryDirectory);
    if (
      !resolvedDirectory.startsWith(`${temporaryRoot}${path.sep}`) ||
      !path.basename(resolvedDirectory).startsWith('istream-smoke-')
    ) {
      throw new Error(`Refusing to remove unexpected smoke-test directory: ${resolvedDirectory}`);
    }
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        fileSystem.rmSync(resolvedDirectory, { recursive: true, force: true });
        return;
      } catch (error) {
        const retryable = ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code);
        if (!retryable || attempt === 20) {
          throw error;
        }
        await PackagedApplicationSmokeTester.delay(200);
      }
    }
  }
}

module.exports = PackagedApplicationSmokeTester;
