import { networkInterfaces } from 'node:os';

export interface ParsedEndpoint {
  readonly host: string;
  readonly port: number;
}

export class NetworkInterfaceProvider {
  public privateIpv4Addresses(): readonly string[] {
    const addresses: string[] = [];
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal && this.isPrivateIpv4(entry.address)) {
          addresses.push(entry.address);
        }
      }
    }
    return [...new Set<string>(addresses)].sort();
  }

  public isPrivateIpv4(address: string): boolean {
    const parts = address.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      address === '127.0.0.1'
    );
  }
}

export class EndpointParser {
  readonly #defaultPort: number;
  readonly #networkInterfaceProvider: NetworkInterfaceProvider;

  public constructor(defaultPort: number, networkInterfaceProvider: NetworkInterfaceProvider) {
    this.#defaultPort = defaultPort;
    this.#networkInterfaceProvider = networkInterfaceProvider;
  }

  public parse(value: string): ParsedEndpoint {
    const trimmed = value.trim();
    const separatorIndex = trimmed.lastIndexOf(':');
    const hasPort = separatorIndex > -1 && trimmed.indexOf(':') === separatorIndex;
    const host = hasPort ? trimmed.slice(0, separatorIndex) : trimmed;
    const portText = hasPort ? trimmed.slice(separatorIndex + 1) : `${this.#defaultPort}`;
    const port = Number.parseInt(portText, 10);
    if (!this.#networkInterfaceProvider.isPrivateIpv4(host)) {
      throw new Error('Enter a private IPv4 address on the same LAN.');
    }
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Control port must be between 1024 and 65535.');
    }
    return { host, port };
  }
}
