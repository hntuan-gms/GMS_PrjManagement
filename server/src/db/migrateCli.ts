import "dotenv/config";
import { migrate } from "./migrate.js";
import { db } from "./pool.js";

await migrate();
console.log("[db] migrations up to date");
await db().end();
