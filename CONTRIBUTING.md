# Contributing to Relay

Contributions are welcome — bug reports, fixes, features, docs, all of it. Please read
this before opening a pull request.

## Licensing of contributions

Relay is **source-available**, not open source: it is licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE.md), with commercial use available
under a [separate commercial license](./COMMERCIAL.md).

Because of that dual model, two things apply to every contribution:

1. **Your contribution is accepted under the same PolyForm Noncommercial License** that
   covers the rest of Relay.
2. **You must agree to the [Contributor License Agreement](./CLA.md) (CLA)** before your
   contribution can be merged. The CLA lets the maintainer include your work in both the
   free noncommercial edition and any commercial edition. You keep the copyright to your
   own work — you are granting a license, not signing it away.

If a CLA check bot (e.g. CLA Assistant) is enabled on the repo, it will prompt you to
accept on your first pull request. Otherwise, copy the signed statement at the bottom of
[`CLA.md`](./CLA.md) into your pull request description.

## Ground rules

- Open an issue first for anything large so we can agree on the approach before you build.
- Keep pull requests focused; one logical change per PR.
- Match the existing code style and add tests where it makes sense.
- Do not add dependencies under licenses incompatible with this project without flagging it.
- Do not commit secrets, credentials, or machine-specific config.

## Source file headers (optional but encouraged)

Add an SPDX identifier to the top of new source files so the license is machine-readable:

```
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 Liquid ICT
```

## Reporting security issues

Please do not open a public issue for security vulnerabilities. Follow the private
reporting process in [`SECURITY.md`](./SECURITY.md) so it can be fixed before disclosure.
