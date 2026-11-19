import { config } from "dotenv";

config({ path: ".env.local" });
config();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL must be set to run tests");
}
// Every test talks to the isolated test database, never the development or production one.
process.env.DATABASE_URL = testUrl;
process.env.DB_POOL_MAX = "10";
