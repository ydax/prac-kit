/**
 * shared.js — Shared utilities for the PRaC self-managing system.
 *
 * Provides:
 *   - Config loading from prac.config.js
 *   - .env loading
 *   - Linear API client
 *   - Jules REST API client
 *   - Reviewer state file management
 *
 * This is the parameterized version. All repo-specific values come from
 * prac.config.js in the consuming repository's root.
 */

const fs = require('fs');
const path = require('path');

// ── Config Loading ───────────────────────────────────────────────────────────

let _cachedConfig = null;
let _repoRoot = null;

/**
 * Walks up from cwd to find prac.config.js. Caches the result.
 * Returns both the config and the repo root path.
 */
function loadConfig() {
  if (_cachedConfig) return _cachedConfig;

  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const configPath = path.join(dir, 'prac.config.js');
    if (fs.existsSync(configPath)) {
      _cachedConfig = require(configPath);
      _repoRoot = dir;
      return _cachedConfig;
    }
    dir = path.dirname(dir);
  }

  // Fallback: check if we're running from within prac-kit itself
  const selfConfig = path.resolve(__dirname, '../prac.config.js');
  if (fs.existsSync(selfConfig)) {
    _cachedConfig = require(selfConfig);
    _repoRoot = path.resolve(__dirname, '..');
    return _cachedConfig;
  }

  console.error('ERROR: prac.config.js not found.');
  console.error('Run: npx @ydax/prac-kit init');
  process.exit(1);
}

/**
 * Returns the absolute path to the consuming repo's root.
 */
function getRepoRoot() {
  if (!_repoRoot) loadConfig();
  return _repoRoot;
}

// ── .env Loader ──────────────────────────────────────────────────────────────

function loadEnv() {
  const root = getRepoRoot();
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    });
  }
}

// ── Config-Derived Constants ─────────────────────────────────────────────────

function getRepo() {
  return loadConfig().repo;
}

function getLinearTeamKey() {
  return loadConfig().linearTeamKey;
}

function getLinearTeamId() {
  return loadConfig().linearTeamId;
}

function getMaxRevisions() {
  return loadConfig().maxReviewerRevisions || 3;
}

function getPollIntervalMs() {
  return loadConfig().pollIntervalMs || 5 * 60 * 1000;
}

function getJulesSourceContext() {
  return loadConfig().julesSourceContext;
}

function getBlueprintInstructions() {
  return loadConfig().blueprintInstructions || [];
}

function getOrchestratorModel() {
  return process.env.ORCHESTRATOR_MODEL || loadConfig().orchestratorModel || 'gemini-3-pro-preview';
}

function getReviewerModel() {
  return process.env.REVIEWER_MODEL || loadConfig().reviewerModel || 'gemini-3-flash-preview';
}

function getLinearStateId(stateName) {
  const states = loadConfig().linearStates || {};
  return states[stateName] || null;
}

function getStitchConfig() {
  return loadConfig().stitch || { enabled: false, designSystemContext: 'docs/DESIGN.md' };
}

// ── Constants ────────────────────────────────────────────────────────────────

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const JULES_API_URL = 'https://jules.googleapis.com/v1alpha';

function getStateFilePath() {
  return path.join(getRepoRoot(), 'scripts', '.reviewer-state.json');
}

// ── Linear API ───────────────────────────────────────────────────────────────

async function linearQuery(query, variables = {}) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('ERROR: LINEAR_API_KEY not set.');
    process.exit(1);
  }
  const res = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error('Linear API Error:', JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.data;
}

async function getLinearIssue(identifier) {
  const data = await linearQuery(`
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        state { name }
        labels { nodes { name } }
      }
    }
  `, { id: identifier });
  return data.issue;
}

async function updateLinearIssueStatus(issueUuid, stateId) {
  return linearQuery(
    'mutation Update($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }',
    { id: issueUuid, stateId }
  );
}

async function createLinearIssue(title, description, teamId) {
  const effectiveTeamId = teamId || getLinearTeamId();
  if (!effectiveTeamId) {
    console.error('ERROR: No Linear team ID. Set linearTeamId in prac.config.js.');
    process.exit(1);
  }
  const data = await linearQuery(`
    mutation CreateIssue($title: String!, $description: String!, $teamId: String!) {
      issueCreate(input: {
        title: $title,
        description: $description,
        teamId: $teamId
      }) {
        issue {
          id
          identifier
        }
      }
    }
  `, { title, description, teamId: effectiveTeamId });
  return data.issueCreate.issue;
}

async function getNextPriorityIssue(teamKey) {
  const effectiveTeamKey = teamKey || getLinearTeamKey();
  const data = await linearQuery(`
    query {
      issues(filter: { team: { key: { eq: "${effectiveTeamKey}" } }, state: { type: { in: ["unstarted", "backlog"] } } }) {
        nodes {
          identifier
          priority
        }
      }
    }
  `);

  const issues = data.issues.nodes;
  if (!issues || issues.length === 0) return null;

  // In Linear: 1 = Urgent, 2 = High, 3 = Normal, 4 = Low, 0 = No Priority
  // Sort ascending by priority, treat 0 as 99 so it goes to the bottom
  issues.sort((a, b) => {
    const pA = a.priority === 0 ? 99 : a.priority;
    const pB = b.priority === 0 ? 99 : b.priority;
    return pA - pB;
  });

  return issues[0].identifier;
}

// ── Jules REST API ───────────────────────────────────────────────────────────

function julesHeaders() {
  const apiKey = process.env.JULES_API_KEY;
  if (!apiKey) {
    console.error('ERROR: JULES_API_KEY not set. Generate one at https://jules.google.com/settings#api');
    process.exit(1);
  }
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

async function julesCreateSession(prompt, title) {
  const res = await fetch(`${JULES_API_URL}/sessions`, {
    method: 'POST',
    headers: julesHeaders(),
    body: JSON.stringify({
      prompt,
      title,
      sourceContext: {
        source: getJulesSourceContext(),
        githubRepoContext: { startingBranch: 'main' },
      },
      automationMode: 'AUTO_CREATE_PR',
    }),
  });
  const json = await res.json();
  if (json.error) {
    console.error('Jules API Error:', JSON.stringify(json.error, null, 2));
    process.exit(1);
  }
  return json;
}

async function julesGetSession(sessionId) {
  const res = await fetch(`${JULES_API_URL}/sessions/${sessionId}`, {
    headers: julesHeaders(),
  });
  return res.json();
}

async function julesSendMessage(sessionId, prompt) {
  const res = await fetch(`${JULES_API_URL}/sessions/${sessionId}:sendMessage`, {
    method: 'POST',
    headers: julesHeaders(),
    body: JSON.stringify({ prompt }),
  });
  return res.json();
}

// ── Reviewer State File ──────────────────────────────────────────────────────

function loadState() {
  const stateFile = getStateFilePath();
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  }
  return {};
}

function saveState(state) {
  const stateFile = getStateFilePath();
  // Ensure the scripts directory exists
  const dir = path.dirname(stateFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

function getTaskState(linearId) {
  const state = loadState();
  return state[linearId] || null;
}

function setTaskState(linearId, taskState) {
  const state = loadState();
  state[linearId] = {
    ...taskState,
    updatedAt: new Date().toISOString(),
  };
  saveState(state);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Config
  loadConfig,
  getRepoRoot,
  loadEnv,

  // Config accessors
  getRepo,
  getLinearTeamKey,
  getLinearTeamId,
  getMaxRevisions,
  getPollIntervalMs,
  getJulesSourceContext,
  getBlueprintInstructions,
  getOrchestratorModel,
  getReviewerModel,
  getLinearStateId,
  getStitchConfig,

  // Constants
  LINEAR_API_URL,
  JULES_API_URL,

  // Linear API
  linearQuery,
  getLinearIssue,
  createLinearIssue,
  updateLinearIssueStatus,
  getNextPriorityIssue,

  // Jules API
  julesCreateSession,
  julesGetSession,
  julesSendMessage,

  // State management
  loadState,
  saveState,
  getTaskState,
  setTaskState,
};
