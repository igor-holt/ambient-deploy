#!/usr/bin/env node
import { readFileSync } from 'fs';

const input = process.argv[2] || 'deploy.jsonl';
const lines = readFileSync(input, 'utf-8').trim().split('\n');

let stepNum = 0;
for (const line of lines) {
  const legacy = JSON.parse(line);
  const a2a = {
    a2a: "0.3",
    fleet: "ambient-deploy",
    lane: legacy.phase ? `L-${legacy.phase}` : "L0",
    step: legacy.step ? String(legacy.step) : `S-${String(++stepNum).padStart(3, '0')}`,
    op: legacy.request_type === 'deploy' ? 'shell' : 'shell',
    desc: legacy.title || legacy.description?.slice(0, 80),
  };
  if (legacy.depends_on) a2a.depends_on = legacy.depends_on;
  if (legacy.requires_approval) a2a.gate = 'HITL:publish';
  console.log(JSON.stringify(a2a));
}
