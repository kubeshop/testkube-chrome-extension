import type { TestWorkflowStatus } from './types';

export interface MatchedWorkflow {
  name: string;
  gitUris: string[];
  status?: TestWorkflowStatus;
  dashboardUrl: string;
  // Environment this workflow belongs to (discovered from the token).
  environmentId: string;
  environmentName: string;
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

export interface GetMatchesRequest {
  type: 'GET_MATCHES';
  owner: string;
  repo: string;
  // Bypass caches (discovery + workflow lists) and fetch fresh data.
  force?: boolean;
}

export type RuntimeRequest = GetMatchesRequest;

export interface MatchesResponse {
  ok: boolean;
  configured: boolean;
  matches: MatchedWorkflow[];
  // Environments (token-accessible) that have matching workflows, for the dropdown.
  environments: MatchedEnvironment[];
  // Base dashboard URL, used by the empty state to link to Testkube.
  dashboardUrl?: string;
  error?: string;
}
