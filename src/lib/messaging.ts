import type {
  GithubAppCapability,
  GithubEventStatus,
  GithubIntegrationStatus,
  QualityGate,
  TestWorkflowStatus,
} from './types';

// A `content.git.paths` entry, resolved to a GitHub link.
export interface WorkflowGitPath {
  // The literal path/pattern as written in the workflow.
  label: string;
  // GitHub URL to the nearest non-glob directory of the path.
  url: string;
}

export interface MatchedWorkflow {
  name: string;
  gitUris: string[];
  status?: TestWorkflowStatus;
  dashboardUrl: string;
  // Environment this workflow belongs to (discovered from the token).
  environmentId: string;
  environmentName: string;
  // Git paths referenced by this workflow for the current repo, linked to GitHub.
  paths?: WorkflowGitPath[];
}

// An environment that has at least one workflow matching the current repo.
export interface MatchedEnvironment {
  id: string;
  name: string;
  matchCount: number;
  // Dashboard URL for this environment's test-workflows list.
  dashboardUrl: string;
  // Dashboard URL for this environment's executions list.
  executionsUrl: string;
}

// ---- GitHub App (Git Integration) ------------------------------------------

// What the token can do with the GitHub App endpoints, per environment.
export interface EnvironmentCapability {
  environmentId: string;
  environmentName: string;
  capability: GithubAppCapability;
}

// A recent pull request run for the repo, from the integration's event log.
export interface RecentPullRequest {
  number: number;
  // GitHub URL of the pull request.
  url: string;
  // Pipeline status of the webhook event (received/processing/completed/...).
  eventStatus: GithubEventStatus;
  // Overall test status derived from the test executions (or the event).
  overall: TestWorkflowStatus;
  // The AI analysis chat for this run, when one was performed.
  aiSessionUrl?: string;
  // Test workflow executions of the run.
  tests: PullRequestTest[];
  updatedAt: string;
}

// The current repo, connected to an environment through the GitHub App.
export interface RepoGithubConnection {
  environmentId: string;
  environmentName: string;
  repositoryId: string;
  status: GithubIntegrationStatus;
  workflowName?: string;
  errorMessage?: string;
  recentPullRequests: RecentPullRequest[];
}

export interface RepoGithubInfo {
  capabilities: EnvironmentCapability[];
  // True when the control plane reports the feature as turned off.
  featureDisabled: boolean;
  connections: RepoGithubConnection[];
  // Onboarding link when the repo is not connected to any capable environment
  // yet (preselecting the repo when an installation already covers it).
  connectUrl?: string;
  connectEnvironmentName?: string;
}

export interface GetMatchesRequest {
  type: 'GET_MATCHES';
  owner: string;
  repo: string;
  // Bypass caches (discovery + workflow lists) and fetch fresh data.
  force?: boolean;
}

export interface GetPullRequestRequest {
  type: 'GET_PULL_REQUEST';
  owner: string;
  repo: string;
  number: number;
  force?: boolean;
}

export type RuntimeRequest = GetMatchesRequest | GetPullRequestRequest;

export interface MatchesResponse {
  ok: boolean;
  configured: boolean;
  matches: MatchedWorkflow[];
  // Environments (token-accessible) that have matching workflows, for the dropdown.
  environments: MatchedEnvironment[];
  // Base dashboard URL, used by the empty state to link to Testkube.
  dashboardUrl?: string;
  // GitHub App connection state for the repo (absent when the setting is off).
  github?: RepoGithubInfo;
  error?: string;
}

export interface PullRequestTest {
  id: string;
  workflowName: string;
  status?: TestWorkflowStatus;
  url: string;
}

// The latest GitHub App run for one pull request in one environment.
export interface PullRequestRun {
  environmentId: string;
  environmentName: string;
  repositoryId: string;
  eventId: string;
  eventStatus: GithubEventStatus;
  action?: string;
  createdAt: string;
  updatedAt: string;
  // Head commit the run was triggered for (from the execution's event context).
  headSha?: string;
  qualityGates: QualityGate[];
  lastMessage?: string;
  aiSessionUrl?: string;
  tests: PullRequestTest[];
  overall: TestWorkflowStatus;
}

export interface PullRequestResponse {
  ok: boolean;
  configured: boolean;
  // False when the GitHub App setting is switched off in the options page.
  enabled: boolean;
  capabilities: EnvironmentCapability[];
  featureDisabled: boolean;
  // True when the repo is connected in at least one capable environment.
  connected: boolean;
  runs: PullRequestRun[];
  connectUrl?: string;
  dashboardUrl?: string;
  error?: string;
}
