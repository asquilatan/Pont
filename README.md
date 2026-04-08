# Pont (VS Code Extension)

Pont helps Android developers pair a phone over Wi-Fi and control/view it from VS Code using native `adb` + `scrcpy`.

I built this specifically for Android development workflows, so you can pair, mirror, and run app tasks without leaving the editor.

## Features

- Pair Android devices over wireless debugging (pairing code flow)
- Discover available devices/endpoints from Wireless Debugging
- Open native `scrcpy` viewer from VS Code (interactive keyboard + mouse/touch)
- Reopen/relaunch viewer reliably with placement settings
- Disconnect device from VS Code
- Run Gradle install task on the connected device
- Reset extension session state when things get unstable

## Requirements

- Windows/macOS/Linux
- VS Code `^1.85.0`
- Android phone with **Developer options** + **Wireless debugging** enabled
- `adb` available (Android platform-tools)
- `scrcpy` installed and available on PATH (or configured in settings)

## Installation (for users)

You can install Pont in two ways:

1. Use the prebuilt VSIX from this repo:
   - `binary/pont-0.0.1.vsix`
2. Or build the VSIX yourself:
   - `npm install`
   - `npm run vsix`
3. Install in VS Code (either VSIX):
   - Command Palette -> `Extensions: Install from VSIX...`
   - Pick the generated `.vsix` file

## Development setup (start/install project)

1. Clone repo
2. Install dependencies:
   - `npm install`
3. Build:
   - `npm run compile`
4. Launch extension dev host:
   - Press `F5` in VS Code
5. In the Extension Development Host window:
   - Run `Android: Pair Device`
   - Then `Android: Open Device Viewer`

## How to use

1. On phone: open **Wireless debugging** and choose **Pair device with pairing code**
2. In VS Code: run `Android: Pair Device`
3. Pick discovered device IP (or enter manually), then enter the 6-digit code
4. Run `Android: Open Device Viewer` to launch native `scrcpy`
5. Use `Android: Run Connected App` to run your Gradle install task
6. If state gets inconsistent, run `Android: Reset Extension`

## Configuration

Use VS Code settings under `androidWirelessDebugging.*`:

- `adbPath`
- `scrcpyPath`
- `frameIntervalMs`
- `gradleInstallTask`
- `scrcpyAlwaysOnTop`
- `scrcpyWindowX`
- `scrcpyWindowY`
- `scrcpyWindowWidth`
- `scrcpyWindowHeight`

## Scripts

- `npm run check-types` - TypeScript checks
- `npm run compile` - Type check + build
- `npm run watch` - watch build
- `npm run package` - production build
- `npm run vsix` - production build + VSIX at `binary/pont-0.0.1.vsix`

