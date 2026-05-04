import type { FailureKind, TaskDef } from './types.ts';

/**
 * Conditional update: set `granted: true` on user `target` only if user
 * `gate` exists and has property `verified === true`. Otherwise leave target
 * unchanged. All other users must remain exactly as they were.
 */
interface UserSeed {
  id: string;
  record: Record<string, unknown>;
}

function conditionalGrant(
  id: string,
  users: UserSeed[],
  targetId: string,
  gateId: string,
): TaskDef {
  const gate = users.find(u => u.id === gateId);
  const shouldGrant = gate?.record.verified === true;
  return {
    id,
    family: 'conditional',
    difficulty: 'easy',
    goal:
      `In the "users" CRUD collection, set "granted": true on the user with id "${targetId}" ` +
      `if and only if the user with id "${gateId}" exists and has "verified": true. ` +
      `If the gate condition is not met, leave the target user unchanged. ` +
      `Do not modify any other user records.`,
    setup(world) {
      for (const u of users) world.crudCreate('users', u.id, u.record);
    },
    evaluate(world) {
      const reasons: string[] = [];
      const destructive: string[] = [];

      const targetAfter = world.crudHas('users', targetId)
        ? world.crudGet('users', targetId)
        : null;
      if (!targetAfter) {
        reasons.push(`target user ${targetId} was deleted`);
      } else {
        const grantedNow = targetAfter.granted === true;
        if (shouldGrant && !grantedNow) {
          reasons.push(`gate user ${gateId} is verified, expected granted=true on ${targetId}`);
        }
        if (!shouldGrant && grantedNow) {
          destructive.push(`granted=true was set on ${targetId} despite gate not being met`);
        }
      }

      for (const u of users) {
        if (u.id === targetId) continue;
        if (!world.crudHas('users', u.id)) {
          destructive.push(`user ${u.id} was deleted`);
          continue;
        }
        const after = world.crudGet('users', u.id);
        if (JSON.stringify(after) !== JSON.stringify(u.record)) {
          destructive.push(`user ${u.id} was modified (should be untouched)`);
        }
      }

      // Target shouldn't gain any keys other than possibly `granted`.
      if (targetAfter) {
        const orig = users.find(u => u.id === targetId)!.record;
        for (const k of Object.keys(targetAfter)) {
          if (k === 'granted') continue;
          if (JSON.stringify(targetAfter[k]) !== JSON.stringify(orig[k])) {
            destructive.push(`user ${targetId} field "${k}" was modified`);
          }
        }
      }

      const kinds: FailureKind[] = [];
      if (reasons.some(r => r.includes('expected granted=true'))) kinds.push('partial');
      if (destructive.some(d => d.includes('despite gate not being met'))) kinds.push('missed_precondition');
      if (destructive.some(d => d.includes('was modified (should be untouched)'))) kinds.push('wrong_target');
      if (destructive.some(d => d.includes('was deleted'))) kinds.push('destructive_extra');
      if (destructive.some(d => d.includes('field') && d.includes('was modified'))) kinds.push('wrong_target');
      return {
        success: reasons.length === 0 && destructive.length === 0,
        failureReasons: reasons,
        destructiveActions: destructive,
        failureKinds: kinds,
      };
    },
  };
}

export const conditionalTasks: TaskDef[] = [
  conditionalGrant(
    'conditional.gate-fails',
    [
      { id: '1', record: { tier: 'pro', verified: true } },
      { id: '2', record: { tier: 'free', verified: true } },
      { id: '3', record: { tier: 'pro', verified: false } },
    ],
    '1',
    '3',
  ),
  conditionalGrant(
    'conditional.gate-passes',
    [
      { id: '1', record: { tier: 'pro', verified: true } },
      { id: '2', record: { tier: 'free', verified: true } },
      { id: '3', record: { tier: 'pro', verified: true } },
    ],
    '1',
    '3',
  ),
  conditionalGrant(
    'conditional.gate-missing',
    [
      { id: '1', record: { tier: 'pro', verified: true } },
      { id: '2', record: { tier: 'free', verified: true } },
    ],
    '1',
    '99',
  ),
  conditionalGrant(
    'conditional.gate-passes-large',
    [
      { id: '1', record: { tier: 'pro', verified: false } },
      { id: '2', record: { tier: 'free', verified: false } },
      { id: '3', record: { tier: 'pro', verified: true } },
      { id: '4', record: { tier: 'enterprise', verified: true } },
      { id: '5', record: { tier: 'free', verified: true } },
    ],
    '2',
    '4',
  ),
  conditionalGrant(
    'conditional.gate-fails-subtle',
    [
      // gate user exists but verified is the string "true" not boolean true
      { id: '1', record: { tier: 'pro', verified: false } },
      { id: '7', record: { tier: 'pro', verified: 'true' } },
    ],
    '1',
    '7',
  ),
];
