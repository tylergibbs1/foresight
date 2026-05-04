import { tool } from 'ai';
import { z } from 'zod';
import type { World } from './world.ts';

/**
 * Tool input schemas, defined once and reused for both AI SDK tool registration
 * and direct execution by the scaffold's executor.
 *
 * `record_json` / `patch_json` are JSON-encoded strings instead of `z.record()`
 * because OpenAI's strict-mode structured outputs rejects open-shape records.
 */
export const toolSchemas = {
  read_file: z.object({ path: z.string() }),
  write_file: z.object({ path: z.string(), content: z.string() }),
  delete_file: z.object({ path: z.string() }),
  move_file: z.object({ from: z.string(), to: z.string() }),
  list_files: z.object({ prefix: z.string().nullable() }),
  crud_list: z.object({ collection: z.string() }),
  crud_get: z.object({ collection: z.string(), id: z.string() }),
  crud_create: z.object({
    collection: z.string(),
    id: z.string(),
    record_json: z.string().describe('JSON-encoded object. Example: {"verified":true}'),
  }),
  crud_update: z.object({
    collection: z.string(),
    id: z.string(),
    patch_json: z.string().describe('JSON-encoded partial. Example: {"granted":true}'),
  }),
  crud_delete: z.object({ collection: z.string(), id: z.string() }),

  /**
   * Sentinel "tool" the proposer can emit to declare that no action should be
   * taken this turn. Modeled after AI SDK 6's `hasToolCall('finalAnswer')`
   * stop pattern, adapted to our custom scaffold orchestrator. The scaffold
   * detects `noop` after the scorer picks it and exits the loop without
   * mutating the world.
   */
  noop: z.object({
    reason: z
      .string()
      .describe(
        'Required justification for taking no action. Cite specific state observations, e.g. "migration_specs/D requires C, but migrations/C does not exist; applying D would violate the precondition." Vague reasons like "task is done" are insufficient.',
      ),
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;

export const toolDescriptions: Record<ToolName, string> = {
  read_file: 'Read the contents of a file at the given path.',
  write_file: 'Create a new file or overwrite an existing one with the given content.',
  delete_file: 'Delete a file. Errors if it does not exist.',
  move_file: 'Rename or move a file. Errors if source missing or destination exists.',
  list_files: 'List all file paths, optionally filtered by a prefix.',
  crud_list: 'List all records in a CRUD collection, returning {id, record} entries.',
  crud_get: 'Get a single record from a CRUD collection by id.',
  crud_create: 'Create a new record. record_json must be a JSON-encoded object.',
  crud_update:
    'Patch an existing record. patch_json is a JSON-encoded partial object; keys present overwrite, keys absent are kept.',
  crud_delete: 'Delete a record from a CRUD collection.',
  noop:
    'Declare that no action should be taken this turn (e.g. a precondition is not met, or the goal is already satisfied). Requires a `reason` field that cites specific state observations. The scaffold will exit after running this; do not pick noop just to delay — pick it only when the correct outcome is "do nothing."',
};

type Executor = (world: World, args: any) => Promise<unknown>;

export const executors: Record<ToolName, Executor> = {
  read_file: async (w, { path }) => w.readFile(path),
  write_file: async (w, { path, content }) => {
    w.writeFile(path, content);
    return { ok: true };
  },
  delete_file: async (w, { path }) => {
    w.deleteFile(path);
    return { ok: true };
  },
  move_file: async (w, { from, to }) => {
    w.moveFile(from, to);
    return { ok: true };
  },
  list_files: async (w, { prefix }) => w.listFiles(prefix ?? undefined),
  crud_list: async (w, { collection }) => w.crudList(collection),
  crud_get: async (w, { collection, id }) => w.crudGet(collection, id),
  crud_create: async (w, { collection, id, record_json }) => {
    const record = JSON.parse(record_json) as Record<string, unknown>;
    w.crudCreate(collection, id, record);
    return { ok: true };
  },
  crud_update: async (w, { collection, id, patch_json }) => {
    const patch = JSON.parse(patch_json) as Record<string, unknown>;
    w.crudUpdate(collection, id, patch);
    return { ok: true };
  },
  crud_delete: async (w, { collection, id }) => {
    w.crudDelete(collection, id);
    return { ok: true };
  },
  // noop never reaches the executor; the scaffold short-circuits before this.
  // Provide a definition so the executors map satisfies the schema map.
  noop: async (_w, { reason }) => ({ ok: true, noop: true, reason }),
};

export function makeTools(world: World) {
  return {
    read_file: tool({
      description: toolDescriptions.read_file,
      inputSchema: toolSchemas.read_file,
      execute: async (args) => executors.read_file(world, args),
    }),
    write_file: tool({
      description: toolDescriptions.write_file,
      inputSchema: toolSchemas.write_file,
      execute: async (args) => executors.write_file(world, args),
    }),
    delete_file: tool({
      description: toolDescriptions.delete_file,
      inputSchema: toolSchemas.delete_file,
      execute: async (args) => executors.delete_file(world, args),
    }),
    move_file: tool({
      description: toolDescriptions.move_file,
      inputSchema: toolSchemas.move_file,
      execute: async (args) => executors.move_file(world, args),
    }),
    list_files: tool({
      description: toolDescriptions.list_files,
      inputSchema: toolSchemas.list_files,
      execute: async (args) => executors.list_files(world, args),
    }),
    crud_list: tool({
      description: toolDescriptions.crud_list,
      inputSchema: toolSchemas.crud_list,
      execute: async (args) => executors.crud_list(world, args),
    }),
    crud_get: tool({
      description: toolDescriptions.crud_get,
      inputSchema: toolSchemas.crud_get,
      execute: async (args) => executors.crud_get(world, args),
    }),
    crud_create: tool({
      description: toolDescriptions.crud_create,
      inputSchema: toolSchemas.crud_create,
      execute: async (args) => executors.crud_create(world, args),
    }),
    crud_update: tool({
      description: toolDescriptions.crud_update,
      inputSchema: toolSchemas.crud_update,
      execute: async (args) => executors.crud_update(world, args),
    }),
    crud_delete: tool({
      description: toolDescriptions.crud_delete,
      inputSchema: toolSchemas.crud_delete,
      execute: async (args) => executors.crud_delete(world, args),
    }),
    // noop is only included for the proposer's catalog; baselines do not get it.
  };
}

export function toolCatalog(): Array<{ name: string; description: string; args: string }> {
  return [
    { name: 'read_file', description: toolDescriptions.read_file, args: '{ path: string }' },
    { name: 'write_file', description: toolDescriptions.write_file, args: '{ path: string, content: string }' },
    { name: 'delete_file', description: toolDescriptions.delete_file, args: '{ path: string }' },
    { name: 'move_file', description: toolDescriptions.move_file, args: '{ from: string, to: string }' },
    { name: 'list_files', description: toolDescriptions.list_files, args: '{ prefix: string | null }' },
    { name: 'crud_list', description: toolDescriptions.crud_list, args: '{ collection: string }' },
    { name: 'crud_get', description: toolDescriptions.crud_get, args: '{ collection: string, id: string }' },
    { name: 'crud_create', description: toolDescriptions.crud_create, args: '{ collection: string, id: string, record_json: string }' },
    { name: 'crud_update', description: toolDescriptions.crud_update, args: '{ collection: string, id: string, patch_json: string }' },
    { name: 'crud_delete', description: toolDescriptions.crud_delete, args: '{ collection: string, id: string }' },
    { name: 'noop', description: toolDescriptions.noop, args: '{ reason: string }' },
  ];
}

/**
 * Direct, deterministic execution of a chosen action against a world. Used by
 * the scaffold's executor — see PRD deviation note in README.
 */
export async function executeChosen(
  world: World,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!(toolName in toolSchemas)) {
    throw new Error(`unknown tool: ${toolName}`);
  }
  const name = toolName as ToolName;
  const parsed = toolSchemas[name].parse(args);
  return await executors[name](world, parsed);
}
