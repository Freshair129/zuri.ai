#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateG0Preparation } from './validate.mjs';

const POLICY_FILE = fileURLToPath(new URL('../../docs/architecture/delivery-control/contracts/model-policy.json', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));

function jsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--publish') {
      result.publishRequested = true;
      continue;
    }
    if (!['--root-lineage-id', '--packet', '--preparation', '--dependency-proofs'].includes(flag)) {
      throw new Error('Unknown option ' + flag + '.');
    }
    const key = flag.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith('--') || result[key]) throw new Error('Missing or duplicate ' + flag + '.');
    result[key] = value;
  }
  return result;
}

function legacyPolicy(activePolicy) {
  if (activePolicy?.version === 3) return activePolicy;
  return activePolicy?.legacyV3Archive?.auditPolicy ?? null;
}

function dependencyProofs(file) {
  if (!file) return [];
  const rows = jsonFile(file);
  if (!Array.isArray(rows)) throw new Error('Dependency proofs must be an array.');
  return rows.map((proof) => {
    if (typeof proof?.bytesBase64 !== 'string') throw new Error('Dependency proof requires bytesBase64.');
    const bytes = Buffer.from(proof.bytesBase64, 'base64');
    if (bytes.toString('base64') !== proof.bytesBase64) throw new Error('Dependency proof bytesBase64 must be canonical.');
    return { artifactId: proof.artifactId, bytes, trustedContext: proof.trustedContext };
  });
}

function runCli() {
  let lineageId = null;
  try {
    const args = parseArgs(process.argv.slice(2));
    lineageId = args['root-lineage-id'] ?? null;
    if (args.publishRequested) {
      throw Object.assign(new Error('G0 publication is retired. This command is read-only; use preflight.mjs for task readiness.'), { verdict: 'LEGACY_PUBLICATION_RETIRED' });
    }
    if (!lineageId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(lineageId) || !args.packet || !args.preparation) {
      throw new Error('Usage: node prepare-g0.mjs --root-lineage-id <stable-id> --packet <json> --preparation <json> [--dependency-proofs <json>]');
    }
    const packet = jsonFile(args.packet);
    const preparation = jsonFile(args.preparation);
    if (preparation?.rootLineageId !== lineageId || packet?.lineageId !== lineageId) {
      throw new Error('CLI, legacy sidecar, and packet must bind the same root lineage.');
    }
    const activePolicy = jsonFile(POLICY_FILE);
    const policy = legacyPolicy(activePolicy);
    if (!policy) throw new Error('No archived v3 audit policy is available; legacy preparation cannot be structurally audited.');
    const result = validateG0Preparation(preparation, packet, policy, { dependencyProofs: dependencyProofs(args['dependency-proofs']) });
    const record = {
      verdict: result.ok ? 'LEGACY_STRUCTURAL_AUDIT_ONLY' : 'LEGACY_STRUCTURAL_AUDIT_REJECTED',
      rootLineageId: lineageId,
      archivalReadOnly: true,
      ...result,
      authorityGrant: false,
      dispatchAllowed: false,
      stateWritePerformed: false,
      note: 'This historical v1 packet and sidecar audit is not the v4 automatic task preflight and grants no authority.',
    };
    process.stdout.write(JSON.stringify(record, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const record = {
      verdict: error.verdict ?? 'LEGACY_STRUCTURAL_AUDIT_ERROR',
      message: error.message,
      rootLineageId: lineageId,
      archivalReadOnly: true,
      authorityGrant: false,
      dispatchAllowed: false,
      stateWritePerformed: false,
    };
    process.stdout.write(JSON.stringify(record, null, 2) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();
