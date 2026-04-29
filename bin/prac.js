#!/usr/bin/env node

/**
 * prac — CLI for the PRaC (Product Requirements as Code) toolkit.
 *
 * Commands:
 *   prac init              Initialize PRaC in the current repository
 *   prac update            Update scripts and workflows to the latest version
 *   prac epic create <n>   Scaffold a new epic directory
 *   prac doctor            Validate configuration and report drift
 */

const fs = require('fs');
const path = require('path');

const PRAC_KIT_ROOT = path.resolve(__dirname, '..');
const CWD = process.cwd();

// ── Helpers ──────────────────────────────────────────────────────────────────

function copyFile(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`   ✅ ${path.relative(CWD, dest)}`);
}

function copyIfNewer(src, dest) {
  if (!fs.existsSync(dest)) {
    copyFile(src, dest);
    return;
  }
  const srcContent = fs.readFileSync(src, 'utf-8');
  const destContent = fs.readFileSync(dest, 'utf-8');
  if (srcContent !== destContent) {
    copyFile(src, dest);
    console.log(`      (updated)`);
  } else {
    console.log(`   ⏭️  ${path.relative(CWD, dest)} (unchanged)`);
  }
}

// ── Init Command ─────────────────────────────────────────────────────────────

function cmdInit() {
  console.log(`\n🚀 Initializing PRaC in ${CWD}\n`);

  // 1. Copy prac.config.js (never overwrite)
  const configDest = path.join(CWD, 'prac.config.js');
  if (!fs.existsSync(configDest)) {
    copyFile(path.join(PRAC_KIT_ROOT, 'prac.config.example.js'), configDest);
    console.log(`\n   ⚠️  Edit prac.config.js with your repo-specific values!\n`);
  } else {
    console.log(`   ⏭️  prac.config.js already exists (preserved)`);
  }

  // 2. Copy scripts
  console.log(`\n📜 Installing scripts...`);
  const scripts = [
    'shared.js',
    'trigger-jules.js',
    'kickoff-sprint.js',
    'orchestrate-story.js',
    'on-blueprint-merge.js',
    'review-pr.js',
    'create-linear-cascade.js',
  ];
  for (const script of scripts) {
    copyFile(
      path.join(PRAC_KIT_ROOT, 'lib', script),
      path.join(CWD, 'scripts', script)
    );
  }

  // 3. Copy workflows
  console.log(`\n⚙️  Installing GitHub Actions workflows...`);
  const workflows = ['orchestrator.yml', 'reviewer.yml', 'blueprint-merged.yml', 'nightly.yml'];
  for (const wf of workflows) {
    const src = path.join(PRAC_KIT_ROOT, 'workflows', wf);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(CWD, '.github', 'workflows', wf));
    }
  }

  // 4. Create epics directory
  const epicsDir = path.join(CWD, 'epics');
  if (!fs.existsSync(epicsDir)) {
    fs.mkdirSync(epicsDir, { recursive: true });
    console.log(`\n📁 Created epics/ directory`);
  }

  // 5. Copy STORY_TEMPLATE.md
  const templateSrc = path.join(PRAC_KIT_ROOT, 'templates', 'STORY_TEMPLATE.md');
  if (fs.existsSync(templateSrc)) {
    copyFile(templateSrc, path.join(CWD, 'epics', 'STORY_TEMPLATE.md'));
  }

  // 6. Create .gitignore entries
  const gitignorePath = path.join(CWD, '.gitignore');
  const ignoreEntries = [
    'scripts/.reviewer-state.json',
    '.jules-issue-body.tmp.md',
    '.orchestrator-pr-body.tmp.md',
  ];
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf-8');
    const toAdd = ignoreEntries.filter(e => !existing.includes(e));
    if (toAdd.length > 0) {
      fs.appendFileSync(gitignorePath, '\n# PRaC Kit\n' + toAdd.join('\n') + '\n');
      console.log(`\n📝 Added PRaC entries to .gitignore`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ✅ PRaC INITIALIZED`);
  console.log(`  Next steps:`);
  console.log(`  1. Edit prac.config.js with your repo values`);
  console.log(`  2. Set LINEAR_API_KEY and JULES_API_KEY in .env`);
  console.log(`  3. Add secrets to GitHub repo settings`);
  console.log(`  4. Create your first epic: prac epic create my-feature`);
  console.log(`${'═'.repeat(50)}\n`);
}

// ── Update Command ───────────────────────────────────────────────────────────

function cmdUpdate() {
  console.log(`\n🔄 Updating PRaC scripts and workflows...\n`);

  const scripts = [
    'shared.js', 'trigger-jules.js', 'kickoff-sprint.js',
    'orchestrate-story.js', 'on-blueprint-merge.js', 'review-pr.js',
    'create-linear-cascade.js',
  ];

  console.log(`📜 Scripts:`);
  for (const script of scripts) {
    copyIfNewer(
      path.join(PRAC_KIT_ROOT, 'lib', script),
      path.join(CWD, 'scripts', script)
    );
  }

  console.log(`\n⚙️  Workflows:`);
  const workflows = ['orchestrator.yml', 'reviewer.yml', 'blueprint-merged.yml', 'nightly.yml'];
  for (const wf of workflows) {
    const src = path.join(PRAC_KIT_ROOT, 'workflows', wf);
    if (fs.existsSync(src)) {
      copyIfNewer(src, path.join(CWD, '.github', 'workflows', wf));
    }
  }

  console.log(`\n✅ Update complete. prac.config.js was NOT modified.\n`);
}

// ── Epic Create Command ──────────────────────────────────────────────────────

function cmdEpicCreate(epicName) {
  if (!epicName) {
    console.error('Usage: prac epic create <epic-name>');
    process.exit(1);
  }

  const slug = epicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const epicDir = path.join(CWD, 'epics', slug);

  if (fs.existsSync(epicDir)) {
    console.error(`Epic directory already exists: epics/${slug}/`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(epicDir, 'stories'), { recursive: true });
  fs.mkdirSync(path.join(epicDir, 'blueprint'), { recursive: true });

  // EPIC.md
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(path.join(epicDir, 'EPIC.md'), `---
id: epic-${slug}
title: ${epicName}
status: planning
created_at: ${today}
---

# Epic: ${epicName}

## Objective

_What strategic capability does this epic deliver?_

## Scope

_What is included and what is explicitly excluded?_

## Success Criteria

_How do we know this epic is complete?_

## Stories

_Stories will be created in \`stories/\` as individual \`STORY.md\` files._
`, 'utf-8');

  // Empty BLUEPRINT.md
  fs.writeFileSync(path.join(epicDir, 'blueprint', 'BLUEPRINT.md'), `# Blueprint: ${epicName}

**Last Updated:** ${today}
**Epic:** \`epic-${slug}\`

---

## Entities

| Entity | Description | Owner |
|--------|-------------|-------|
| _(none yet)_ | | |

## State Machines

_(No state machines defined yet.)_

## Gherkin Scenarios

_(Scenarios will be generated by the Orchestrator when stories are added.)_

## Component Specifications

| Component | Description | Props |
|-----------|-------------|-------|
| _(none yet)_ | | |
`, 'utf-8');

  console.log(`\n✅ Epic scaffolded: epics/${slug}/`);
  console.log(`   ├── EPIC.md`);
  console.log(`   ├── stories/`);
  console.log(`   └── blueprint/`);
  console.log(`       └── BLUEPRINT.md`);
  console.log(`\n   Next: Create a story in epics/${slug}/stories/\n`);
}

// ── Doctor Command ───────────────────────────────────────────────────────────

function cmdDoctor() {
  console.log(`\n🩺 PRaC Doctor — Checking configuration...\n`);
  let issues = 0;

  // Check prac.config.js
  const configPath = path.join(CWD, 'prac.config.js');
  if (!fs.existsSync(configPath)) {
    console.log(`   ❌ prac.config.js not found`);
    issues++;
  } else {
    const config = require(configPath);
    console.log(`   ✅ prac.config.js found`);
    console.log(`      repo: ${config.repo}`);
    console.log(`      team: ${config.linearTeamKey}`);

    if (!config.repo || config.repo === 'ydax/my-repo') {
      console.log(`   ⚠️  repo is still the default value`);
      issues++;
    }
    if (!config.linearTeamKey || config.linearTeamKey === 'MYR') {
      console.log(`   ⚠️  linearTeamKey is still the default value`);
      issues++;
    }
    if (!config.linearTeamId) {
      console.log(`   ⚠️  linearTeamId is not set`);
      issues++;
    }
  }

  // Check scripts
  const requiredScripts = ['shared.js', 'trigger-jules.js', 'orchestrate-story.js', 'review-pr.js'];
  for (const s of requiredScripts) {
    const sp = path.join(CWD, 'scripts', s);
    if (fs.existsSync(sp)) {
      console.log(`   ✅ scripts/${s}`);
    } else {
      console.log(`   ❌ scripts/${s} missing`);
      issues++;
    }
  }

  // Check workflows
  const requiredWorkflows = ['orchestrator.yml', 'reviewer.yml', 'blueprint-merged.yml'];
  for (const w of requiredWorkflows) {
    const wp = path.join(CWD, '.github', 'workflows', w);
    if (fs.existsSync(wp)) {
      console.log(`   ✅ .github/workflows/${w}`);
    } else {
      console.log(`   ❌ .github/workflows/${w} missing`);
      issues++;
    }
  }

  // Check .env
  const envPath = path.join(CWD, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8');
    console.log(`   ${env.includes('LINEAR_API_KEY') ? '✅' : '⚠️ '} LINEAR_API_KEY in .env`);
    console.log(`   ${env.includes('JULES_API_KEY') ? '✅' : '⚠️ '} JULES_API_KEY in .env`);
    console.log(`   ${env.includes('GEMINI_API_KEY') ? '✅' : '⚠️ '} GEMINI_API_KEY in .env`);
  } else {
    console.log(`   ⚠️  No .env file found`);
  }

  // Check epics
  const epicsDir = path.join(CWD, 'epics');
  if (fs.existsSync(epicsDir)) {
    const epicDirs = fs.readdirSync(epicsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    console.log(`   ✅ ${epicDirs.length} epic(s) found`);
  } else {
    console.log(`   ⚠️  No epics/ directory`);
  }

  console.log(`\n${issues === 0 ? '✅ All checks passed!' : `⚠️  ${issues} issue(s) found.`}\n`);
}

// ── Main Router ──────────────────────────────────────────────────────────────

const [,, command, subcommand, ...rest] = process.argv;

switch (command) {
  case 'init':
    cmdInit();
    break;
  case 'update':
    cmdUpdate();
    break;
  case 'epic':
    if (subcommand === 'create') {
      cmdEpicCreate(rest[0]);
    } else {
      console.error('Usage: prac epic create <name>');
    }
    break;
  case 'doctor':
    cmdDoctor();
    break;
  default:
    console.log(`
PRaC Kit — Product Requirements as Code

Commands:
  prac init              Initialize PRaC in the current repository
  prac update            Update scripts and workflows to latest
  prac epic create <n>   Scaffold a new epic directory
  prac doctor            Validate configuration and report drift

Learn more: https://github.com/ydax/prac-kit
`);
}
