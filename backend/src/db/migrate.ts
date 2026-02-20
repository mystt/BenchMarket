import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "../config.js";
import { getPool, close } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  if (config.useSqlite) {
    console.log("Using in-memory store (no migration needed).");
  } else {
    const pool = getPool();
    if (!pool) throw new Error("Postgres pool not available");
    const schemaPath = join(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    await pool.query(schema);
    await pool.end();
    console.log("PostgreSQL schema applied.");
  }
  close();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
