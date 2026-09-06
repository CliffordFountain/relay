# Security Policy

Relay is self-hosted software: when you run it, you operate the server, the database,
and the network it lives on. Keeping a given deployment secure (TLS, firewalling,
backups, patching the host) is the operator's responsibility. This policy covers
vulnerabilities in the Relay code itself.

## Supported versions

Relay is pre-1.0 and moves quickly. Security fixes are made against the latest
released version on the `main` branch. If you are running an older checkout, update
before reporting so we can confirm the issue still exists.

| Version | Supported          |
| ------- | ------------------ |
| latest `main` | :white_check_mark: |
| older checkouts | :x:              |

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.** A public
report tells attackers about the problem before operators can patch.

Instead, report it privately:

- Preferred: GitHub's **private vulnerability reporting** (the "Report a vulnerability"
  button under the repository's **Security** tab), which opens a private advisory.
- Or get in touch through https://liquidict.co.uk and mark the message as a security
  report.

Please include:

- what the vulnerability is and the impact you think it has,
- the steps or a proof of concept to reproduce it,
- the version/commit you tested, and
- any suggested fix, if you have one.

## What to expect

- We aim to acknowledge a report within a few business days.
- We will confirm the issue, work on a fix, and keep you updated on progress.
- Once a fix is released, we are happy to credit you in the advisory unless you would
  rather stay anonymous.

Thank you for helping keep Relay and the people who self-host it safe.
