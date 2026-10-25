import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../.claude/hooks/merge-guard.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const bash = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
const blocked = (command) => decide(bash(command)).block;

test('documented merge command passes (3-line and 1-line, quoted or bare sha)', () => {
  assert.equal(blocked(`gh api --method PUT repos/nannantown/figma-navi-video/pulls/212/merge \\\n  -f merge_method=squash -f sha="${SHA}" \\\n  --jq '{merged,message,sha}'`), false);
  assert.equal(blocked(`gh api --method PUT repos/nannantown/figma-navi-video/pulls/212/merge -f merge_method=squash -f sha=${SHA} --jq '{merged,message,sha}'`), false);
});

test('loopholes and other merge shapes are blocked', () => {
  const bad = [
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f 'x=/merge -f merge_method=squash -f sha=' --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1 -f "a=b" /merge -f merge_method=squash -f sha="${SHA}" --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=squash --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=merge -f sha="${SHA}" --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=rebase -f sha="${SHA}" --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=me''rge -f sha="${SHA}" --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=squash -f sha="" --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/figma-navi-video/pulls/$PR_NUMBER/merge -f merge_method=squash -f sha="${SHA}" --jq '{merged,message,sha}'`,
    `gh api --method PUT repos/nannantown/coffee-daily-video/pulls/1/merge -f merge_method=squash -f sha="${SHA}" --jq '{merged,message,sha}'`,
    `gh api --method PUT \\\n repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=merge --jq '{merged,message,sha}'`,
    `true && gh api --method PUT repos/nannantown/figma-navi-video/pulls/1/merge -f merge_method=squash -f sha="${SHA}" --jq '{merged,message,sha}'`,
  ];
  for (const c of bad) assert.equal(blocked(c), true, c);
});

test('routine reads, PR creation and non-Bash tools are left to the normal flow', () => {
  const ok = [
    `gh api --method GET repos/nannantown/figma-navi-video/pulls/212 --jq '{merged,merge_commit_sha,head:.head.sha}'`,
    `gh api --method GET repos/nannantown/figma-navi-video/pulls/212 \\\n  -H 'Accept: application/vnd.github.diff'`,
    `gh api --method POST repos/nannantown/figma-navi-video/pulls \\\n  -f base=main -f head="$BRANCH" \\\n  -f body="Review the complete diff before merging." \\\n  --jq '{number,html_url,head_sha:.head.sha}'`,
    `node scripts/deliver-jev.mjs --pr=212 --head=${SHA}`,
    `git push -u origin "$BRANCH"`,
  ];
  for (const c of ok) assert.equal(blocked(c), false, c);
  assert.equal(decide(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'x' } })).block, false);
});

test('unreadable input blocks only when it looks like a merge', () => {
  assert.equal(decide('not json PUT pulls/1/merge').block, true);
  assert.equal(decide('not json').block, false);
});
