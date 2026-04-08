# Roadmap: Android Wireless Debugging for VS Code

## Overview

Build a VS Code extension that pairs to an Android phone over wireless debugging and shows the live screen inside the editor. The roadmap starts with the wireless pairing/session foundation, adds the viewer, then hardens the lifecycle so the extension is easy to reopen and recover from normal network/device interruptions.

## Phases

- [x] **Phase 1: Pairing Foundation** - Pair the device and establish the active session state.
- [ ] **Phase 2: Screen Viewer** - Display the live Android screen in a VS Code panel.
- [ ] **Phase 3: Session Resilience** - Make the viewer reusable, recoverable, and easier to operate.
- [ ] **Phase 4: Interactive Control** - Add keyboard/mouse control of the mirrored device.

## Phase Details

### Phase 1: Pairing Foundation
**Goal**: Pair an Android device using QR or pairing code and create a reliable session model.
**Depends on**: Nothing (first phase)
**Requirements**: MIRROR-01, MIRROR-03
**Success Criteria** (what must be TRUE):
  1. User can start pairing from VS Code.
  2. User can complete pairing with either QR code or pairing code.
  3. User can see when the extension considers the device connected or disconnected.
**Plans**: 2 plans

Plans:
 - [x] 01-01-PLAN.md — VS Code extension foundation, pairing command, and adb device bridge
 - [x] 01-02-PLAN.md — Session manager, device panel webview, and connection status UI

### Phase 2: Screen Viewer
**Goal**: Show the live Android screen in a VS Code panel.
**Depends on**: Phase 1
**Requirements**: MIRROR-02, MIRROR-04
**Success Criteria** (what must be TRUE):
  1. User can open a viewer from the extension.
  2. The viewer renders the phone screen inside VS Code.
  3. The viewer uses the active pairing/session without requiring a separate app.
**Plans**: 2 plans

Plans:
- [ ] 02-01: Build the viewer panel and message bridge
- [ ] 02-02: Wire the mirror backend into the panel

### Phase 3: Session Resilience
**Goal**: Make the viewer reusable and the workflow robust when connections change.
**Depends on**: Phase 2
**Requirements**: MIRROR-05, MIRROR-06
**Success Criteria** (what must be TRUE):
  1. Reopening the command reveals the existing viewer instead of duplicating it.
  2. Closing the viewer shuts down its helper process cleanly.
  3. Pairing and stream failures produce clear recovery guidance.
**Plans**: 2 plans

Plans:
- [ ] 03-01: Add lifecycle cleanup and single-panel reuse
- [ ] 03-02: Add error handling and recovery messaging

### Phase 4: Interactive Control
**Goal**: Let the viewer send input events so users can interact with the mirrored device.
**Depends on**: Phase 3
**Requirements**: MIRROR-09
**Success Criteria** (what must be TRUE):
  1. User can tap/click in the viewer and trigger touch events on the device.
  2. User can send common keyboard input to the focused device.
  3. Input errors surface clearly without breaking the active view session.
**Plans**: 2 plans

Plans:
- [x] 04-01: Add viewer input event capture and mapping
- [ ] 04-02: Add adb/scrcpy input bridge and error handling

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Pairing Foundation | 2/2 | Complete | 2026-04-08 |
| 2. Screen Viewer | 0/2 | Not started | - |
| 3. Session Resilience | 0/2 | Not started | - |
| 4. Interactive Control | 0/2 | Not started | - |
