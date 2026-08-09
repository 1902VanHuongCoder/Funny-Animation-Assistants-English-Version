# Security Policy

## Supported Scope

This project is a local automation bridge for Adobe Animate. It is designed for local use on `127.0.0.1` and does not provide a remote service.

## Reporting a Vulnerability

Please report vulnerabilities privately to the repository owner before publishing details. Include:

- Affected commit or release.
- Reproduction steps.
- Impact and whether Adobe Animate or FLA files can be modified, exported, or accessed unexpectedly.
- Suggested mitigation if known.

## Local Threat Model

The bridge controls a local Animate session. Any local process that can connect to the bridge may be able to request allowed plugin operations unless `FAA_BRIDGE_TOKEN` is configured. On shared machines, set `FAA_BRIDGE_TOKEN` to a high-entropy value before starting the bridge and plugin.

The bridge rejects methods outside its command allowlist. Do not add new methods without checking whether they can save, delete, rename, execute arbitrary JSFL, or otherwise modify source FLA documents.