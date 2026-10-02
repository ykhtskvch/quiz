import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  ContentFileSchema,
  TaxonomySchema,
  type LoadedFile,
  type Taxonomy,
} from "../../../packages/content-schema/src/index.ts";

export const CONTENT_DIR = "content";
export const FAMILIES_DIR = path.join(CONTENT_DIR, "families");

export function loadTaxonomy(): Taxonomy {
  const raw = parse(readFileSync(path.join(CONTENT_DIR, "taxonomy.yaml"), "utf8"));
  return TaxonomySchema.parse(raw);
}

export type LoadResult = { files: LoadedFile[]; schemaErrors: { path: string; message: string }[] };

export function loadFamilies(dir = FAMILIES_DIR): LoadResult {
  const files: LoadedFile[] = [];
  const schemaErrors: LoadResult["schemaErrors"] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    const filePath = path.join(dir, name);
    const result = ContentFileSchema.safeParse(parse(readFileSync(filePath, "utf8")));
    if (result.success) {
      files.push({ path: filePath, families: result.data.families });
    } else {
      for (const issue of result.error.issues) {
        schemaErrors.push({ path: `${filePath} › ${issue.path.join(".")}`, message: issue.message });
      }
    }
  }
  return { files, schemaErrors };
}
