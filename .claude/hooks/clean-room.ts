// Claude Code hook (PreToolUse on Write, Edit and MultiEdit): refuses an edit that would put a blocked name into the
// repository. The list and the matching live in agents/lib/clean-room.ts, which the unit tests also run over every
// tracked file. Exit code 2 stops the edit and tells Claude why; anything else lets it through.
import { blockedNames, textOfEdit } from '../../agents/lib/clean-room.ts';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let input: unknown = null;
try {
  input = (JSON.parse(raw) as { tool_input?: unknown }).tool_input;
} catch {
  process.exit(0);
}

const found = blockedNames(textOfEdit(input));
if (found > 0) {
  process.stderr.write(
    `Clean room: this edit names ${found === 1 ? 'a project' : `${found} projects`} that must never appear in this repository ` +
      '(see agents/lib/clean-room.ts). Everything here is original work. Write it without the reference.\n',
  );
  process.exit(2);
}
process.exit(0);
