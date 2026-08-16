import { readFile } from 'node:fs/promises';
import type {
  GovernedToolDefinition,
  HappyHerdAgentManifest,
  ToolOperationSpec,
} from './types';

const identifier = (value: unknown, label: string, pattern: RegExp): string => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
};

const boundedText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes('\0')) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
};

const exactKeys = (value: Record<string, unknown>, allowed: string[], label: string): void => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported fields: ${unexpected.join(', ')}`);
};

const operation = (raw: unknown, label: string): ToolOperationSpec => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  const value = raw as Record<string, unknown>;
  exactKeys(value, ['method', 'path', 'scope', 'write', 'shared'], label);
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(value.method))) {
    throw new Error(`${label}.method is invalid`);
  }
  const path = boundedText(value.path, `${label}.path`, 512);
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#') || path.includes('..')) {
    throw new Error(`${label}.path must be an origin-relative path without query or traversal`);
  }
  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (placeholders.some((name) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))) {
    throw new Error(`${label}.path contains an invalid placeholder`);
  }
  const pathWithoutPlaceholders = path.replace(/\{[A-Za-z][A-Za-z0-9_]{0,63}\}/g, '');
  if (pathWithoutPlaceholders.includes('{') || pathWithoutPlaceholders.includes('}')) {
    throw new Error(`${label}.path contains malformed placeholders`);
  }
  if (value.scope !== null && (typeof value.scope !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/.test(value.scope))) {
    throw new Error(`${label}.scope is invalid`);
  }
  if (typeof value.write !== 'boolean' || typeof value.shared !== 'boolean') {
    throw new Error(`${label}.write and shared must be booleans`);
  }
  if (value.shared && value.write) throw new Error(`${label} cannot allow shared writes`);
  return {
    method: value.method as ToolOperationSpec['method'],
    path,
    scope: value.scope as string | null,
    write: value.write,
    shared: value.shared,
  };
};

const tool = (raw: unknown, index: number): GovernedToolDefinition => {
  const label = `tools[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  const value = raw as Record<string, unknown>;
  exactKeys(value, ['name', 'family', 'description', 'operations'], label);
  if (!value.operations || typeof value.operations !== 'object' || Array.isArray(value.operations)) {
    throw new Error(`${label}.operations must be an object`);
  }
  const operationEntries = Object.entries(value.operations as Record<string, unknown>);
  if (operationEntries.length === 0 || operationEntries.length > 64) {
    throw new Error(`${label}.operations must contain between 1 and 64 operations`);
  }
  return {
    name: identifier(value.name, `${label}.name`, /^[a-z][a-z0-9_]{0,63}$/),
    family: identifier(value.family, `${label}.family`, /^[a-z][a-z0-9-]{0,63}$/),
    description: boundedText(value.description, `${label}.description`, 512),
    operations: Object.fromEntries(operationEntries.map(([name, spec]) => [
      identifier(name, `${label}.operation name`, /^[a-z][a-z0-9_]{0,63}$/),
      operation(spec, `${label}.operations.${name}`),
    ])),
  };
};

export function parseHappyHerdAgentManifest(raw: unknown): HappyHerdAgentManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('HappyHerd Agent manifest must be an object');
  }
  const value = raw as Record<string, unknown>;
  exactKeys(value, ['schemaVersion', 'id', 'displayName', 'tools'], 'manifest');
  if (value.schemaVersion !== 1 || !Array.isArray(value.tools)) {
    throw new Error('HappyHerd Agent manifest schema is invalid');
  }
  if (value.tools.length === 0 || value.tools.length > 32) {
    throw new Error('HappyHerd Agent manifest must contain between 1 and 32 tools');
  }
  const tools = value.tools.map(tool);
  const names = new Set(tools.map((item) => item.name));
  const families = new Set(tools.map((item) => item.family));
  if (names.size !== tools.length || families.size !== tools.length) {
    throw new Error('HappyHerd Agent manifest tool names and families must be unique');
  }
  return {
    schemaVersion: 1,
    id: identifier(value.id, 'manifest.id', /^[a-z][a-z0-9-]{0,63}$/),
    displayName: boundedText(value.displayName, 'manifest.displayName', 128),
    tools,
  };
}

export async function loadHappyHerdAgentManifest(path: string): Promise<HappyHerdAgentManifest> {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 131_072) throw new Error('HappyHerd Agent manifest is too large');
  try {
    return parseHappyHerdAgentManifest(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('HappyHerd Agent manifest is not valid JSON');
    throw error;
  }
}

export function sessionToolManifest(manifest: HappyHerdAgentManifest): Array<{
  name: string;
  family: string;
  description: string;
}> {
  return manifest.tools.map(({ name, family, description }) => ({ name, family, description }));
}
