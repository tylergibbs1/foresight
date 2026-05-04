import type { World } from '../env/world.ts';
import type { WorldSnapshot } from '../env/types.ts';

export type TaskFamily =
  | 'refactor'
  | 'conditional'
  | 'migration'
  | 'trap_orphan'
  | 'trap_overwrite'
  | 'trap_glob'
  | 'trap_chain';

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Categorizes WHY a run failed so that aggregated metrics show what kind of
 * mistake the scaffold prevents (the whole point of the experiment).
 *
 * One run can produce multiple kinds — e.g. it can both leave an orphan AND
 * skip a precondition.
 */
export type FailureKind =
  | 'wrong_target'         // modified the wrong record / file
  | 'missed_precondition'  // wrote without verifying a required condition
  | 'order_violation'      // did steps in wrong order
  | 'read_skipped'         // wrote without reading first; clobbered content
  | 'destructive_extra'    // hit something the goal didn't ask to touch
  | 'orphan_left'          // dangling reference / dependent record stranded
  | 'partial'              // didn't finish the goal
  | 'other';

export interface TaskEvaluation {
  success: boolean;
  failureReasons: string[];
  destructiveActions: string[];
  /** Kinds of failure observed. Empty when success. */
  failureKinds: FailureKind[];
}

export interface TaskDef {
  id: string;
  family: TaskFamily;
  difficulty: Difficulty;
  /** Goal handed to the agent verbatim. */
  goal: string;
  /** Initialise the world to this task's starting state. */
  setup(world: World): void;
  evaluate(world: World, initialSnapshot: WorldSnapshot): TaskEvaluation;
}
