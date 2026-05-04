import type { TaskDef, TaskEvaluation } from '../tasks/types.ts';
import type { World } from '../env/world.ts';
import type { WorldSnapshot } from '../env/types.ts';

export function evaluateTask(
  task: TaskDef,
  world: World,
  initialSnapshot: WorldSnapshot,
): TaskEvaluation {
  return task.evaluate(world, initialSnapshot);
}
