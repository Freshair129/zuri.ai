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
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name === 'compact-package') {
        // ADR-115 Task1: the explicit manual candidate job may read prepared
        // same-repository artifacts. This grants no package/registry writes.
        expect(job.if).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.compact_package }}");
        expect(workflow.on.workflow_dispatch.inputs.compact_package.default).toBe(false);
        expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
        expect(job.steps.find(step => step.uses?.startsWith('actions/download-artifact@')).with['github-token']).toBe('${{ github.token }}');
      } else if (name === 'compact-core') {
        // ADR-115 Task7: only the explicit manual qualification job may read
        // its same-run candidate. No token, foreign run or registry authority.
        expect(job.if).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.compact_package && inputs.compact_qualify_core }}");
        expect(job.needs).toBe('compact-package');
        expect(workflow.on.workflow_dispatch.inputs.compact_package.default).toBe(false);
        expect(workflow.on.workflow_dispatch.inputs.compact_qualify_core.default).toBe(false);
        expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
        const download = job.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
        expect(download.with).toEqual({
          name: 'compact-candidate-${{ github.sha }}',
          path: '${{ runner.temp }}/compact-package',
        });
      } else {
        expect(job.permissions ?? workflow.permissions).toEqual({ contents: 'read' });
      }
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
