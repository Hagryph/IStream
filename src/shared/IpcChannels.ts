export class IpcChannels {
  static readonly connectivityGetSnapshot: string = 'connectivity:get-snapshot';
  static readonly connectivityRefreshDiscovery: string = 'connectivity:refresh-discovery';
  static readonly connectivityConnectDiscovered: string = 'connectivity:connect-discovered';
  static readonly connectivityConnectManual: string = 'connectivity:connect-manual';
  static readonly connectivityRespondPrompt: string = 'connectivity:respond-prompt';
  static readonly connectivityRequestReversal: string = 'connectivity:request-reversal';
  static readonly connectivityDisconnect: string = 'connectivity:disconnect';
  static readonly connectivitySnapshotChanged: string = 'connectivity:snapshot-changed';
  static readonly configurationGet: string = 'configuration:get';
  static readonly configurationUpdate: string = 'configuration:update';
}
