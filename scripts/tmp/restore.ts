import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

/**
 * استعادة صفّ المستخدم الذي حذفه `--reset` بالخطأ.
 *
 * ⚠️ الهاتف **بادئة 71 غير صالحة عمداً**: `VALID_PREFIXES` لا تضمّها، فلا
 * يستطيع أحد طلب رمز OTP لها ولا الوصول إلى الحساب بها. والدخول يبقى
 * بـGoogle عبر `supabaseUserId` — وهو ما استُعيد فعلاً.
 */
async function main(): Promise<void> {
  const client = new Client({
    connectionString: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    const orphan = await client.query<{ id: string; email: string }>(
      `select u.id::text, u.email from auth.users u
        left join "User" a on a."supabaseUserId" = u.id::text
       where a.id is null and u.email is not null
       order by u.last_sign_in_at desc nulls last limit 1`,
    );
    const identity = orphan.rows[0];
    if (!identity) {
      console.log("لا هويّة يتيمة — لا شيء ليُستعاد.");
      return;
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into "User" (id,"fullName",phone,email,role,"isActive","supabaseUserId","updatedAt")
       values ($1,'المالك','+9647100000001',$2,'RESIDENT',true,$3,now())
       on conflict ("supabaseUserId") do nothing
       returning id`,
      ["1f8cabaf-9788-4a88-b789-ad5934f7137c", identity.email, identity.id],
    );

    if (rows.length === 0) {
      console.log("الصفّ موجود سلفاً — لا تغيير.");
      return;
    }
    console.log("✅ استُعيد الصفّ.");
    console.log(`   المعرّف        : ${rows[0]!.id}`);
    console.log(`   البريد         : ${identity.email.replace(/^(.{2}).*(@.*)$/u, "$1***$2")}`);
    console.log("   الدور          : RESIDENT (كما كان)");
    console.log("   الهاتف         : +9647100000001  ← بديل، بادئة غير صالحة عمداً");
    console.log("   supabaseUserId : مُستعاد ← الدخول بـGoogle يعمل");
  } finally {
    await client.end().catch(() => {});
  }
}
void main();
