# Funny Animation Assistant Skill

Codex skill and local bridge for controlling the Funny Animation Assistant Adobe Animate plugin from shell-capable agents.

This package lets an agent inspect open FLA files, scan stage contents, read timelines and symbol/group structure, switch frames, export PNG/config assets, monitor plugin jobs, and run batch export helpers. It is intentionally limited to read, navigation, close-without-save, and export workflows.

## Requirements

- Node.js 18 or newer.
- Adobe Animate.
- Funny Animation Assistant plugin with AI automation enabled.
- The Animate plugin panel must be open, switched to AI automation, and configured to allow external tool control.

## Quick Start

```bash
node scripts/faa-cli.js doctor
node scripts/faa-cli.js status
node scripts/faa-cli.js scan
node scripts/faa-cli.js timeline
node scripts/faa-cli.js export-stage-one --frame 0 --layerIndex 0 --elementIndex 0 --out D:/example/exports --level 2
```

The CLI starts `bridge/server.js` automatically when needed. The bridge listens on `127.0.0.1` and uses port `17321` by default.

## Security

The bridge controls a local Adobe Animate session. Treat local machine access as trusted.

Recommended hardening for shared machines:

```bash
set FAA_BRIDGE_TOKEN=replace-with-a-random-local-token
node scripts/faa-cli.js doctor
```

When `FAA_BRIDGE_TOKEN` is set, the bridge requires the same token from CLI and WebSocket clients. The bridge also rejects unknown command methods and oversized WebSocket frames.

## Environment Variables

- `FAA_BRIDGE_PORT`: local bridge port. Default: `17321`.
- `FAA_BRIDGE_TOKEN`: optional shared token for local clients and plugin bridge connections.
- `FAA_BRIDGE_MAX_FRAME_BYTES`: maximum WebSocket frame size. Default: `26214400`.
- `FAA_CLI_TIMEOUT_MS`: default non-export CLI request timeout.
- `FAA_CLI_EXPORT_TIMEOUT_MS`: default export timeout.
- `FAA_CLI_LOCK_DIR`: directory for the single-command lock file.

## Included Tools

- `scripts/faa-cli.js`: main CLI for bridge/plugin commands.
- `scripts/faa-character-plan.js`: inspect first-level stage roots and produce a character export plan.
- `scripts/faa-export-multiframe-scenes.js`: batch-export timeline frames as scene templates.
- `scripts/faa-normalize-character-export.js`: inspect or apply standard character part names in exported `config.json` files.
- `bridge/server.js`: local WebSocket bridge between the Animate plugin and CLI clients.

## Notes

This repository does not include the Adobe Animate plugin UI/panel implementation. The bridge protocol must match the plugin-side implementation (`faa-agent-v1`).