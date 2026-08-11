export interface UserFacingErrorRule {
  readonly pattern: RegExp;
  readonly message: string;
}

export class UserFacingError {
  static readonly #fallback: string = 'Something went wrong. Try again. If it keeps happening, restart IStream on both computers.';
  static readonly #rules: readonly UserFacingErrorRule[] = [
    {
      pattern: /verification code does not match|incorrect (?:verification )?(?:code|token)|invalid (?:verification )?(?:code|token)/i,
      message: 'That code is incorrect. Check the six digits shown on the requesting PC and try again.'
    },
    {
      pattern: /consent request is no longer active|no active consent request|request is no longer active/i,
      message: 'This request has expired. Start the connection again.'
    },
    {
      pattern: /already approved and is waiting/i,
      message: 'Approval is already complete on this PC. Wait for the other computer.'
    },
    {
      pattern: /peer declined|other computer declined|connection declined/i,
      message: 'The other computer declined the connection.'
    },
    {
      pattern: /pairing handshake timed out|handshake timed out/i,
      message: 'The other computer stopped responding during setup. Make sure IStream is open there, then try again.'
    },
    {
      pattern: /health check timed out|connection.*timed out/i,
      message: 'The connection was interrupted. Check the network and reconnect.'
    },
    {
      pattern: /peer closed the connection|control connection is closed|other computer disconnected|socket hang up|ECONNRESET|ECONNABORTED|EPIPE/i,
      message: 'The other computer disconnected.'
    },
    {
      pattern: /did not answer on the control port|ECONNREFUSED/i,
      message: 'The other computer did not respond. Make sure IStream is open and allowed through Windows Firewall.'
    },
    {
      pattern: /ENETUNREACH|EHOSTUNREACH|network is unreachable|host is unreachable/i,
      message: 'This computer cannot reach the other PC. Check that both are on the same private network.'
    },
    {
      pattern: /EADDRNOTAVAIL/i,
      message: 'The selected network connection is no longer available. Reconnect Ethernet or Wi-Fi, then try again.'
    },
    {
      pattern: /ETIMEDOUT|connect timeout/i,
      message: 'The other computer took too long to respond. Check its network connection and try again.'
    },
    {
      pattern: /EADDRINUSE|no (?:loopback diagnostics|local control) port is available|could not resolve (?:the )?(?:diagnostics|local control) port/i,
      message: 'A required local port is already in use. Close other IStream windows and restart the app.'
    },
    {
      pattern: /discovered peer is no longer available|trusted peer is offline/i,
      message: 'That computer is offline. Open IStream there, then refresh the list.'
    },
    {
      pattern: /LAN discovery is not (?:available|running)/i,
      message: 'Computer discovery is unavailable. Restart IStream or connect using the other PC\'s private IP address.'
    },
    {
      pattern: /private IPv4 address/i,
      message: 'Enter the other computer\'s private IPv4 address, for example 192.168.1.25.'
    },
    {
      pattern: /control port must be between/i,
      message: 'Enter a port between 1024 and 65535.'
    },
    {
      pattern: /disconnect the current peer|disconnect.*before starting another connection/i,
      message: 'Disconnect the current computer before starting another connection.'
    },
    {
      pattern: /outgoing connection requires a direction/i,
      message: 'Choose View or Share, then try connecting again.'
    },
    {
      pattern: /direction can only be reversed/i,
      message: 'Wait until the connection is stable before reversing direction.'
    },
    {
      pattern: /reversal request is no longer active|unexpected direction reversal/i,
      message: 'That reversal request has expired. Try reversing direction again.'
    },
    {
      pattern: /consent context is incomplete|verification code is unavailable|unexpected consent response|health check received before/i,
      message: 'Connection setup could not finish. Start the connection again; update IStream on both PCs if it repeats.'
    },
    {
      pattern: /remote diagnostics require an active/i,
      message: 'Connect to the other computer before requesting its diagnostics.'
    },
    {
      pattern: /did not return diagnostics in time/i,
      message: 'The other computer did not return diagnostics. Check the connection and try again.'
    },
    {
      pattern: /connection closed before diagnostics|closed before diagnostics completed/i,
      message: 'The connection ended before the diagnostic history was ready.'
    },
    {
      pattern: /diagnostics requested before connection consent/i,
      message: 'Finish approving the connection before requesting diagnostics.'
    },
    {
      pattern: /could not request peer diagnostics|remote diagnostic request failed/i,
      message: 'The diagnostic history could not be requested. Check the connection and try again.'
    },
    {
      pattern: /no active connection/i,
      message: 'Connect to another computer first.'
    },
    {
      pattern: /identity changed before connection/i,
      message: 'That computer\'s identity changed. Clear its trust entry and pair again.'
    },
    {
      pattern: /identity signature is invalid|invalid (?:client|server) handshake/i,
      message: 'The other computer could not be verified. Update IStream on both PCs and pair again.'
    },
    {
      pattern: /secure control|control protocol|handshake transcript|secure channel|unexpected secure|unsupported secure|invalid control (?:data|message)/i,
      message: 'The computers could not establish a compatible secure connection. Update IStream on both PCs and reconnect.'
    },
    {
      pattern: /diagnostic record .*invalid|diagnostic record must be/i,
      message: 'The other computer sent diagnostic data this version cannot read. Update IStream on both PCs.'
    },
    {
      pattern: /control message is too large|oversized control message|too many diagnostic records/i,
      message: 'The computers exchanged more diagnostic data than this version supports. Update IStream on both PCs.'
    },
    {
      pattern: /connectivity service is not ready|trust store is not ready/i,
      message: 'IStream is still starting. Wait a moment and try again; restart it if this continues.'
    },
    {
      pattern: /trusted device identifier is invalid/i,
      message: 'Trust could not be cleared. Refresh the computer list and try again.'
    },
    {
      pattern: /unknown streaming preset/i,
      message: 'That streaming preset is unavailable. Choose another preset.'
    },
    {
      pattern: /unknown video codec/i,
      message: 'That video format is unavailable. Choose another encoder.'
    },
    {
      pattern: /unknown HDR mode/i,
      message: 'That HDR option is unavailable. Choose another HDR setting.'
    },
    {
      pattern: /unknown capacity floor/i,
      message: 'That quality-floor option is unavailable. Choose another setting.'
    },
    {
      pattern: /unsupported target resolution/i,
      message: 'Choose one of the supported stream resolutions.'
    },
    {
      pattern: /frame rate must use a supported step/i,
      message: 'Choose one of the available frame rates.'
    },
    {
      pattern: /minimum frame rate cannot exceed/i,
      message: 'Minimum frame rate cannot be higher than the target frame rate.'
    },
    {
      pattern: /maximum bitrate must be between/i,
      message: 'Choose a maximum bitrate between 5 and 200 Mbps.'
    },
    {
      pattern: /input settings are invalid/i,
      message: 'The input settings could not be saved. Restore a supported value and try again.'
    },
    {
      pattern: /protected application list is invalid/i,
      message: 'Check the protected application names and remove empty or unusually long entries.'
    },
    {
      pattern: /EACCES|EPERM|permission denied|access is denied/i,
      message: 'IStream could not access a required file or network port. Close other IStream windows, check Windows Security, and restart the app.'
    },
    {
      pattern: /preload bridge|renderer root element|renderer error/i,
      message: 'The IStream interface could not start. Restart the app; reinstall the latest version if it happens again.'
    }
  ];

  public static from(error: unknown): string {
    return this.fromDetail(this.detail(error));
  }

  public static fromNullable(detail: string | null): string | null {
    return detail === null ? null : this.fromDetail(detail);
  }

  private static fromDetail(detail: string): string {
    for (const rule of this.#rules) {
      if (rule.pattern.test(detail)) {
        return rule.message;
      }
    }
    return this.#fallback;
  }

  private static detail(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return typeof error === 'string' ? error : String(error);
  }
}
