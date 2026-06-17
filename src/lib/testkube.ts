import type { Settings, TestWorkflowExecutionsResult } from './types';

export class TestkubeError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TestkubeError';
    this.status = status;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function agentBaseUrl(s: Settings): string {
  const base = s.apiBaseUrl.replace(/\/+$/, '');
  return `${base}/organizations/${encodeURIComponent(s.orgId)}/environments/${encodeURIComponent(
    s.environmentId,
  )}/agent`;
}

async function apiGet<T>(s: Settings, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${agentBaseUrl(s)}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${s.apiToken}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new TestkubeError(`Network error contacting Testkube: ${String(err)}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore body read errors
    }
    throw new TestkubeError(
      `Testkube API ${res.status} ${res.statusText}${detail ? `: ${truncate(detail, 200)}` : ''}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

// List all TestWorkflows for the configured organization/environment.
export async function listWorkflows(s: Settings): Promise<unknown[]> {
  const data = await apiGet<unknown>(s, '/test-workflows');
  return Array.isArray(data) ? data : [];
}

// Latest execution status for a workflow (best effort).
export async function getLatestExecutionStatus(
  s: Settings,
  workflowName: string,
): Promise<string | undefined> {
  const data = await apiGet<TestWorkflowExecutionsResult>(
    s,
    `/test-workflows/${encodeURIComponent(workflowName)}/executions`,
  );
  return data.results?.[0]?.result?.status;
}
