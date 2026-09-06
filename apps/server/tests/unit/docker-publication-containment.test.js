import { workspacePath } from '../../scripts/workspace-path.mjs'
// ADR-062: private-source migration must not publish through the legacy public image.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('Docker publication containment', () => {
  it('retains build validation without registry credentials or publication on any trigger', () => {
    const text = readFileSync(workspacePath(process.cwd(), '.github/workflows/docker-image.yml'), 'utf8');
    const workflow = parse(text);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const builds = [];
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions ?? workflow.permissions).toEqual({ contents: 'read' });
      for (const step of job.steps) {
        expect(step.uses ?? '').not.toMatch(/login-action|metadata-action/);
        expect(step.run ?? '').not.toMatch(/\b(?:push|login)\b/);
        if (step.uses?.startsWith('docker/build-push-action@')) builds.push(step);
      }
    }
    expect(builds).toHaveLength(1);
    expect(builds[0].with.push).toBe(false);
    expect(builds[0].with.outputs).toBeUndefined(); // registry exporters also publish
    expect(builds[0].with['cache-to']).toBe('type=gha,mode=max');
    expect(text).not.toMatch(/secrets\./);
    expect(workflow.jobs['compose-config'].steps.some(step =>
      step.run?.includes('docker compose config --quiet'))).toBe(true);
  });
});
