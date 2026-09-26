// Runs an import into the local demo org from recorded API fixtures, so the
// import screens can be tried without a real help desk account:
//   DATABASE_URL=... npx tsx scripts/demo-import.ts [zendesk|intercom|freshdesk|helpscout]
import { pool } from "../src/db";
import { isSource, runStep, startImport } from "../src/lib/import/engine";
import { fakeApi, FIXTURES } from "../src/lib/import/fixtures";

const ORG = "org_dev";

async function main() {
  const source = process.argv[2] ?? "zendesk";
  if (!isSource(source)) throw new Error(`Unknown source ${source}`);
  const { base, creds, routes } = FIXTURES[source];
  const fetchImpl = fakeApi(base, routes);
  const { id } = await startImport({ orgId: ORG, userId: "user_dev", source, creds, fetchImpl });
  let job;
  do job = await runStep(ORG, id, { fetchImpl });
  while (job?.status === "running");
  console.log(`Import ${job?.status}: http://localhost:3000/app/import/${id}`);
}

main().finally(() => pool.end());
