/**
 * Load .env before any config-dependent imports. Must be first import in create-topic.
 */
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const paths = [
  join(__dirname, "..", "..", "..", ".env"),
  join(__dirname, "..", "..", ".env"),
  join(process.cwd(), ".env"),
];
for (const p of paths) {
  loadEnv({ path: p });
}
