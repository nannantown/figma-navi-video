#!/usr/bin/env node
// PreToolUse guard for the morning routine's merge (owner decision A, 2026-10-23).
// The allow rule in ../settings.json approves `gh api --method PUT …/pulls/*/merge …`,
// but its `*` spans spaces and quotes. This hook blocks (exit 2) every Bash command that
// looks like a PR merge unless it is exactly the documented command:
//   gh api --method PUT repos/nannantown/figma-navi-video/pulls/<digits>/merge \
//     -f merge_method=squash -f sha="<40 hex>" \
//     --jq '{merged,message,sha}'
// Anything else exits 0 and goes through the normal permission flow.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEP = String.raw`(?: \\\n[ \t]*| )`;
export const STRICT = new RegExp(
  '^gh api --method PUT repos/nannantown/figma-navi-video/pulls/[0-9]+/merge' + SEP +
  `-f merge_method=squash -f sha=(?:"[0-9a-f]{40}"|[0-9a-f]{40})` + SEP +
  String.raw`--jq '\{merged,message,sha\}'$`,
);

// Superset of what the allow rule can approve: a PUT that names pulls/ and merge.
export function looksLikeMerge(text) {
  const flat = text.replace(/\\\n/g, ' ');
  return /pulls\//.test(flat) && /\bput\b/i.test(flat) && /merge/i.test(flat);
}

export function decide(raw) {
  let command;
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Bash') return { block: false };
    command = String(input.tool_input?.command ?? '');
  } catch {
    // Unreadable input: block only if it could be a merge (fail closed for merges).
    return looksLikeMerge(raw) ? { block: true, reason: 'merge-guard: could not read the hook input' } : { block: false };
  }
  if (!looksLikeMerge(command)) return { block: false };
  if (STRICT.test(command.trim())) return { block: false };
  return {
    block: true,
    reason:
      'merge-guard: only the documented squash merge is allowed here — ' +
      "gh api --method PUT repos/nannantown/figma-navi-video/pulls/<number>/merge -f merge_method=squash -f sha=\"<40-hex SHA>\" --jq '{merged,message,sha}' " +
      '(literal values, no variables, one command per call). Stop and report; do not rewrite or retry (docs/routine-merge-miss.md).',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { block, reason } = decide(readFileSync(0, 'utf8'));
  if (block) {
    process.stderr.write(reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}
