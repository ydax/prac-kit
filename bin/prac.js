#!/usr/bin/env node

/**
 * prac — CLI for the PRaC (Product Requirements as Code) toolkit.
 *
 * Commands:
 *   prac init              Initialize PRaC in the current repository
 *   prac update            Update scripts and workflows to the latest version
 *   prac config            Interactive walkthrough to set up prac.config.js
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
    'question-responder.js',
  ];
  for (const script of scripts) {
    copyFile(
      path.join(PRAC_KIT_ROOT, 'lib', script),
      path.join(CWD, 'scripts', script)
    );
  }

  // 3. Copy workflows
  console.log(`\n⚙️  Installing GitHub Actions workflows...`);
  const workflows = ['orchestrator.yml', 'reviewer.yml', 'blueprint-merged.yml', 'nightly.yml', 'question-responder.yml'];
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
  console.log(`  4. Go to Settings > Actions > General > Workflow permissions`);
  console.log(`     and check "Allow GitHub Actions to create and approve pull requests"`);
  console.log(`  5. Create your first epic: prac epic create my-feature`);
  console.log(`${'═'.repeat(50)}\n`);
}

// ── Update Command ───────────────────────────────────────────────────────────

function cmdUpdate() {
  console.log(`\n🔄 Updating PRaC scripts and workflows...\n`);

  const scripts = [
    'shared.js', 'trigger-jules.js', 'kickoff-sprint.js',
    'orchestrate-story.js', 'on-blueprint-merge.js', 'review-pr.js',
    'create-linear-cascade.js', 'question-responder.js',
  ];

  console.log(`📜 Scripts:`);
  for (const script of scripts) {
    copyIfNewer(
      path.join(PRAC_KIT_ROOT, 'lib', script),
      path.join(CWD, 'scripts', script)
    );
  }

  console.log(`\n⚙️  Workflows:`);
  const workflows = ['orchestrator.yml', 'reviewer.yml', 'blueprint-merged.yml', 'nightly.yml', 'question-responder.yml'];
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

// ── Config Walkthrough Command ───────────────────────────────────────────────

const readline = require('readline');

function askQuestion(rl, question, defaultVal) {
  return new Promise(resolve => {
    rl.question(`${question} ${defaultVal ? `(${defaultVal}): ` : ': '}`, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function cmdConfig() {
  console.log(`\n⚙️  PRaC Configuration Walkthrough\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const configPath = path.join(CWD, 'prac.config.js');
  let currentConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      currentConfig = require(configPath);
      console.log(`Found existing prac.config.js, using it for defaults.\n`);
    } catch(e) {}
  }

  const getDef = (key, fallback) => currentConfig[key] !== undefined ? currentConfig[key] : fallback;

  const repo = await askQuestion(rl, "Repository slug (e.g., ydax/my-repo)", getDef('repo', 'ydax/my-repo'));
  const projectName = await askQuestion(rl, "Project Name", getDef('projectName', 'My Project'));
  const linearTeamKey = await askQuestion(rl, "Linear Team Key (e.g., HAA)", getDef('linearTeamKey', 'MYR'));
  const linearTeamId = await askQuestion(rl, "Linear Team ID (UUID)", getDef('linearTeamId', ''));
  const epicsDir = await askQuestion(rl, "Epics Directory", getDef('epicsDir', 'epics'));
  const docsDir = await askQuestion(rl, "Docs Directory", getDef('docsDir', 'docs'));
  
  const defaultJulesSource = `sources/github/${repo}`;
  const julesSourceContext = await askQuestion(rl, "Jules Source Context", getDef('julesSourceContext', defaultJulesSource));
  const agentsFile = await askQuestion(rl, "Agents File path", getDef('agentsFile', 'AGENTS.md'));

  const linearStates = currentConfig.linearStates || {};
  const inProgress = await askQuestion(rl, "Linear 'In Progress' State ID", linearStates.inProgress || '');
  const done = await askQuestion(rl, "Linear 'Done' State ID (optional)", linearStates.done || '');

  const changeDefaults = await askQuestion(rl, "\nDo you want to modify default settings (models, revisions, auto-merge, cascade)? (y/N)", "N");
  
  let orchestratorModel = getDef('orchestratorModel', 'gemini-3-pro-preview');
  let reviewerModel = getDef('reviewerModel', 'gemini-3-flash-preview');
  let maxReviewerRevisions = getDef('maxReviewerRevisions', 3);
  let autoMergeBlueprints = getDef('autoMergeBlueprints', true);
  let cascadeEnabled = getDef('cascadeEnabled', true);

  if (changeDefaults.toLowerCase() === 'y') {
    orchestratorModel = await askQuestion(rl, "Orchestrator Model", orchestratorModel);
    reviewerModel = await askQuestion(rl, "Reviewer Model", reviewerModel);
    maxReviewerRevisions = parseInt(await askQuestion(rl, "Max Reviewer Revisions", maxReviewerRevisions), 10);
    const autoMerge = await askQuestion(rl, "Auto-merge Blueprint PRs? (Y/n)", autoMergeBlueprints ? 'Y' : 'n');
    autoMergeBlueprints = autoMerge.toLowerCase() !== 'n';
    const cascade = await askQuestion(rl, "Enable priority cascade? (Y/n)", cascadeEnabled ? 'Y' : 'n');
    cascadeEnabled = cascade.toLowerCase() !== 'n';
  }

  const enableStitch = await askQuestion(rl, "\nEnable Stitch Design Integration? (y/N)", "N");
  const stitchEnabled = enableStitch.toLowerCase() === 'y';
  let designSystemContext = 'docs/DESIGN.md';
  if (stitchEnabled) {
    designSystemContext = await askQuestion(rl, "Path to Design System context file", designSystemContext);
  }

  rl.close();

  const blueprintInstructions = currentConfig.blueprintInstructions || [
    'Read `AGENTS.md` first — it is the universal entry point.',
    'Follow TDA: write failing tests first, then implement.',
    'Update the source STORY.md status to `in_progress` in your first commit, and to `done` in your final commit before opening the PR.',
  ];

  const testCommands = currentConfig.testCommands || [
    'npm run test:ci'
  ];

  const fileContent = `/**
 * prac.config.js — Repository-specific PRaC configuration.
 * Generated by \`prac config\`
 */

module.exports = {
  // ── Identity ──────────────────────────────────────────────────────────────
  repo: '${repo}',
  linearTeamKey: '${linearTeamKey}',
  linearTeamId: '${linearTeamId}',
  projectName: '${projectName}',

  // ── Paths ─────────────────────────────────────────────────────────────────
  epicsDir: '${epicsDir}',
  docsDir: '${docsDir}',

  // ── Agent Configuration ───────────────────────────────────────────────────
  julesSourceContext: '${julesSourceContext}',
  agentsFile: '${agentsFile}',

  blueprintInstructions: ${JSON.stringify(blueprintInstructions, null, 4).replace(/\n/g, '\n  ')},

  // ── LLM Models ────────────────────────────────────────────────────────────
  orchestratorModel: '${orchestratorModel}',
  reviewerModel: '${reviewerModel}',

  // ── Workflow Behavior ─────────────────────────────────────────────────────
  autoMergeBlueprints: ${autoMergeBlueprints},
  maxReviewerRevisions: ${maxReviewerRevisions},
  cascadeEnabled: ${cascadeEnabled},
  pollIntervalMs: ${getDef('pollIntervalMs', 300000)},

  // ── Linear State IDs ──────────────────────────────────────────────────────
  linearStates: {
    inProgress: ${inProgress ? `'${inProgress}'` : 'null'},
    done: ${done ? `'${done}'` : 'null'},
  },

  // ── Stitch Design Integration ─────────────────────────────────────────────
  stitch: {
    enabled: ${stitchEnabled},
    designSystemContext: '${designSystemContext}',
  },

  // ── Test Commands ─────────────────────────────────────────────────────────
  testCommands: ${JSON.stringify(testCommands, null, 4).replace(/\n/g, '\n  ')},
};
`;

  fs.writeFileSync(configPath, fileContent, 'utf-8');
  console.log(`\n✅ Configuration saved to ${configPath}\n`);
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

  // Check GitHub Actions Permissions
  if (configPath && fs.existsSync(configPath)) {
    const config = require(configPath);
    if (config.repo && config.repo !== 'ydax/my-repo') {
      try {
        const { execSync } = require('child_process');
        const output = execSync(`gh api /repos/${config.repo}/actions/permissions/workflow`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        const json = JSON.parse(output);
        if (json.can_approve_pull_request_reviews === true) {
          console.log(`   ✅ GitHub Actions can create and approve PRs`);
        } else {
          console.log(`   ❌ GitHub Actions cannot approve PRs`);
          console.log(`      Fix: Go to https://github.com/${config.repo}/settings/actions`);
          console.log(`      and check "Allow GitHub Actions to create and approve pull requests"`);
          issues++;
        }
      } catch (err) {
        console.log(`   ⚠️  Could not verify GitHub Actions permissions automatically (requires 'gh' CLI).`);
        console.log(`      Verify manually at https://github.com/${config.repo}/settings/actions`);
      }
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
  case 'config':
    cmdConfig();
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
  prac config            Interactive walkthrough to set up prac.config.js
  prac epic create <n>   Scaffold a new epic directory
  prac doctor            Validate configuration and report drift

Learn more: https://github.com/ydax/prac-kit
`);
}
