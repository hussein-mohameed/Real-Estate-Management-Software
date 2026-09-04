import { Client } from "pg";
async function main() {
  const c = new Client({
    connectionString: process.env["DIRECT_URL"],
    options: "-c search_path=integration_test",
  });
  await c.connect();
  await c.query(
    `insert into "Building" (id,code,"floorsCount","unitsPerFloor","numberingScheme",
                             "displayNumberFormat","constructionStatus","updatedAt")
     values ('stub_leftover','ITapt',5,4,'SEQUENTIAL','{building}-{floor}-{unit}','COMPLETED',now())
     on conflict (code) do nothing`,
  );
  const r = await c.query(`SELECT code FROM "Building"`);
  console.log(`بنايات عالقة مصطنعة: ${r.rowCount} — ${r.rows.map((x) => x.code).join(", ")}`);
  await c.end();
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
