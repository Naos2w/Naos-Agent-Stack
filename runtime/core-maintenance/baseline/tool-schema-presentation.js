const SCHEMA_KEY_ORDER = [
    "description",
    "type",
    "$ref",
    "anyOf",
    "oneOf",
    "allOf",
    "default",
    "enum",
    "const",
    "properties",
    "required",
    "items",
    "additionalProperties",
    "format",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "patternProperties",
    "propertyNames",
    "dependentRequired",
    "dependentSchemas",
    "prefixItems",
    "contains",
    "minContains",
    "maxContains",
    "not",
    "if",
    "then",
    "else",
    "unevaluatedProperties",
    "unevaluatedItems",
    "$defs",
    "definitions",
    "examples",
    "title",
];
const SCHEMA_KEY_RANK = new Map(SCHEMA_KEY_ORDER.map((key, index) => [key, index]));
const SCHEMA_MAP_KEYS = new Set([
    "properties",
    "patternProperties",
    "dependentSchemas",
    "$defs",
    "definitions",
]);
const SCHEMA_VALUE_KEYS = new Set([
    "additionalProperties",
    "propertyNames",
    "items",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "unevaluatedProperties",
    "unevaluatedItems",
]);
const SCHEMA_ARRAY_KEYS = new Set(["prefixItems", "allOf", "anyOf", "oneOf"]);
const MODEL_SCHEMA_STRIP_KEYS = new Set([
    "$schema",
    "examples",
    "title",
    "format",
    "multipleOf",
    "maxLength",
    "minItems",
]);
const TOOL_ANNOTATION_DEFAULTS = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
};
const canonicalizedSchemas = new WeakSet();
export function projectRoutingInputError(name, input) {
    if (name !== "project_manage") return null;
    if (input.action === "use" && !Object.hasOwn(input, "project_id"))
        return "action=use requires project_id=<registered ID> or explicit null for machine/global work. An omitted ID must not silently clear the current Project.";
    if (input.action === "resolve" && !input.id)
        return "action=resolve requires id=<registered ID> and only inspects permission. To activate a known Project use action=use with project_id; a path is not an ID lookup.";
    return null;
}
/**
 * Apply openchatx-mcp's model-facing registration rules to one tool config.
 *
 * This owns the public schema projection contract: compact-output schema visibility,
 * native-content exceptions, explicit tool annotations, and JSON Schema
 * canonicalization. Runtime dispatch should use only the returned execution metadata.
 */
export function prepareToolRegistration(name, config, structuredOutput) {
    // Clarify existing contracts at their public entry point; do not rewrite
    // inputs, activate guessed projects or loosen declared permissions.
    if (name === "project_manage") config.description =
        "Manage Projects. Activate a known Project with action=use and project_id=<exact registered ID>; null explicitly clears routing. action=resolve requires id plus optional permission and only inspects access, not activation or path lookup. action=list discovers IDs when unknown. path belongs to upsert/grant_once.";
    if (name === "skill_search") config.description =
        "Search reusable Skills with action=search and query. Load with action=load and the exact qualified name returned by search (toolbox.skill), e.g. agent-runtime.agent-runtime-usage. Do not load an unqualified short name.";
    const acceptsInput = config.inputSchema !== undefined;
    const nativeContent = name === "image_view" ||
        name === "file_read" ||
        (isRecord(config._meta) && config._meta["shellby/externalMcp"] === true);
    if (!nativeContent && !structuredOutput)
        config.outputSchema = undefined;
    canonicalizeStandardSchema(config.inputSchema);
    canonicalizeStandardSchema(config.outputSchema);
    config.annotations = compactToolAnnotations(config.annotations);
    return { acceptsInput, nativeContent };
}
export function compactToolAnnotations(value) {
    // Keep the existing export name for callers, but retain explicit risk hints.
    // Missing or invalid hints use MCP's conservative defaults, never tool-name
    // guesses. Preserve declared booleans even when readOnlyHint is true.
    const annotations = isRecord(value) ? { ...value } : {};
    for (const [key, fallback] of Object.entries(TOOL_ANNOTATION_DEFAULTS)) {
        if (typeof annotations[key] !== "boolean")
            annotations[key] = fallback;
    }
    return annotations;
}
export function canonicalizeJsonSchema(value) {
    if (!isRecord(value))
        return value;
    const isIntegerSchema = value.type === "integer";
    const isNumericSchema = isIntegerSchema || value.type === "number";
    const keys = Object.keys(value).sort((left, right) => {
        const leftRank = SCHEMA_KEY_RANK.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = SCHEMA_KEY_RANK.get(right) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
    });
    const result = {};
    for (const key of keys) {
        const child = value[key];
        if (shouldStripSchemaEntry(key, child, isIntegerSchema, isNumericSchema))
            continue;
        result[key] = canonicalizeSchemaChild(key, child);
    }
    return result;
}
function canonicalizeStandardSchema(schema) {
    if (!isRecord(schema) || canonicalizedSchemas.has(schema))
        return;
    const standard = schema["~standard"];
    if (!isStandardSchemaJsonSource(standard))
        return;
    const source = standard;
    const input = source.jsonSchema.input;
    const output = source.jsonSchema.output;
    source.jsonSchema = {
        input: (options) => canonicalizeJsonSchema(input(options)),
        output: (options) => canonicalizeJsonSchema(output(options)),
    };
    canonicalizedSchemas.add(schema);
}
function shouldStripSchemaEntry(key, child, isIntegerSchema, isNumericSchema) {
    if (MODEL_SCHEMA_STRIP_KEYS.has(key))
        return true;
    if (key === "minLength" && (child === 0 || child === 1))
        return true;
    if (isIntegerSchema && key === "minimum" && child === Number.MIN_SAFE_INTEGER)
        return true;
    if (isNumericSchema && key === "minimum" && (child === 0 || child === 1))
        return true;
    return isIntegerSchema && key === "maximum" && child === Number.MAX_SAFE_INTEGER;
}
function canonicalizeSchemaChild(key, child) {
    if (SCHEMA_MAP_KEYS.has(key) && isRecord(child)) {
        return Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, canonicalizeJsonSchema(schema)]));
    }
    if (SCHEMA_VALUE_KEYS.has(key))
        return canonicalizeJsonSchema(child);
    if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(child)) {
        return child.map((schema) => canonicalizeJsonSchema(schema));
    }
    return child;
}
function isStandardSchemaJsonSource(value) {
    if (!isRecord(value) || !isRecord(value.jsonSchema))
        return false;
    return (typeof value.jsonSchema.input === "function" && typeof value.jsonSchema.output === "function");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
