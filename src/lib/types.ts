// Minimal subset of the Testkube REST API shapes the extension consumes.
// The cloud API returns the full CRD-like TestWorkflow object; we only model
// the fields we read directly and scan the rest generically.

export interface Settings {
  apiBaseUrl: string;
  dashboardBaseUrl: string;
  apiToken: string;
  // Auto-refresh interval in seconds while viewing a repo; 0 disables polling.
  refreshIntervalSeconds: number;
  // Allowlist of wildcard patterns matched (case-insensitively) against the
  // "owner/repo" of the current page. Empty means active on all repos.
  repoFilters: string[];
  // Query the GitHub App (Git Integration) endpoints for connection state and
  // pull request results. Off silences those requests entirely.
  githubAppIntegration: boolean;
}

// Control-plane discovery shapes (subset). The token is tied to a single
// organization; the environments endpoint returns the set the token may access.
export interface Organization {
  id: string;
  name: string;
  slug?: string;
}

export interface Environment {
  id: string;
  name: string;
  slug?: string;
  connected?: boolean | null;
  status?: string;
}

export interface ListResponse<T> {
  elements?: T[];
}

// TestWorkflowStatus enum values we care about; kept as a string union with a
// fallback so unknown future statuses still pass through.
export type TestWorkflowStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'paused'
  | 'passed'
  | 'failed'
  | 'aborted'
  | 'aborting'
  | 'timeout'
  | 'canceled'
  | (string & {});

export interface TestWorkflowResultSummary {
  status?: TestWorkflowStatus;
}

export interface TestWorkflowExecutionSummary {
  id?: string;
  name?: string;
  number?: number;
  scheduledAt?: string;
  result?: TestWorkflowResultSummary;
}

export interface TestWorkflowExecutionsResult {
  results?: TestWorkflowExecutionSummary[];
}

// ---- GitHub App (Git Integration / quality loop) shapes ---------------------

// A repository reachable through one of the organization's GitHub App
// installations (GET .../integrations/github/repositories).
export interface GithubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  installationOwner: string;
}

export interface GithubRepositoryList {
  repositories?: GithubRepository[];
  page?: number;
  perPage?: number;
  hasMore?: boolean;
  total?: number;
}

export type GithubIntegrationStatus =
  | 'pending'
  | 'onboarding'
  | 'in_progress'
  | 'active'
  | 'disabled'
  | 'failed'
  | 'canceled'
  | 'ready'
  | (string & {});

export interface QualityGate {
  type: string;
  required: boolean;
}

// A repository connected to an environment (GET .../integrations/github/integrations).
export interface GithubRepositoryIntegration {
  id: string;
  // GitHub repository ID as a decimal string.
  repositoryId: string;
  status: GithubIntegrationStatus;
  workflowName?: string;
  qualityGates?: QualityGate[];
  errorMessage?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type GithubEventKind =
  | 'pull_request'
  | 'issue_comment'
  | 'push'
  | 'tag_push'
  | 'release'
  | 'repository_onboarding'
  | (string & {});

export type GithubEventStatus =
  | 'received'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped'
  | (string & {});

export interface GithubEventChildExecution {
  id: string;
  workflowName: string;
  status?: TestWorkflowStatus;
  scheduledAt?: string;
  finishedAt?: string;
}

// A processed webhook event for a connected repository
// (GET .../integrations/github/repositories/{repositoryId}/events).
export interface GithubRepositoryIntegrationEvent {
  id: string;
  status: GithubEventStatus;
  kind?: GithubEventKind;
  action?: string;
  issueNumber?: number;
  executionId?: string;
  workflowName?: string;
  qualityGates?: QualityGate[];
  lastMessage?: string;
  aiSessionId?: string;
  children?: GithubEventChildExecution[];
  createdAt: string;
  updatedAt: string;
}

export interface GithubRepositoryIntegrationEventList {
  events?: GithubRepositoryIntegrationEvent[];
  page?: number;
  perPage?: number;
  hasMore?: boolean;
  total?: number;
}

// Reverse lookup from an execution to the GitHub event that started it
// (GET .../executions/{executionId}/integration-events).
export interface ExecutionIntegrationEventLink {
  type: 'external' | 'internal';
  label: string;
  url?: string;
  path?: string;
}

export interface ExecutionIntegrationEvent {
  id: string;
  provider: string;
  kind: string;
  status: string;
  integrationId: string;
  executionId: string;
  workflowName?: string;
  createdAt: string;
  updatedAt: string;
  context?: {
    github?: {
      repositoryId: string;
      repositoryFullName?: string;
      repositoryHtmlUrl?: string;
      issueNumber?: number;
      action?: string;
      headSha?: string;
      ref?: string;
      tagName?: string;
    };
  };
  links?: ExecutionIntegrationEventLink[];
}

export interface ListExecutionIntegrationEventsResponse {
  events?: ExecutionIntegrationEvent[];
}

// What the token can do with the GitHub App endpoints in one environment.
//  - available: the token can use the endpoints and the feature is on
//  - forbidden: the feature is on but this token is denied here (e.g. an
//               older control plane that still requires the run role)
//  - disabled:  the control plane has the GitHub App feature turned off
//  - error:     the probe failed for another reason (network, 5xx, ...)
export type GithubAppCapability = 'available' | 'forbidden' | 'disabled' | 'error';
