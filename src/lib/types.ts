// Minimal subset of the Testkube REST API shapes the extension consumes.
// The cloud API returns the full CRD-like TestWorkflow object; we only model
// the fields we read directly and scan the rest generically.

export interface Settings {
  apiBaseUrl: string;
  dashboardBaseUrl: string;
  apiToken: string;
  // Auto-refresh interval in seconds while viewing a repo; 0 disables polling.
  refreshIntervalSeconds: number;
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
