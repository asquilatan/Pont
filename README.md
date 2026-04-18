# Pont

<center><img src="media/pont_header.png" alt="Pont Header"/></center>

Pont (French for "bridge") connects your Android device to your development environment. It is a VS Code extension created for Android developers who want to pair a device over wireless debugging and keep key device workflows inside the editor.

It pairs your device with `adb`, launches and manages `scrcpy`, and runs Gradle install + app launch from inside VS Code.

## What Pont does

Pont helps you work with wireless Android devices without leaving VS Code. The extension handles pairing, endpoint discovery, device connection, viewer launch, app installation, and repeatable session cleanup when things get out of sync.

Pont is designed to feel simple and direct:

- Pair over Wi-Fi with the Android wireless debugging pairing code flow.
- Discover available wireless debugging hosts and connect to the device.
- Open a native `scrcpy` viewer window from inside VS Code.
- Run your app install task and launch installed apps with retry and fallback behavior.
- Disconnect or reset the extension session when the device becomes unstable.

## How Pont works

Pont is implemented as a VS Code extension in TypeScript. It uses `adb` to drive Android device pairing, connection, and app launching, and it uses `scrcpy` to create the native viewer window. The UI is a lightweight sidebar and status panel, while the active device state is tracked in a session object.

### 1. Pairing and connection

Pont starts by resolving `adb` and discovering wireless debugging endpoints. Once you choose or enter a host, it runs `adb pair` with the pairing code, then connects to the device and stores the device serial in session state.

### 2. Viewer lifecycle

When you open the viewer, Pont resolves `scrcpy`, launches it against the connected serial, and keeps the process under session control. This makes relaunching or disconnecting behave predictably and keeps the UI in sync.

### 3. Install and launch app flow

Pont now splits app execution into two explicit commands:

- `Pont: Install App` — runs your configured Gradle install task with `ANDROID_SERIAL` set.
- `Pont: Launch App` — detects package/activity, checks installed package candidates on-device, and launches with retry + fallback behavior.
  - If detection fails, Pont prompts for a manual package name and still attempts launch via adb fallback.

Outputs are separated so failures are easier to diagnose:

- `Pont: Install App` output channel
- `Pont: Launch App` output channel

## Requirements

- Windows, macOS, or Linux
- VS Code `^1.85.0`
- Android device with **Developer options** and **Wireless debugging** enabled
- `adb` available (Android platform-tools)
- `scrcpy` installed and on PATH (or configured in settings)

### scrcpy setup

Pont depends on `scrcpy` to mirror/control the connected device.

1. Install `scrcpy`:
   - **Windows:** `winget install Genymobile.scrcpy` (or `choco install scrcpy`)
   - **macOS:** `brew install scrcpy`
   - **Linux:** install via your distro package manager (for example `sudo apt install scrcpy`)
2. Verify installation:
   - `scrcpy --version`
3. Optional (if not on PATH): set `androidWirelessDebugging.scrcpyPath` in VS Code settings.

## Installation

You can install Pont in two ways:

1. Use the prebuilt VSIX from this repo:
   - `binary/pont-0.0.1.vsix`
2. Or build the VSIX yourself:
   - `npm install`
   - `npm run vsix`
3. Install in VS Code:
   - Command Palette -> `Extensions: Install from VSIX...`
   - Select the `.vsix` file

## Development setup

1. Clone the repo.
2. Install dependencies:
   - `npm install`
3. Build once:
   - `npm run compile`
4. Start extension host:
   - Press `F5` in VS Code
5. In Extension Development Host:
   - Run `Pont: Pair Device`
   - Run `Pont: Open Device Viewer`

## Usage quick start

1. On your phone, open **Wireless debugging** and choose **Pair device with pairing code**.
2. In VS Code, run `Pont: Pair Device`.
3. Select discovered host/port (or enter manually) and provide the pairing code.
4. Run `Pont: Open Device Viewer` to open `scrcpy`.
5. Run `Pont: Install App`.
6. Run `Pont: Launch App`.
7. If needed, run `Pont: Disconnect Device` or `Pont: Reset Extension`.

## Configuration

Use settings under `androidWirelessDebugging.*`:

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
- `npm run compile` - type-check + build
- `npm run watch` - watch mode
- `npm run package` - production build
- `npm run vsix` - build + VSIX output (`binary/pont-0.0.1.vsix`)

