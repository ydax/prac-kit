# PRaC Kit

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![npm version](https://img.shields.io/npm/v/prac-kit.svg)](https://www.npmjs.com/package/prac-kit)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Product Requirements as Code** — An open-source toolkit that turns your GitHub repository into a self-managing autonomous development system.

PRaC Kit gives any repository a closed-loop pipeline: you write a user Story in markdown, an AI generates the implementation contract (Blueprint), another AI writes tests-first code, and a third AI reviews and merges the PR — all triggered by a `git push`.

## How It Works

```
Human writes Story → Orchestrator generates Blueprint PR → Jules writes tests →
Jules implements → Automated Reviewer merges or sends feedback → Next task triggers
```

The system is built on three invariants:

1. **Blueprint is the contract.** No code is written without a `BLUEPRINT.md` entry.
2. **Tests before code.** Agents write failing tests first (Test-Driven Autonomy).
3. **Docs as code.** Requirements live entirely in the repository, not in external tools.

## Quick Start

```bash
# Initialize PRaC in your repository
npx prac-kit init

# Configure your repo-specific values interactively
npx prac-kit config

# Create your first epic
npx prac-kit epic create my-feature

# Validate your setup
npx prac-kit doctor
```

## What Gets Installed

```
your-repo/
├── prac.config.js                    ← repo-specific configuration
├── scripts/
│   ├── shared.js                     ← shared utilities (config-driven)
│   ├── orchestrate-story.js          ← Story → Blueprint translation via Gemini
│   ├── review-pr.js                  ← LLM-powered automated PR reviewer
│   ├── trigger-jules.js              ← Jules REST API trigger
│   ├── kickoff-sprint.js             ← priority cascade kickoff
│   ├── on-blueprint-merge.js         ← post-merge Linear issue creation
│   └── create-linear-cascade.js      ← batch Linear issue creation
├── .github/workflows/
│   ├── orchestrator.yml              ← detects Story changes on push
│   ├── reviewer.yml                  ← reviews Jules PRs automatically
│   ├── blueprint-merged.yml          ← triggers Jules after Blueprint merge
│   └── nightly.yml                   ← nightly test suite with self-healing
└── epics/
    └── STORY_TEMPLATE.md             ← template for new user stories
```

## Commands

| Command | Description |
|---------|-------------|
| `prac init` | Initialize PRaC in the current repository |
| `prac config` | Interactive walkthrough to set up `prac.config.js` |
| `prac update` | Update scripts and workflows to latest version |
| `prac epic create <name>` | Scaffold a new epic directory |
| `prac doctor` | Validate configuration and report drift |

## Configuration

All repo-specific values live in `prac.config.js`:

```javascript
module.exports = {
  repo: 'your-org/your-repo',
  linearTeamKey: 'YOUR',
  linearTeamId: 'uuid-from-linear',
  projectName: 'Your Project',
  orchestratorModel: 'gemini-3-pro-preview',
  reviewerModel: 'gemini-3-flash-preview',
  autoMergeBlueprints: true,
  maxReviewerRevisions: 3,
  cascadeEnabled: true,
  // ... see prac.config.example.js for all options
};
```

## Requirements

- **Node.js 20+**
- **GitHub CLI** (`gh`) authenticated
- **API keys** in `.env` and GitHub repository secrets:
  - `LINEAR_API_KEY` — [Linear API](https://linear.app/settings/api)
  - `JULES_API_KEY` — [Jules API](https://jules.google.com/settings#api)
  - `GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com/apikey)

## Documentation

- [Operational Guide](docs/operational-guide.md) — How the autonomous loop works day-to-day
- [Configuration Reference](prac.config.example.js) — All configurable values with documentation
- [Changelog](CHANGELOG.md) — Version history

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md)
and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a pull request.

## Security

To report a security vulnerability, please see our [Security Policy](SECURITY.md).

## License

Copyright 2026 YDAX, Inc.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.
