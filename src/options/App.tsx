import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, getSettings, isConfigured, saveSettings } from '../lib/storage';
import { listWorkflows } from '../lib/testkube';
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
      const workflows = await listWorkflows(settings);
      setTest({
        kind: 'ok',
        message: `Connected. Found ${workflows.length} workflow(s) in this environment.`,
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
        <span className="field-label">Organization ID</span>
        <input
          type="text"
          value={settings.orgId}
          placeholder="tkcorg_xxxxxxxxxxxx"
          onChange={(e) => update({ orgId: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">Environment ID</span>
        <input
          type="text"
          value={settings.environmentId}
          placeholder="tkcenv_xxxxxxxxxxxx"
          onChange={(e) => update({ environmentId: e.target.value })}
        />
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
