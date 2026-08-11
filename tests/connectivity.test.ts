import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ConnectionIntent,
  ConnectionState,
  ConsentPromptMode,
  LocalMediaRole,
  PromptKind,
  type ConnectivitySnapshot
} from '../src/shared/ConnectivityContracts';
import { ConnectivityFacade } from '../src/main/connectivity/ConnectivityFacade';
import { EndpointParser, NetworkInterfaceProvider } from '../src/main/connectivity/NetworkAddressing';

class ConnectivityTestHarness {
  readonly #temporaryDirectories: string[] = [];
  readonly #facades: ConnectivityFacade[] = [];

  public register(): void {
    describe('private LAN connectivity', () => {
      afterEach(async () => this.dispose());

      test('accepts only private IPv4 endpoints', () => {
        const parser = new EndpointParser(47778, new NetworkInterfaceProvider());
        expect(parser.parse('192.168.4.20:48000')).toEqual({ host: '192.168.4.20', port: 48000 });
        expect(parser.parse('127.0.0.1')).toEqual({ host: '127.0.0.1', port: 47778 });
        expect(() => parser.parse('8.8.8.8:47778')).toThrow('private IPv4');
        expect(() => parser.parse('example.com')).toThrow('private IPv4');
      });

      test('pairs, reports health, reverses direction, and disconnects over an encrypted local socket', async () => {
        const viewer = await this.createFacade();
        const sharer = await this.createFacade();
        await Promise.all([viewer.start(), sharer.start()]);
        const sharerPort = sharer.snapshot().localEndpoint?.controlPort;
        expect(sharerPort).toBeTypeOf('number');

        await viewer.connectManual({
          endpoint: `127.0.0.1:${sharerPort ?? 0}`,
          intent: ConnectionIntent.ViewRemote
        });
        const viewerPairing = await this.waitFor(viewer, (snapshot) => snapshot.prompt?.kind === PromptKind.Pairing);
        const sharerPairing = await this.waitFor(sharer, (snapshot) => snapshot.prompt?.kind === PromptKind.Pairing);
        expect(viewerPairing.prompt?.mode).toBe(ConsentPromptMode.WaitingForPeer);
        expect(sharerPairing.prompt?.mode).toBe(ConsentPromptMode.EnterVerificationCode);
        expect(viewerPairing.prompt?.verificationCode).toMatch(/^\d{6}$/);
        expect(sharerPairing.prompt?.verificationCode).toBeNull();

        await expect(sharer.respondToPrompt({
          promptId: sharerPairing.prompt?.promptId ?? '',
          accepted: true,
          verificationCode: viewerPairing.prompt?.verificationCode === '000000' ? '000001' : '000000'
        })).rejects.toThrow('does not match');
        expect(sharer.snapshot().connection.state).toBe(ConnectionState.Pairing);
        expect(sharer.snapshot().prompt?.promptId).toBe(sharerPairing.prompt?.promptId);

        await sharer.respondToPrompt({
          promptId: sharerPairing.prompt?.promptId ?? '',
          accepted: true,
          verificationCode: viewerPairing.prompt?.verificationCode ?? ''
        });
        const viewerConnected = await this.waitFor(
          viewer,
          (snapshot) => snapshot.connection.state === ConnectionState.Connected
        );
        const sharerConnected = await this.waitFor(
          sharer,
          (snapshot) => snapshot.connection.state === ConnectionState.Connected
        );
        expect(viewerConnected.connection.role).toBe(LocalMediaRole.Viewer);
        expect(sharerConnected.connection.role).toBe(LocalMediaRole.Sharer);
        expect(viewerConnected.connection.peer?.paired).toBe(true);

        const remoteDiagnostics = await viewer.requestRemoteDiagnostics(10);
        expect(remoteDiagnostics.length).toBeGreaterThan(0);
        expect(remoteDiagnostics.every((record) => record.source === 'remote')).toBe(true);
        expect(remoteDiagnostics.some((record) => record.record.event === 'connection.sample')).toBe(true);

        await viewer.requestReversal();
        const reversalPrompt = await this.waitFor(
          sharer,
          (snapshot) => snapshot.prompt?.kind === PromptKind.Reversal
        );
        await sharer.respondToPrompt({
          promptId: reversalPrompt.prompt?.promptId ?? '',
          accepted: true,
          verificationCode: null
        });
        const reversedViewer = await this.waitFor(
          viewer,
          (snapshot) => snapshot.connection.role === LocalMediaRole.Sharer
        );
        const reversedSharer = await this.waitFor(
          sharer,
          (snapshot) => snapshot.connection.role === LocalMediaRole.Viewer
        );
        expect(reversedViewer.connection.state).toBe(ConnectionState.Connected);
        expect(reversedSharer.connection.state).toBe(ConnectionState.Connected);

        await viewer.disconnect();
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);

        await viewer.connectManual({
          endpoint: `127.0.0.1:${sharerPort ?? 0}`,
          intent: ConnectionIntent.ViewRemote
        });
        const returningRequester = await this.waitFor(
          viewer,
          (snapshot) => snapshot.prompt?.kind === PromptKind.Connection
        );
        const returningRequested = await this.waitFor(
          sharer,
          (snapshot) => snapshot.prompt?.kind === PromptKind.Connection
        );
        expect(returningRequester.prompt?.mode).toBe(ConsentPromptMode.WaitingForPeer);
        expect(returningRequested.prompt?.mode).toBe(ConsentPromptMode.EnterVerificationCode);
        await sharer.respondToPrompt({
          promptId: returningRequested.prompt?.promptId ?? '',
          accepted: true,
          verificationCode: returningRequester.prompt?.verificationCode ?? ''
        });
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Connected);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Connected);

        await viewer.disconnect();
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
      });

      test('detects a peer going offline while waiting for code confirmation', async () => {
        const requester = await this.createFacade();
        const requested = await this.createFacade();
        await Promise.all([requester.start(), requested.start()]);
        const requestedPort = requested.snapshot().localEndpoint?.controlPort;

        await requester.connectManual({
          endpoint: `127.0.0.1:${requestedPort ?? 0}`,
          intent: ConnectionIntent.ViewRemote
        });
        await this.waitFor(
          requester,
          (snapshot) => snapshot.prompt?.mode === ConsentPromptMode.WaitingForPeer
        );

        await requested.stop();
        const failed = await this.waitFor(
          requester,
          (snapshot) => snapshot.connection.state === ConnectionState.Failed
        );
        expect(failed.prompt).toBeNull();
        expect(failed.connection.error).not.toBeNull();

        await requester.disconnect();
        expect(requester.snapshot().connection.state).toBe(ConnectionState.Idle);
      });
    });
  }

  private async createFacade(): Promise<ConnectivityFacade> {
    const directory = await mkdtemp(join(tmpdir(), 'istream-test-'));
    this.#temporaryDirectories.push(directory);
    const facade = new ConnectivityFacade({
      userDataPath: directory,
      enableDiscovery: false,
      preferredControlPort: 0,
      enableLocalDiagnosticsServer: false,
      preferredDiagnosticsPort: 0
    });
    this.#facades.push(facade);
    return facade;
  }

  private async waitFor(
    facade: ConnectivityFacade,
    predicate: (snapshot: ConnectivitySnapshot) => boolean,
    timeoutMs: number = 8000
  ): Promise<ConnectivitySnapshot> {
    const initialSnapshot = facade.snapshot();
    if (predicate(initialSnapshot)) {
      return initialSnapshot;
    }
    return new Promise<ConnectivitySnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for connectivity state: ${JSON.stringify(facade.snapshot())}`));
      }, timeoutMs);
      const unsubscribe = facade.subscribe((snapshot) => {
        if (predicate(snapshot)) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(snapshot);
        }
      });
    });
  }

  private async dispose(): Promise<void> {
    await Promise.all(this.#facades.map((facade) => facade.stop()));
    await Promise.all(this.#temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    this.#facades.length = 0;
    this.#temporaryDirectories.length = 0;
  }
}

new ConnectivityTestHarness().register();
