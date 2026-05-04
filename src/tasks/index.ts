import { refactorTasks } from './refactors.ts';
import { conditionalTasks } from './conditionals.ts';
import { migrationTasks } from './migrations.ts';
import { trapTasks } from './traps.ts';
import type { TaskDef } from './types.ts';

export const allTasks: TaskDef[] = [
  ...refactorTasks,
  ...conditionalTasks,
  ...migrationTasks,
  ...trapTasks,
];

export type { TaskDef } from './types.ts';
