# Vibesboard governance

Vibesboard is an open-source, open-core project maintained by NordicAgents.
This document explains how technical and community decisions are made while the
project is in public beta. It complements the contribution process in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and the community standards in
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Project scope

The maintained scope is the self-hosted agent platform described in the
[README](README.md) and [roadmap](ROADMAP.md). The MIT core includes the agent
runtime, workspace isolation, integrations, usage metering, and related
platform features. Commercial Enterprise Edition code lives only under `ee/`
and is governed by [`ee/LICENSE`](ee/LICENSE).

Maintainers may decline changes that do not fit this scope, duplicate planned
work, create an unsustainable support burden, or weaken the tenancy or
licensing boundary. A declined proposal is not a judgement on its value; it may
be better maintained as an extension or a fork.

## Participation and decision-making

Anyone may open issues, take part in GitHub Discussions, and submit pull
requests under the contribution terms in [`CONTRIBUTING.md`](CONTRIBUTING.md).
For substantial changes, begin with an issue so that the problem, approach,
security implications, and ownership can be discussed before implementation.

Maintainers seek rough consensus in public issues and pull requests. When
there is no clear consensus, the maintainers make the final decision based on
the project's security, long-term maintenance cost, compatibility, and stated
roadmap. Decisions and their rationale should be recorded in the relevant
issue or pull request whenever practical.

Security reports, personal data, and other sensitive matters are handled
privately through the process in [`SECURITY.md`](SECURITY.md). They may be
summarised publicly after the affected people and systems are protected.

## Maintainers

Repository maintainers are responsible for triage, reviewing contributions,
releases, security response, and enforcing this governance document and the
Code of Conduct. The current code owners listed in
[`.github/CODEOWNERS`](.github/CODEOWNERS) review protected and
security-sensitive areas.

New maintainers are appointed by the existing maintainers based on sustained,
constructive contributions and demonstrated judgement in the relevant area.
Maintainers may step down at any time. Access is removed when it is no longer
needed or when continued access would put the project or community at risk.

## Changes to governance

Propose changes to this document through a public pull request or discussion.
The maintainers will give material changes a reasonable public comment period
before accepting them, except where an urgent security, legal, or safety need
requires a faster decision.
