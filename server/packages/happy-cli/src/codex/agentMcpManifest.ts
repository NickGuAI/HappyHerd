export type GovernedToolDefinition = {
  name: string;
  family: string;
  description: string;
};

export type GovernedToolManifest = {
  schemaVersion: 1;
  tools: GovernedToolDefinition[];
};

const boundedString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes('\0')) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
};

export function parseGovernedToolManifest(value: unknown): GovernedToolManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('governed tool manifest must be an object');
  }
  const record = value as Record<string, unknown>;
  const unexpectedManifestFields = Object.keys(record)
    .filter((key) => !['schemaVersion', 'tools'].includes(key));
  if (unexpectedManifestFields.length > 0) {
    throw new Error('governed tool manifest contains unsupported fields');
  }
  if (record.schemaVersion !== 1 || !Array.isArray(record.tools)) {
    throw new Error('governed tool manifest schema is invalid');
  }
  if (record.tools.length === 0 || record.tools.length > 32) {
    throw new Error('governed tool manifest must contain between 1 and 32 tools');
  }
  const names = new Set<string>();
  const families = new Set<string>();
  const tools = record.tools.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`tools[${index}] must be an object`);
    }
    const tool = raw as Record<string, unknown>;
    const unexpected = Object.keys(tool).filter((key) => !['name', 'family', 'description'].includes(key));
    if (unexpected.length > 0) throw new Error(`tools[${index}] contains unsupported fields`);
    const name = boundedString(tool.name, `tools[${index}].name`, 64);
    const family = boundedString(tool.family, `tools[${index}].family`, 64);
    const description = boundedString(tool.description, `tools[${index}].description`, 512);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new Error(`tools[${index}].name is invalid`);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(family)) throw new Error(`tools[${index}].family is invalid`);
    if (names.has(name)) throw new Error(`duplicate governed tool name: ${name}`);
    if (families.has(family)) throw new Error(`duplicate governed tool family: ${family}`);
    names.add(name);
    families.add(family);
    return { name, family, description };
  });
  return { schemaVersion: 1, tools };
}

export function parseGovernedToolManifestJson(raw: string): GovernedToolManifest {
  if (Buffer.byteLength(raw, 'utf8') > 16_384) throw new Error('governed tool manifest is too large');
  try {
    return parseGovernedToolManifest(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('governed tool manifest is not valid JSON');
    throw error;
  }
}
