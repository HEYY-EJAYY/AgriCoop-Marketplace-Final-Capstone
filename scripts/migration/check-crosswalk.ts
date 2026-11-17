import { readFile } from "node:fs/promises";
import { parseMigrationCrosswalk, summarizeMigrationCrosswalk } from "./identityCrosswalk";

const filePath = process.argv[2];
if (!filePath) {
  throw new Error("Provide the path to a completed migration crosswalk JSON file.");
}

try {
  const contents = await readFile(filePath, "utf8");
  const crosswalk = parseMigrationCrosswalk(JSON.parse(contents));
  console.log(JSON.stringify(summarizeMigrationCrosswalk(crosswalk), null, 2));
} catch (error) {
  if (error instanceof SyntaxError) {
    throw new Error("The migration crosswalk is not valid JSON.");
  }
  throw error;
}
