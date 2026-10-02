// Validates taxonomy and all content files. Exit code 1 on any error (used in CI).
import { checkContent } from "../../packages/content-schema/src/index.ts";
import { loadFamilies, loadTaxonomy } from "./lib/load.ts";

const taxonomy = loadTaxonomy();
const { files, schemaErrors } = loadFamilies();
const issues = checkContent(files, taxonomy);

for (const e of schemaErrors) console.log(`ERROR   ${e.path}: ${e.message}`);
for (const i of issues) console.log(`${i.level === "error" ? "ERROR  " : "warning"} ${i.where}: ${i.message}`);

const errors = schemaErrors.length + issues.filter((i) => i.level === "error").length;
const warnings = issues.filter((i) => i.level === "warning").length;
const questions = files.flatMap((f) => f.families.flatMap((fam) => fam.facts.flatMap((fact) => fact.questions))).length;
console.log(`\n${files.length} files, ${questions} questions — ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
