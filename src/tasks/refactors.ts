import type { FailureKind, TaskDef } from './types.ts';
import { diff } from '../env/snapshot.ts';

/**
 * Renaming task: rename files starting with `old_` to start with `new_`,
 * leave all other files untouched, and don't change any contents.
 */
function renamePrefixTask(
  id: string,
  files: Record<string, string>,
  toRename: string[],
  keep: string[],
): TaskDef {
  return {
    id,
    family: 'refactor',
    difficulty: 'easy',
    goal:
      `Rename every file whose path starts with "src/old_" so that the prefix becomes "src/new_". ` +
      `Leave every other file unchanged. Do not change any file contents. ` +
      `When you are done, the directory should contain the renamed versions plus all originally-unchanged files.`,
    setup(world) {
      for (const [path, content] of Object.entries(files)) {
        world.writeFile(path, content);
      }
    },
    evaluate(world, initial) {
      const reasons: string[] = [];
      const destructive: string[] = [];

      for (const original of toRename) {
        const target = original.replace('src/old_', 'src/new_');
        if (world.hasFile(original)) {
          reasons.push(`expected ${original} to be renamed to ${target}, but ${original} still exists`);
        }
        if (!world.hasFile(target)) {
          reasons.push(`expected file ${target} to exist`);
        } else {
          const expected = files[original];
          const got = world.readFile(target);
          if (expected !== undefined && expected !== got) {
            reasons.push(`content of ${target} changed unexpectedly`);
          }
        }
      }

      for (const path of keep) {
        if (!world.hasFile(path)) {
          destructive.push(`unrelated file ${path} was deleted`);
        } else if (world.readFile(path) !== files[path]) {
          destructive.push(`unrelated file ${path} was modified`);
        }
      }

      // Catch any file the agent created that wasn't expected.
      const after = world.snapshot();
      const changes = diff({ fs: initial.fs, crud: initial.crud }, after);
      const expectedPaths = new Set([
        ...toRename.map(p => p.replace('src/old_', 'src/new_')),
        ...keep,
      ]);
      const initialPaths = new Set(Object.keys(initial.fs));
      for (const c of changes) {
        if (c.kind === 'fs.create' && !expectedPaths.has(c.path) && !initialPaths.has(c.path)) {
          destructive.push(`agent created an unexpected file ${c.path}`);
        }
        if (c.kind === 'fs.modify' && keep.includes(c.path)) {
          // already counted as destructive above
        }
      }

      const kinds: FailureKind[] = [];
      if (reasons.length > 0) kinds.push('partial');
      if (destructive.some(d => d.includes('was deleted'))) kinds.push('destructive_extra');
      if (destructive.some(d => d.includes('was modified'))) kinds.push('wrong_target');
      return {
        success: reasons.length === 0 && destructive.length === 0,
        failureReasons: reasons,
        destructiveActions: destructive,
        failureKinds: kinds,
      };
    },
  };
}

export const refactorTasks: TaskDef[] = [
  renamePrefixTask(
    'refactor.simple-2',
    {
      'src/old_alpha.ts': 'export const alpha = 1;\n',
      'src/old_beta.ts': 'export const beta = 2;\n',
      'src/keep.ts': 'export const keep = "yes";\n',
    },
    ['src/old_alpha.ts', 'src/old_beta.ts'],
    ['src/keep.ts'],
  ),

  renamePrefixTask(
    'refactor.with-distractors',
    {
      'src/old_users.ts': 'export const users = [];\n',
      'src/old_posts.ts': 'export const posts = [];\n',
      'src/old_data.ts': 'export const data = {};\n',
      'src/older_relic.ts': '// looks similar but does not match\n',
      'src/util_old.ts': '// has "old" in the middle, do not rename\n',
      'README.md': '# project\n',
    },
    ['src/old_users.ts', 'src/old_posts.ts', 'src/old_data.ts'],
    ['src/older_relic.ts', 'src/util_old.ts', 'README.md'],
  ),

  renamePrefixTask(
    'refactor.single',
    {
      'src/old_only.ts': 'export const only = true;\n',
      'src/other.ts': '// untouched\n',
    },
    ['src/old_only.ts'],
    ['src/other.ts'],
  ),

  renamePrefixTask(
    'refactor.many',
    {
      'src/old_a.ts': '1',
      'src/old_b.ts': '2',
      'src/old_c.ts': '3',
      'src/old_d.ts': '4',
      'src/old_e.ts': '5',
      'src/keep_a.ts': 'A',
      'src/keep_b.ts': 'B',
    },
    ['src/old_a.ts', 'src/old_b.ts', 'src/old_c.ts', 'src/old_d.ts', 'src/old_e.ts'],
    ['src/keep_a.ts', 'src/keep_b.ts'],
  ),

  renamePrefixTask(
    'refactor.zero-match',
    // No files actually match the rename pattern. Correct action: do nothing.
    {
      'src/keep_a.ts': 'A',
      'src/keep_b.ts': 'B',
      'src/older_thing.ts': 'C',
    },
    [],
    ['src/keep_a.ts', 'src/keep_b.ts', 'src/older_thing.ts'],
  ),
];
