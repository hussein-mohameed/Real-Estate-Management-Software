import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

async function main(): Promise<void> {
  const client = new Client({
    connectionString: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    const ids = ["1f8cabaf-9788-4a88-b789-ad5934f7137c", "cmtj4fmb90085xglmhq97ztcx"];
    const { rows } = await client.query<{ a: string; t: string; e: string; after: unknown }>(
      `select "action" as a, "entityType" as t, "entityId" as e, "after"
       from "AuditLog"
       where "entityId" = any($1) or "actorUserId" = any($1)
       order by "createdAt" asc limit 20`,
      [ids],
    );
    console.log(`سجلّات تخصّ الصفّين المحذوفين: ${rows.length}`);
    for (const r of rows) console.log(` ${r.a} ${r.t} ${r.e} ${JSON.stringify(r.after)?.slice(0, 160)}`);
  } finally {
    await client.end().catch(() => {});
  }
}
void main();
