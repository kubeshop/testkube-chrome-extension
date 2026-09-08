import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, getSettings, isConfigured, saveSettings } from '../lib/storage';
import { listEnvironments, listOrganizations, probeGithubApp } from '../lib/testkube';
import type { Settings } from '../lib/types';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
    setTest({ kind: 'idle' });
  };

  const onSave = async () => {
    await saveSettings(settings);
    setSaved(true);
  };

  const onTest = async () => {
    setTest({ kind: 'testing' });
    try {
      const orgs = await listOrganizations(settings);
      if (orgs.length === 0) {
        setTest({ kind: 'error', message: 'No organizations are accessible with this token.' });
        return;
      }
      const org = orgs[0];
      const envs = await listEnvironments(settings, org.id);
      let github = '';
      if (settings.githubAppIntegration && envs.length > 0) {
        // Probe each environment so the user learns up front whether pull
        // request results will be available (needs the "run" role).
        const probes = await Promise.all(envs.map((e) => probeGithubApp(settings, org.id, e.id)));
        const available = probes.filter((p) => p.capability === 'available').length;
        const readOnly = probes.filter((p) => p.capability === 'read-only').length;
        if (probes.some((p) => p.capability === 'disabled')) {
          github = ' GitHub App: not enabled on this control plane.';
        } else if (available === 0 && readOnly > 0) {
          github = ' GitHub App: unavailable — the token needs the "run" role in an environment.';
        } else if (available > 0) {
          const connected = probes.reduce((n, p) => n + p.integrations.length, 0);
          github =
            ` GitHub App: available in ${available} of ${envs.length} environment(s)` +
            ` (${connected} connected repositor${connected === 1 ? 'y' : 'ies'})` +
            (readOnly > 0 ? `; ${readOnly} read-only.` : '.');
        } else {
          github = ' GitHub App: could not be checked.';
        }
      }
      setTest({
        kind: 'ok',
        message: `Connected to "${org.name}" — ${envs.length} environment(s) accessible.${github}`,
      });
    } catch (err) {
      setTest({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!loaded) {
    return <div className="card">Loading…</div>;
  }

  const canTest = isConfigured(settings);

  return (
    <div className="card">
      <h1>Testkube for GitHub</h1>
      <p className="subtitle">
        Connect to your Testkube Control Plane to surface TestWorkflows on the GitHub repositories
        they test.
      </p>

      <label className="field">
        <span className="field-label">API base URL</span>
        <input
          type="url"
          value={settings.apiBaseUrl}
          placeholder="https://api.testkube.io"
          onChange={(e) => update({ apiBaseUrl: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">Dashboard base URL</span>
        <input
          type="url"
          value={settings.dashboardBaseUrl}
          placeholder="https://app.testkube.io"
          onChange={(e) => update({ dashboardBaseUrl: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">Auto-refresh interval (seconds, 0 = off)</span>
        <input
          type="number"
          min={0}
          step={5}
          value={settings.refreshIntervalSeconds}
          placeholder="0"
          onChange={(e) => update({ refreshIntervalSeconds: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span className="field-label">Active on repositories (one wildcard per line)</span>
        <textarea
          rows={4}
          value={settings.repoFilters.join('\n')}
          placeholder={'kubeshop/*\n*/testkube*'}
          spellCheck={false}
          onChange={(e) => update({ repoFilters: e.target.value.split('\n') })}
        />
        <span className="field-hint">
          The panel appears automatically on repos that have Testkube workflows. Add patterns here to
          also show it (with a prompt to create a workflow) on repos that don't have one yet. Matched
          case-insensitively against <code>owner/repo</code>; <code>*</code> = any characters,{' '}
          <code>?</code> = a single character.
        </span>
      </label>

      <label className="field field-checkbox">
        <input
          type="checkbox"
          checked={settings.githubAppIntegration}
          onChange={(e) => update({ githubAppIntegration: e.target.checked })}
        />
        <span className="field-label">GitHub App integration (pull request results)</span>
        <span className="field-hint">
          Shows the repository's GitHub App connection and recent pull request runs in the repo
          sidebar, and a Testkube panel on pull request pages. Requires the API token to have the{' '}
          <code>run</code> role in the environment. Turn off to skip these requests.
        </span>
      </label>

      <label className="field">
        <span className="field-label">API token</span>
        <input
          type="password"
          value={settings.apiToken}
          placeholder="Personal or service API key"
          autoComplete="off"
          onChange={(e) => update({ apiToken: e.target.value })}
        />
      </label>

      <div className="actions">
        <button type="button" className="btn primary" onClick={() => void onSave()}>
          Save
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canTest || test.kind === 'testing'}
          onClick={() => void onTest()}
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {saved && <span className="hint ok">Saved</span>}
      </div>

      {test.kind === 'ok' && <div className="result ok">{test.message}</div>}
      {test.kind === 'error' && <div className="result error">{test.message}</div>}

      <p className="footnote">
        The API token is stored locally in this browser and is never synced. This is a
        proof-of-concept; treat the token as you would any credential.
      </p>
    </div>
  );
}
