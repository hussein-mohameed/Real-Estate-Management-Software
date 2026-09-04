/**
 * إنشاء المالك الأول — **البوت‑ستراب**.
 *
 * ── لماذا سكربت لا شاشة ──────────────────────────────────────────────
 * هذا هو الفراغ `V2` عملياً: §9.2 لا تحتوي إجراءً لإنشاء مستخدم إدارة،
 * فالمالك الأول لا يمكن أن يُنشئه أحد **من داخل النظام**. يُكتب مرة واحدة
 * مباشرةً في القاعدة، ثم يصير هو من يُنشئ الأدمن (وذلك الإجراء يُبنى في
 * الخطوة 0.14).
 *
 * يقرأ البريد من `auth.users` — أي من محاولة دخولك الفعلية — فلا يُكتب
 * يدوياً ولا يُخطأ فيه حرف.
 *
 * ⚠️ `R1`: مالك نشط واحد. الفهرس الفريد الجزئي يرفض الثاني، فتشغيل
 * السكربت مرتين آمن ولا يُنتج مالكين.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

const phone = process.argv[2];

async function main(): Promise<void> {
  if (!phone || !/^\+964\d{10}$/u.test(phone)) {
    console.error("❌ مرّر رقم هاتف المالك بصيغة E.164:");
    console.error("   npm run bootstrap:owner -- +9647701234567");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    connectionTimeoutMillis: 20000,
  });
  await client.connect();

  try {
    const existing = await client.query<{ id: string; email: string }>(
      `select id, email from "User" where role = 'OWNER' and "isActive"`,
    );
    if (existing.rows.length > 0) {
      console.log(`⏭  يوجد مالك نشط سلفاً (${existing.rows[0]!.email ?? "بلا بريد"}). لا شيء ليُفعل.`);
      return;
    }

    // البريد من آخر حساب Google دخل فعلاً — أدقّ من الكتابة اليدوية
    const auth = await client.query<{ email: string; id: string }>(
      `select id::text, email from auth.users
       where raw_app_meta_data->>'provider' = 'google' and email is not null
       order by last_sign_in_at desc nulls last limit 1`,
    );
    const authUser = auth.rows[0];
    if (!authUser) {
      console.error("❌ لا حساب Google في auth.users. سجّل الدخول مرة أولاً (ستُحوَّل إلى /pending)، ثم أعد التشغيل.");
      process.exit(1);
    }

    const email = authUser.email.trim().toLowerCase();
    const { rows } = await client.query<{ id: string }>(
      `insert into "User" (id,"fullName",phone,email,role,"isActive","supabaseUserId","updatedAt")
       values (gen_random_uuid()::text,'المالك',$1,$2,'OWNER',true,$3,now())
       returning id`,
      [phone, email, authUser.id],
    );

    console.log("✅ أُنشئ المالك.");
    console.log(`   البريد : ${email.replace(/^(.{3}).*(@.*)$/u, "$1***$2")}`);
    console.log(`   الهاتف : ${phone}`);
    console.log(`   المعرّف : ${rows[0]!.id}`);
    console.log("\n   سجّل الدخول من جديد ← ستُحوَّل إلى /owner");
  } finally {
    await client.end().catch(() => {});
  }
}

void main();
