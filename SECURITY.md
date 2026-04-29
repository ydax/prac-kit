# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in PRaC Kit, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email [security@ydax.com](mailto:security@ydax.com) with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

We will acknowledge your email within 48 hours and provide a detailed response
within 5 business days.

## Scope

PRaC Kit is a scaffolding and orchestration tool. Security concerns most likely
involve:

- **API key exposure** — Scripts handle Linear, Jules, and Gemini API keys.
  Keys should never be committed to source control.
- **Shell injection** — Scripts execute `gh` and `git` CLI commands.
  Input sanitization is critical.
- **LLM prompt injection** — The Orchestrator and Reviewer pass user-authored
  content (Stories, PRs) to LLMs. Prompt injection could alter Blueprint
  generation or review outcomes.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |
