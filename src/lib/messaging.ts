import type { TestWorkflowStatus } from './types';

export interface MatchedWorkflow {
  name: string;
  gitUris: string[];
  status?: TestWorkflowStatus;
  dashboardUrl: string;
}

export interface GetMatchesRequest {
  type: 'GET_MATCHES';
  owner: string;
  repo: string;
}

export type RuntimeRequest = GetMatchesRequest;

export interface MatchesResponse {
  ok: boolean;
  configured: boolean;
  matches: MatchedWorkflow[];
  // Environment-level dashboard URL (test workflows list) for the footer link.
  environmentUrl?: string;
  error?: string;
}
