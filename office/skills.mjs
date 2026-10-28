export const skillNames = [
  'ai-pm-lead-discovery',
  'ai-pm-business-intelligence',
  'ai-pm-campaign-readiness',
];

// A requested skill is not evidence of execution. Only a completed, officially
// parsed file-read action of its installed SKILL.md is reported as observed.
export function observedSkill(item, skills) {
  if (item?.type !== 'commandExecution' || item.status !== 'completed' || item.exitCode !== 0)
    return null;
  const normalize = (value) => String(value).replaceAll('\\', '/').toLowerCase();
  for (const action of item.commandActions ?? []) {
    if (action.type === 'unknown') {
      // Windows currently reports literal Get-Content calls as "unknown".
      // Accept only a single literal read command; never infer from a mention,
      // a prompt, arbitrary shell syntax, a pipeline, or an unsuccessful call.
      const command = action.command?.trim() || '';
      if (/[;|&<>$`\r\n]/.test(command)) continue;
      const tokens = command.match(/'[^']*'|"[^"]*"|[^\s'"]+/g) || [];
      if (tokens.join(' ') !== command.replace(/\s+/g, ' ')) continue;
      if (tokens.shift()?.toLowerCase() !== 'get-content') continue;
      const paths = [];
      let valid = true;
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index].replace(/^(['"])(.*)\1$/, '$2');
        if (['-raw', '-literalpath', '-path'].includes(token.toLowerCase())) continue;
        if (token.toLowerCase() === '-totalcount' && /^\d+$/.test(tokens[index + 1] || '')) {
          index++;
          continue;
        }
        if (/^[a-z]:[\\/]/i.test(token)) paths.push(token);
        else valid = false;
      }
      if (!valid || paths.length !== 1) continue;
      const match = skills.find((skill) => normalize(skill.path) === normalize(paths[0]));
      if (match)
        return {
          name: match.name,
          evidence: 'completed_literal_get_content',
          itemId: item.id,
          path: paths[0],
        };
      continue;
    }
    if (action.type !== 'read') continue;
    const match = skills.find((skill) => normalize(skill.path) === normalize(action.path));
    if (match)
      return { name: match.name, evidence: 'skill_file_read', itemId: item.id, path: action.path };
  }
  return null;
}
