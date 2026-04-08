import type { PairingTarget } from '../types';

export interface WirelessServiceEndpoint {
  host: string;
  port: number;
  label: string;
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

    for (const line of output.split(/\r?\n/)) {
      if (!line.toLowerCase().includes('adb')) {
        continue;
      }

      const match = line.match(/(?<host>(?:\d{1,3}\.){3}\d{1,3}|[\w.-]+):(?<port>\d{2,5})/);
      if (!match?.groups?.host || !match.groups.port) {
        continue;
      }

      endpoints.push({
        host: match.groups.host,
        port: Number.parseInt(match.groups.port, 10),
        label: line.trim(),
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
}
