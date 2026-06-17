// Minimal subset of the Testkube REST API shapes the extension consumes.
// The cloud API returns the full CRD-like TestWorkflow object; we only model
// the fields we read directly and scan the rest generically.

export interface Settings {
  apiBaseUrl: string;
  dashboardBaseUrl: string;
  orgId: string;
  environmentId: string;
  apiToken: string;
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
