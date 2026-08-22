import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const contractsDirectory = new URL("../../opentrek/contracts/", import.meta.url);

async function loadSchema(name: string): Promise<Record<string, unknown>> {
  const path = fileURLToPath(new URL(name, contractsDirectory));
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function workflowMetadataValidator() {
  const [metadataSchema, sourceSchema, memoryCandidateSchema] = await Promise.all([
    loadSchema("workflow-metadata.schema.json"),
    loadSchema("source.schema.json"),
    loadSchema("memory-candidate.schema.json"),
  ]);
  const schemaId = String(metadataSchema.$id);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // These formats are declared by the referenced source/memory schemas. The
  // RAG contract tests only need their presence to compile the graph; the
  // backend's Zod validators perform the runtime source checks.
  ajv.addFormat("uri", true);
  ajv.addFormat("uuid", true);
  ajv.addSchema(sourceSchema, new URL("source.schema.json", schemaId).href);
  ajv.addSchema(
    memoryCandidateSchema,
    new URL("memory-candidate.schema.json", schemaId).href,
  );
  return ajv.compile(metadataSchema);
}

const baseMetadata = {
  schemaVersion: "1",
  workflowVersion: "candidate-v1",
  intent: "cycle_question",
  strategy: "none",
};

const source = {
  sourceId: "cycle-doc-1",
  title: "Cycle knowledge source",
};

describe("OpenTrek workflow metadata schema", () => {
  it("requires an explicit ragUsed boolean", async () => {
    const validate = await workflowMetadataValidator();

    expect(validate({ ...baseMetadata, sources: [] })).toBe(false);
    expect(validate({ ...baseMetadata, ragUsed: "true", sources: [source] })).toBe(false);
  });

  it("accepts one to three sources only when RAG is used", async () => {
    const validate = await workflowMetadataValidator();

    expect(validate({ ...baseMetadata, ragUsed: true, sources: [source] })).toBe(true);
    expect(validate({
      ...baseMetadata,
      ragUsed: true,
      sources: [1, 2, 3].map((index) => ({
        sourceId: `cycle-doc-${index}`,
        title: `Cycle knowledge source ${index}`,
      })),
    })).toBe(true);
    expect(validate({ ...baseMetadata, ragUsed: true, sources: [] })).toBe(false);
    expect(validate({
      ...baseMetadata,
      ragUsed: true,
      sources: [1, 2, 3, 4].map((index) => ({
        sourceId: `cycle-doc-${index}`,
        title: `Cycle knowledge source ${index}`,
      })),
    })).toBe(false);
  });

  it("requires an empty source list when RAG is not used", async () => {
    const validate = await workflowMetadataValidator();

    expect(validate({ ...baseMetadata, ragUsed: false, sources: [] })).toBe(true);
    expect(validate({ ...baseMetadata, ragUsed: false, sources: [source] })).toBe(false);
  });
});
