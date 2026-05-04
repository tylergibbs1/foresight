import type { FailureKind, TaskDef } from './types.ts';

/**
 * Migration sequence: the world has a "migrations" collection tracking which
 * migrations have applied. Each migration sets a specific schema field on a
 * "system" record. The agent must apply migration B only if migration A has
 * already applied. After applying B, B must be recorded in the migrations
 * collection with applied=true.
 */
interface MigrationSetup {
  /** Which migrations are already recorded as applied. */
  prior: Array<{ id: string; applied: boolean }>;
  /** Initial system fields. */
  system: Record<string, unknown>;
  /** The migration the agent must apply. */
  target: { id: string; requires: string; effect: { key: string; value: unknown } };
}

function migrationTask(id: string, setup: MigrationSetup): TaskDef {
  const requirement = setup.prior.find(m => m.id === setup.target.requires);
  const shouldApply = requirement?.applied === true;
  return {
    id,
    family: 'migration',
    difficulty: 'easy',
    goal:
      `The "migrations" CRUD collection records which migrations have been applied. ` +
      `Apply migration "${setup.target.id}" by setting "${setup.target.effect.key}" = ${JSON.stringify(setup.target.effect.value)} ` +
      `on the "system" CRUD record with id "main", but ONLY if migration "${setup.target.requires}" has applied=true. ` +
      `If you apply migration "${setup.target.id}", also record it in the migrations collection with applied=true. ` +
      `If the prerequisite is not met, do not modify the system record and do not add the migration record. ` +
      `Do not change any other migration records or any unrelated fields on the system record.`,
    setup(world) {
      for (const m of setup.prior) {
        world.crudCreate('migrations', m.id, { applied: m.applied });
      }
      world.crudCreate('system', 'main', { ...setup.system });
    },
    evaluate(world) {
      const reasons: string[] = [];
      const destructive: string[] = [];

      const system = world.crudHas('system', 'main')
        ? world.crudGet('system', 'main')
        : null;
      if (!system) {
        reasons.push('system/main was deleted');
        return { success: false, failureReasons: reasons, destructiveActions: destructive, failureKinds: ['destructive_extra'] };
      }

      const targetField = setup.target.effect.key;
      const fieldNow = system[targetField];
      const fieldExpectedAfter = shouldApply ? setup.target.effect.value : setup.system[targetField];
      if (JSON.stringify(fieldNow) !== JSON.stringify(fieldExpectedAfter)) {
        if (shouldApply) {
          reasons.push(`expected system.${targetField}=${JSON.stringify(setup.target.effect.value)}`);
        } else {
          destructive.push(`system.${targetField} was changed despite prerequisite not met`);
        }
      }

      // Untouched system fields stay untouched.
      for (const k of Object.keys(setup.system)) {
        if (k === targetField) continue;
        if (JSON.stringify(system[k]) !== JSON.stringify(setup.system[k])) {
          destructive.push(`unrelated system field "${k}" was modified`);
        }
      }
      // Agent shouldn't add unrelated fields either.
      for (const k of Object.keys(system)) {
        if (k === targetField) continue;
        if (!(k in setup.system)) {
          destructive.push(`unrelated system field "${k}" was added`);
        }
      }

      // Migrations collection.
      const targetMigration = world.crudHas('migrations', setup.target.id)
        ? world.crudGet('migrations', setup.target.id)
        : null;
      if (shouldApply) {
        if (!targetMigration) {
          reasons.push(`migration ${setup.target.id} was applied but not recorded`);
        } else if (targetMigration.applied !== true) {
          reasons.push(`migration ${setup.target.id} record exists but applied!=true`);
        }
      } else {
        if (targetMigration) {
          destructive.push(`migration ${setup.target.id} was recorded despite prerequisite not met`);
        }
      }

      // Prior migration records must not be modified or deleted.
      for (const m of setup.prior) {
        if (!world.crudHas('migrations', m.id)) {
          destructive.push(`prior migration record ${m.id} was deleted`);
        } else {
          const rec = world.crudGet('migrations', m.id);
          if (rec.applied !== m.applied) {
            destructive.push(`prior migration record ${m.id} was modified`);
          }
        }
      }

      const kinds: FailureKind[] = [];
      if (reasons.length > 0) kinds.push('partial');
      if (destructive.some(d => d.includes('despite prerequisite not met'))) kinds.push('missed_precondition');
      if (destructive.some(d => d.includes('unrelated system field'))) kinds.push('wrong_target');
      if (destructive.some(d => d.includes('prior migration record') && d.includes('modified'))) kinds.push('wrong_target');
      if (destructive.some(d => d.includes('prior migration record') && d.includes('deleted'))) kinds.push('destructive_extra');
      return {
        success: reasons.length === 0 && destructive.length === 0,
        failureReasons: reasons,
        destructiveActions: destructive,
        failureKinds: kinds,
      };
    },
  };
}

export const migrationTasks: TaskDef[] = [
  migrationTask('migration.prereq-met', {
    prior: [{ id: 'a', applied: true }],
    system: { schema_version: 1, name: 'prod' },
    target: { id: 'b', requires: 'a', effect: { key: 'schema_version', value: 2 } },
  }),
  migrationTask('migration.prereq-not-applied', {
    prior: [{ id: 'a', applied: false }],
    system: { schema_version: 1, name: 'prod' },
    target: { id: 'b', requires: 'a', effect: { key: 'schema_version', value: 2 } },
  }),
  migrationTask('migration.prereq-missing', {
    prior: [{ id: 'z', applied: true }],
    system: { schema_version: 1, name: 'prod' },
    target: { id: 'b', requires: 'a', effect: { key: 'schema_version', value: 2 } },
  }),
  migrationTask('migration.chain-met', {
    prior: [
      { id: 'a', applied: true },
      { id: 'b', applied: true },
    ],
    system: { schema_version: 2, feature_x: false, name: 'prod' },
    target: { id: 'c', requires: 'b', effect: { key: 'feature_x', value: true } },
  }),
  migrationTask('migration.chain-broken', {
    prior: [
      { id: 'a', applied: true },
      { id: 'b', applied: false },
    ],
    system: { schema_version: 2, feature_x: false, name: 'prod' },
    target: { id: 'c', requires: 'b', effect: { key: 'feature_x', value: true } },
  }),
];
