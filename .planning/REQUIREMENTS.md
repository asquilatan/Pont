# Requirements: Android Wireless Debugging for VS Code

**Defined:** 2026-04-08
**Core Value:** Connect an Android device wirelessly and watch its screen in VS Code without leaving the editor.

## v1 Requirements

### Connection

- [ ] **MIRROR-01**: User can pair an Android device with a QR code or pairing code over wireless debugging.
- [ ] **MIRROR-02**: User can start a mirroring session from a VS Code command or panel action.
- [ ] **MIRROR-03**: User can see whether the device is connected, pairing, or disconnected.

### Viewer

- [ ] **MIRROR-04**: User can view the live Android screen inside VS Code.
- [ ] **MIRROR-05**: User can reveal or reopen the existing viewer instead of creating duplicate panels.
- [ ] **MIRROR-06**: User sees clear errors when pairing or streaming fails.

## v2 Requirements

### Session Quality

- **MIRROR-07**: User can reconnect to the last device quickly.
- **MIRROR-08**: User can see a device history or recent-device list.

### Input and Media

- **MIRROR-09**: User can control the device with keyboard and mouse.
- **MIRROR-10**: User can forward audio from the device.
- **MIRROR-11**: User can record the mirrored session.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Android Studio integration | The whole point is to stay in VS Code |
| Multiple simultaneous mirrored devices | Adds UI and process complexity before the core path is validated |
| Full remote-control UX | View-only is the first release scope |
| Custom on-device companion app | Increases installation friction and is not needed for wireless debugging |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MIRROR-01 | Phase 1 | Pending |
| MIRROR-02 | Phase 2 | Pending |
| MIRROR-03 | Phase 1 | Pending |
| MIRROR-04 | Phase 2 | Pending |
| MIRROR-05 | Phase 3 | Pending |
| MIRROR-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 after initialization*
