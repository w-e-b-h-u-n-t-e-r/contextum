import { ROLES, SKILLS } from "../core/constants.js";
import { writeFile, type WriteResult } from "../core/files.js";
import { log, reportWrites } from "../core/log.js";
import { contextOrientationSkill, rolePrompt } from "../core/templates.js";

export interface SkillsOptions {
  root: string;
  force?: boolean;
  quiet?: boolean;
}

export async function skills(opts: SkillsOptions): Promise<WriteResult[]> {
  const { root, force } = opts;
  if (!opts.quiet) log.title("contextum skills");

  const results: WriteResult[] = [];

  for (const skill of SKILLS) {
    results.push(
      await writeFile(skill.path, contextOrientationSkill(), { root, force }),
    );
  }

  for (const role of ROLES) {
    results.push(await writeFile(role.path, rolePrompt(role.name), { root, force }));
  }

  if (!opts.quiet) reportWrites(results);
  return results;
}
