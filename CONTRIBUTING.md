# Contributing to PRaC Kit

Thank you for your interest in contributing to PRaC Kit! This document provides
guidelines and information to help you get started.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code. Please report unacceptable
behavior to [oss@ydax.com](mailto:oss@ydax.com).

## How to Contribute

### Reporting Bugs

1. Check the [existing issues](https://github.com/ydax/prac-kit/issues) to avoid duplicates.
2. Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md).
3. Include your Node.js version, OS, and the output of `prac doctor`.

### Suggesting Features

1. Open a [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md).
2. Describe the problem your feature would solve, not just the solution.
3. PRaC Kit is opinionated by design — features should align with the
   Epic → Story → Blueprint → TDA pipeline.

### Submitting Pull Requests

1. Fork the repository and create a branch from `master`.
2. If you've added functionality, add or update documentation.
3. Ensure your code follows the existing style (vanilla JavaScript, JSDoc comments).
4. Fill out the [Pull Request template](.github/PULL_REQUEST_TEMPLATE.md).
5. Submit the PR and wait for review.

## Development Setup

```bash
git clone https://github.com/ydax/prac-kit.git
cd prac-kit

# Test the CLI locally
node bin/prac.js

# Test init against a scratch directory
mkdir /tmp/test-repo && cd /tmp/test-repo
node /path/to/prac-kit/bin/prac.js init
node /path/to/prac-kit/bin/prac.js doctor
```

## Style Guide

- **JavaScript only.** No TypeScript.
- **JSDoc comments** on all exported functions.
- **No external dependencies.** PRaC Kit uses only Node.js built-in modules.
- **Config-driven.** All repo-specific values must come from `prac.config.js`, never hardcoded.

## License

By contributing to PRaC Kit, you agree that your contributions will be licensed
under the [Apache License 2.0](LICENSE).
