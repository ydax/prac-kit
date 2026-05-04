# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-04

### Added
- **Question Responder:** New `question-responder.js` script that polls for
  Jules sessions in `AWAITING_USER_FEEDBACK` state, builds repo context
  (AGENTS.md, stories, blueprints, source files), and uses Gemini to either
  auto-respond (HIGH confidence) or escalate to a human via GitHub Issue.
- New GitHub Actions workflow template: `question-responder.yml` (30-minute cron).
- New `questionResponder` config section in `prac.config.js` with safety controls:
  `confidenceThreshold`, `maxAutoResponses`, `escalationLabel`, `contextFiles`.
- New Jules API helpers in `shared.js`: `julesListSessions()`, `julesListActivities()`.

## [1.1.0] - 2026-04-29

### Added
- `prac config` command: Interactive CLI walkthrough for setting up `prac.config.js`.
  Groups custom properties (repo, team key, Linear IDs) as required prompts and
  model/workflow settings as optional defaults.

## [1.0.0] - 2026-04-29

### Added
- Initial release of PRaC Kit.
- CLI commands: `prac init`, `prac update`, `prac epic create`, `prac doctor`.
- Parameterized scripts: `shared.js`, `orchestrate-story.js`, `review-pr.js`,
  `trigger-jules.js`, `kickoff-sprint.js`, `on-blueprint-merge.js`,
  `create-linear-cascade.js`.
- GitHub Actions workflow templates: `orchestrator.yml`, `reviewer.yml`,
  `blueprint-merged.yml`, `nightly.yml`.
- Story template and operational guide documentation.
- `prac.config.js` configuration surface for all repo-specific values.
