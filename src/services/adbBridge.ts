import type { PairingTarget } from '../types';

export interface WirelessServiceEndpoint {
  host: string;
  port: number;
  label: string;
  kind: 'pairing' | 'connect' | 'unknown';
}

export class AdbBridge {
  public constructor(private readonly adbPath: string) {}

  public async ensureAvailable(): Promise<void> {
    const { execa } = await import('execa');
    try {
      await execa(this.adbPath, ['version']);
    } catch (error) {
      throw new Error(
        `Unable to run adb at "${this.adbPath}". Install Android platform-tools or update androidWirelessDebugging.adbPath.`
      );
    }
  }

  public async pair(target: PairingTarget): Promise<string> {
    const { execa } = await import('execa');
    const pairResult = await execa(this.adbPath, ['pair', `${target.host}:${target.port}`, target.code], {
      all: true,
    });
    return pairResult.all ?? pairResult.stdout ?? '';
  }

  public async connect(host: string, port: number): Promise<string> {
    const { execa } = await import('execa');
    const connectResult = await execa(this.adbPath, ['connect', `${host}:${port}`], {
      all: true,
    });
    return connectResult.all ?? connectResult.stdout ?? '';
  }

  public async disconnect(serial: string): Promise<string> {
    const { execa } = await import('execa');
    const result = await execa(this.adbPath, ['disconnect', serial], {
      all: true,
    });
    return result.all ?? result.stdout ?? '';
  }

  public async listDevices(): Promise<string> {
    const { execa } = await import('execa');
    const result = await execa(this.adbPath, ['devices', '-l'], {
      all: true,
    });
    return result.all ?? result.stdout ?? '';
  }

  public async discoverWirelessEndpoints(): Promise<WirelessServiceEndpoint[]> {
    const { execa } = await import('execa');
    const result = await execa(this.adbPath, ['mdns', 'services'], {
      all: true,
    });

    const output = (result.all ?? result.stdout ?? '').toString();
    const endpoints: WirelessServiceEndpoint[] = [];
    const seen = new Set<string>();

    for (const line of output.split(/\r?\n/)) {
      if (!line.toLowerCase().includes('adb')) {
        continue;
      }

      const parsed = this.parseHostPort(line);
      if (!parsed) {
        continue;
      }

      const key = `${parsed.host}:${parsed.port}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      endpoints.push({
        host: parsed.host,
        port: parsed.port,
        label: line.trim(),
        kind: this.detectServiceKind(line),
      });
    }

    return endpoints;
  }

  public async captureScreenshot(serial: string): Promise<Buffer> {
    const { execa } = await import('execa');
    const result = await execa(this.adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
    });
    return Buffer.from(result.stdout as Buffer);
  }

  private detectServiceKind(line: string): 'pairing' | 'connect' | 'unknown' {
    const normalized = line.toLowerCase();
    if (normalized.includes('adb-tls-pairing')) {
      return 'pairing';
    }
    if (normalized.includes('adb-tls-connect')) {
      return 'connect';
    }
    return 'unknown';
  }

  private parseHostPort(line: string): { host: string; port: number } | undefined {
    const colonMatch = line.match(/(?<host>(?:\d{1,3}\.){3}\d{1,3}|[\w.-]+):(?<port>\d{2,5})/);
    if (colonMatch?.groups?.host && colonMatch.groups.port) {
      return {
        host: colonMatch.groups.host,
        port: Number.parseInt(colonMatch.groups.port, 10),
      };
    }

    const spacedMatch = line.match(/(?<host>(?:\d{1,3}\.){3}\d{1,3}|[\w.-]+)\s+(?<port>\d{2,5})\b/);
    if (spacedMatch?.groups?.host && spacedMatch.groups.port) {
      return {
        host: spacedMatch.groups.host,
        port: Number.parseInt(spacedMatch.groups.port, 10),
      };
    }

    return undefined;
  }
}
