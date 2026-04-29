# PRaC Kit

**Product Requirements as Code** — An autonomous development toolkit.

PRaC Kit packages the closed-loop autonomous development system into a portable, versioned toolkit that can be installed in any repository.

## What It Does

PRaC Kit gives your repository an autonomous development pipeline:

```
Human writes Story → Orchestrator generates Blueprint PR → Jules writes tests →
Jules implements → Automated Reviewer merges or sends feedback → Next task triggers
```

## Quick Start

```bash
# Initialize PRaC in your repository
npx @ydax/prac-kit init

# Edit the generated config file
vim prac.config.js

# Create your first epic
npx @ydax/prac-kit epic create my-feature

# Validate your setup
npx @ydax/prac-kit doctor
```

## What Gets Installed

```
your-repo/
├── prac.config.js                    ← repo-specific configuration
├── scripts/
│   ├── shared.js                     ← shared utilities (config-driven)
│   ├── orchestrate-story.js          ← Story → Blueprint translation
│   ├── review-pr.js                  ← automated PR reviewer
│   ├── trigger-jules.js              ← Jules REST API trigger
│   ├── kickoff-sprint.js             ← priority cascade kickoff
│   ├── on-blueprint-merge.js         ← post-merge Linear issue creation
│   └── create-linear-cascade.js      ← batch Linear issue creation
├── .github/workflows/
│   ├── orchestrator.yml              ← detects Story changes on push
│   ├── reviewer.yml                  ← reviews Jules PRs automatically
│   ├── blueprint-merged.yml          ← triggers Jules after Blueprint merge
│   └── nightly.yml                   ← nightly test suite
└── epics/
    └── STORY_TEMPLATE.md             ← template for new stories
```

## Commands

| Command | Description |
|---------|-------------|
| `prac init` | Initialize PRaC in the current repository |
| `prac update` | Update scripts and workflows to latest version |
| `prac epic create <name>` | Scaffold a new epic directory |
| `prac doctor` | Validate configuration and report drift |

## Configuration

All repo-specific values live in `prac.config.js`:

```javascript
module.exports = {
  repo: 'ydax/my-repo',
  linearTeamKey: 'MYR',
  linearTeamId: 'uuid-from-linear',
  projectName: 'My Project',
  orchestratorModel: 'gemini-3-pro-preview',
  reviewerModel: 'gemini-3-flash-preview',
  autoMergeBlueprints: true,
  maxReviewerRevisions: 3,
  cascadeEnabled: true,
  // ... see prac.config.example.js for all options
};
```

## Requirements

- Node.js 20+
- GitHub CLI (`gh`) authenticated
- API keys in `.env`: `LINEAR_API_KEY`, `JULES_API_KEY`, `GEMINI_API_KEY`
- Same keys in GitHub repository secrets

## Documentation

- [Operational Guide](docs/operational-guide.md) — How the system works day-to-day
- [prac.config.example.js](prac.config.example.js) — All configuration options

## Architecture

The PRaC system is built on three invariants:

1. **Blueprint is the contract.** No code is written without a `BLUEPRINT.md` entry.
2. **Tests before code.** Agents write failing tests first (Test-Driven Autonomy).
3. **Docs as code.** Documentation lives entirely in the repository.

## CHANGELOG

- **v1.1.0** (2026-04-29): Added the `prac config` command. This interactive CLI walkthrough allows you to quickly scaffold and set custom values in your `prac.config.js` while keeping models and workflow behaviors grouped as defaults.

## License

MIT
