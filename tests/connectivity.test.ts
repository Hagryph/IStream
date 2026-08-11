import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ConnectionIntent,
  ConnectionState,
  ConsentPromptMode,
  ConnectivityDefaults,
  LocalMediaRole,
  PromptKind,
  type ConnectivitySnapshot
} from '../src/shared/ConnectivityContracts';
import type { CollectedDiagnosticRecord } from '../src/shared/DiagnosticContracts';
import { ConnectivityFacade } from '../src/main/connectivity/ConnectivityFacade';
import { EndpointParser, NetworkInterfaceProvider } from '../src/main/connectivity/NetworkAddressing';
import { MediaSignalFactory, MediaSignalKind, type MediaSignal } from '../src/shared/MediaContracts';

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
        const viewerPort = viewer.snapshot().localEndpoint?.controlPort;
        const sharerPort = sharer.snapshot().localEndpoint?.controlPort;
        const viewerDeviceId = viewer.snapshot().localEndpoint?.deviceId ?? '';
        const sharerDeviceId = sharer.snapshot().localEndpoint?.deviceId ?? '';
        expect(viewerPort).toBeTypeOf('number');
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
        expect(viewerConnected.connection.peer?.paired).toBe(false);
        expect(sharerConnected.connection.peer?.paired).toBe(true);

        const receivedMediaSignal = this.waitForMediaSignal(sharer);
        const offerSignal = MediaSignalFactory.sessionDescription(
          'test-media-generation',
          MediaSignalKind.Offer,
          'v=0\r\ns=- IStream media test\r\n'
        );
        viewer.sendMediaSignal(offerSignal);
        await expect(receivedMediaSignal).resolves.toEqual(offerSignal);

        const remoteDiagnostics = await viewer.requestRemoteDiagnostics(10);
        expect(remoteDiagnostics.length).toBeGreaterThan(0);
        expect(remoteDiagnostics.every((record) => record.source === 'remote')).toBe(true);
        expect(remoteDiagnostics.some((record) => record.record.event === 'connection.sample')).toBe(true);

        await viewer.requestReversal();
        const reversalPrompt = await this.waitFor(
          sharer,
          (snapshot) => snapshot.prompt?.kind === PromptKind.Reversal
        );
        expect(viewer.snapshot().prompt).toBeNull();
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
        const retainedViewerTrust = sharer.snapshot().discoveredPeers.find(
          (peer) => peer.deviceId === viewerDeviceId
        );
        expect(retainedViewerTrust?.paired).toBe(true);
        expect(retainedViewerTrust?.online).toBe(false);
        expect((retainedViewerTrust?.trustExpiresAt ?? 0) - Date.now()).toBeGreaterThan(
          ConnectivityDefaults.trustDurationMs - 10_000
        );

        await viewer.connectManual({
          endpoint: `127.0.0.1:${sharerPort ?? 0}`,
          intent: ConnectionIntent.ViewRemote
        });
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Connected);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Connected);
        expect(sharer.snapshot().prompt).toBeNull();

        await viewer.disconnect();
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);

        await viewer.connectManual({
          endpoint: `127.0.0.1:${sharerPort ?? 0}`,
          intent: ConnectionIntent.ShareLocal
        });
        const oppositeIntentRequested = await this.waitFor(
          sharer,
          (snapshot) => snapshot.prompt?.mode === ConsentPromptMode.EnterVerificationCode
        );
        await sharer.respondToPrompt({
          promptId: oppositeIntentRequested.prompt?.promptId ?? '',
          accepted: false,
          verificationCode: null
        });
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);

        await sharer.connectManual({
          endpoint: `127.0.0.1:${viewerPort ?? 0}`,
          intent: ConnectionIntent.ViewRemote
        });
        const reverseRequester = await this.waitFor(
          sharer,
          (snapshot) => snapshot.prompt?.mode === ConsentPromptMode.WaitingForPeer
        );
        const reverseRequested = await this.waitFor(
          viewer,
          (snapshot) => snapshot.prompt?.mode === ConsentPromptMode.EnterVerificationCode
        );
        await viewer.respondToPrompt({
          promptId: reverseRequested.prompt?.promptId ?? '',
          accepted: true,
          verificationCode: reverseRequester.prompt?.verificationCode ?? ''
        });
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Connected);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Connected);
        expect(viewer.snapshot().connection.peer?.paired).toBe(true);
        expect(sharer.snapshot().connection.peer?.paired).toBe(false);

        await sharer.disconnect();
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        expect(viewer.snapshot().discoveredPeers.some((peer) => peer.deviceId === sharerDeviceId)).toBe(true);

        await viewer.clearTrust({ deviceId: sharerDeviceId });
        expect(viewer.snapshot().discoveredPeers.some((peer) => peer.deviceId === sharerDeviceId)).toBe(false);
        await sharer.connectManual({
          endpoint: `127.0.0.1:${viewerPort ?? 0}`,
          intent: ConnectionIntent.ViewRemote
        });
        const afterClearRequested = await this.waitFor(
          viewer,
          (snapshot) => snapshot.prompt?.mode === ConsentPromptMode.EnterVerificationCode
        );
        await viewer.respondToPrompt({
          promptId: afterClearRequested.prompt?.promptId ?? '',
          accepted: false,
          verificationCode: null
        });
        await this.waitFor(viewer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
        await this.waitFor(sharer, (snapshot) => snapshot.connection.state === ConnectionState.Idle);
      });

      test('detects a peer going offline while waiting for code confirmation', async () => {
        const requester = await this.createFacade(true);
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
        const diagnosticResponse = await fetch(`${requester.snapshot().diagnostics?.baseUrl ?? ''}/snapshot`);
        const diagnosticRecords = await diagnosticResponse.json() as CollectedDiagnosticRecord[];
        expect(diagnosticRecords.some((entry) => (
          entry.record.event === 'connection.closed' && entry.record.severity === 'error'
        ))).toBe(true);

        await requester.disconnect();
        expect(requester.snapshot().connection.state).toBe(ConnectionState.Idle);
      });
    });
  }

  private async createFacade(enableDiagnostics: boolean = false): Promise<ConnectivityFacade> {
    const directory = await mkdtemp(join(tmpdir(), 'istream-test-'));
    this.#temporaryDirectories.push(directory);
    const facade = new ConnectivityFacade({
      userDataPath: directory,
      enableDiscovery: false,
      preferredControlPort: 0,
      enableLocalDiagnosticsServer: enableDiagnostics,
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

  private waitForMediaSignal(facade: ConnectivityFacade): Promise<MediaSignal> {
    return new Promise<MediaSignal>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for encrypted media signaling.'));
      }, 3000);
      const unsubscribe = facade.subscribeMediaSignals((signal) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(signal);
      });
    });
  }
}

new ConnectivityTestHarness().register();
