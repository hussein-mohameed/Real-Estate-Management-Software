-- ═══════════════════════════════════════════════════════════════════════
--  القيود التي لا يعبّر عنها Prisma
--
--  ⚠️ لماذا في قاعدة البيانات لا في التطبيق:
--     الفحص التطبيقي «اقرأ ثم اكتب» **يخسر السباق**. طلبان متوازيان يمرّان
--     من الفحص معاً ثم يكتبان معاً. لا يوجد ترتيب كود يمنع ذلك — يمنعه
--     القيد في المحرّك وحده.
--
--  كل قيد هنا idempotent: يُعاد تشغيل الملف بلا ضرر.
--  التطبيق: npm run db:constraints
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- 1) R1 — مالك نشط واحد بالضبط
--    بلا هذا القيد: طلبان متوازيان يُنشئان مالكين، ولا سبيل لاكتشاف أيّهما
--    الشرعي بعدها.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_owner"
  ON "User" ((1))
  WHERE "role" = 'OWNER' AND "isActive";

-- ───────────────────────────────────────────────────────────────────────
-- 2) T1 — تفريد الشقق **جزئياً** حتى لا يمنع الحذف الناعم إعادة التوليد
--    @@unique الكامل يجعل إعادة توليد شقة حُذفت ناعماً تفشل بخطأ تفريد،
--    والمواصفة تطلب إعادة التوليد صراحةً. لا بديل صحيح عن الجزئي.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_apartment_unit_alive"
  ON "Apartment" ("buildingId", "floorNumber", "unitNumber")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_apartment_display_alive"
  ON "Apartment" ("buildingId", "displayNumber")
  WHERE "deletedAt" IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 3) S1/D1 — عقد نشط واحد لكل (شقة + **نوع**)
--    جوهر الاتساق المالي كله. لو كان على (apartmentId) وحده لاستحال تمثيل
--    «شقة مباعة يسكنها مستأجر»، ولصار payerType = OWNER غير قابل للتنفيذ
--    على الوحدة المؤجّرة — وهي بالضبط الحالة التي وُجد من أجلها.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_contract_per_type"
  ON "Contract" ("apartmentId", "type")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 4) صاحب عقد نشط واحد لكل شقة
--
--    ⚠️ **تنبيه مفتوح:** هذا القيد كما قرّرته المستندات هو **لكل شقة**،
--    بينما §4.10 يقول «واحد نشط لكل **عقد** نشط» وD1 يسمح بعقدين نشطين
--    على الشقة نفسها. عملياً المالك لا يكون ساكناً في وحدة يؤجّرها، فلا
--    تظهر الحالة — لكن `ApartmentResident` لا يحمل `contractId` أصلاً، فلا
--    يمكن فرض القاعدة «لكل عقد» حتى لو أُريد ذلك.
--    مسجَّل في docs/OPEN-DECISIONS.md.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_contract_holder_per_apartment"
  ON "ApartmentResident" ("apartmentId")
  WHERE "isContractHolder" AND "isActive";

-- ───────────────────────────────────────────────────────────────────────
-- 5) Q3 + V1 — **أخطر عيب تقني في المواصفة**
--
--    التفريد الوحيد في §5 هو (subscriptionId, periodStart). قيود الإيجار
--    والأقساط لها subscriptionId = NULL، وPostgres يسمح بعدد لا نهائي من
--    الـNULL — أي أن **إعادة تشغيل واحدة لمهمة الفوترة تُضاعف إيجار كل
--    مستأجر**. ومهام cron تُعاد فعلياً عند انقضاء المهلة.
--
--    و§5.1 ملاحظة 2 لا تسكت عن هذا بل **تُعلنه مقصوداً**: «يسمح بعدة صفوف
--    بـsubscriptionId = null، وهذا بالضبط ما نريده». نصّ خاطئ واثق أخطر من
--    فراغ. الملاحظة تُشطب من المواصفة مع هذا الملف (T10).
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_rent_charge_per_period"
  ON "LedgerEntry" ("accountId", "source", "periodStart")
  WHERE "source" = 'RENT';

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_installment_charge"
  ON "LedgerEntry" ("installmentId")
  WHERE "type" = 'CHARGE' AND "installmentId" IS NOT NULL;

-- Q39 — خدمة ONE_TIME تُقيَّد عند الموافقة و periodStart = startDate
-- (لا NULL)، فيعمل مفتاح التفريد القائم ولا تُنتج نقرة مزدوجة قيدين.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_subscription_charge_per_period"
  ON "LedgerEntry" ("subscriptionId", "periodStart")
  WHERE "subscriptionId" IS NOT NULL AND "periodStart" IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- B4 — جلسة صندوق النقد
-- ═══════════════════════════════════════════════════════════════════════
--
-- ⚠️ جلسة مفتوحة **واحدة** لكل موظف. جلستان مفتوحتان تجعلان «أي صندوق
-- تنتمي إليه هذه الدفعة؟» سؤالاً بلا جواب، والإقفال بلا معنى: يُقفل
-- الموظف إحداهما ويُخفي الأخرى.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_open_cash_drawer_per_staff"
  ON "CashDrawerSession" ("staffUserId")
  WHERE "closedAt" IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- N3 — الترحيل. **محسوم 2026-09-02: خطة كاملة بأقساط ماضية.**
--
-- 🔴 كان الفهرس `ON ("accountId") WHERE source='OPENING'` — أي **قيد
--    افتتاحي واحد لكل حساب**. وهو يفترض النموذج المجمَّع: رقمٌ واحد
--    بالمتبقّي. وقد اختار المستخدم النموذج الآخر صراحةً: الخطة تُنشأ من
--    أوّلها، وكل قسط ماضٍ له قيده. فالفهرس القديم كان يرفض الترحيل من
--    أوّل قسط ثانٍ.
--
--    والحارس الحقيقي ضدّ الترحيل المزدوج موجود في موضعين أدقّ:
--      • `InstallmentPlan.contractId` فريد — خطة واحدة لكل عقد.
--      • `uniq_installment_charge` أعلاه — قيد استحقاق واحد لكل قسط.
--
--    فبقي هنا حرسُ **الجزء المجمَّع** وحده: ما لا يخصّ قسطاً بعينه
--    (الدفعة المقدّمة المُرحَّلة). واحدٌ مديناً وواحدٌ دائناً، لا أكثر.
-- ───────────────────────────────────────────────────────────────────────
-- ⚠️ `DROP` أوّلاً: `CREATE … IF NOT EXISTS` **لا يستبدل** فهرساً قائماً
--    بنفس الاسم — يتخطّاه صامتاً. فتبقى القاعدة على التعريف القديم بينما
--    الملفّ يقول غيره، وهو أسوأ من الخطأ الصريح.
DROP INDEX IF EXISTS "uniq_opening_entry_per_account";
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_opening_entry_per_account"
  ON "LedgerEntry" ("accountId", "type")
  WHERE "source" = 'OPENING' AND "installmentId" IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 6) S7 — سيارة أُزيلت يجب أن تكون قابلة للتسجيل من جديد
--    الفريد العالمي على plateNumber مع حالة REMOVED يجعل سيارة بيعت لساكن
--    آخر غير قابلة للتسجيل **أبداً**.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_plate"
  ON "Vehicle" ("plateNumber")
  WHERE "status" <> 'REMOVED';

-- ───────────────────────────────────────────────────────────────────────
-- 7) S4 — باج واحد غير ملغى لكل سيارة
--    موصوف في §4.17 نصّاً وغائب عن المخطّط إطلاقاً.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_badge_per_vehicle"
  ON "Badge" ("vehicleId")
  WHERE "status" <> 'REVOKED';

-- ═══════════════════════════════════════════════════════════════════════
--  قيود CHECK
-- ═══════════════════════════════════════════════════════════════════════
--
-- 🔴 **حرس الوجود مقيَّد بـ`current_schema()` — ولم يكن كذلك.**
-- كان الشرط `WHERE conname = '…'` وحده، و`conname` **غير مقيَّد بمخطّط**:
-- أسماء القيود فريدة على مستوى الجدول لا القاعدة. فحين أُنشئ مخطّط اختبار
-- منفصل، وجودُ القيود في `public` جعل كل شرط كاذباً — **فتُخطّيت الثمانية
-- عشر كلّها، والسكربت طبع ✅**.
--
-- والفهارس لم تُصَب: `CREATE INDEX IF NOT EXISTS` مقيَّد بالمخطّط فعلاً.
-- ولا المحفِّزات: `DROP TRIGGER … ON "Table"` مقيَّد بالجدول. فالعيب كان في
-- قيود CHECK وحدها — 12 فهرساً و4 محفِّزات وصلت، وصفر قيد CHECK.
--
-- والنتيجة كانت أخطر من الفشل: اختباراتٌ تشهد أن القاعدة تمنع الخرق تمرّ
-- وهي لا تفحص شيئاً. كشفها تشغيلٌ على المخطّط الجديد.

DO $$
BEGIN
  -- D2/3 — المبالغ موجبة **دائماً بلا استثناء**. الاتجاه يحمله type وحده،
  -- فصيغة الرصيد بلا أي فرع للإشارة — وهذا يزيل أكثر موضع محتمل للخطأ.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'ledger_amount_positive' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "LedgerEntry"
      ADD CONSTRAINT "ledger_amount_positive" CHECK ("amountIqd" > 0);
  END IF;

  -- D2/1 — لا تسوية يدوية بلا سبب مكتوب.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'ledger_manual_needs_reason' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "LedgerEntry"
      ADD CONSTRAINT "ledger_manual_needs_reason"
      CHECK ("source" <> 'MANUAL' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));
  END IF;

  -- الدفعة والفاتورة موجبتان أيضاً.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'payment_amount_positive' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amountIqd" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'invoice_total_positive' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_total_positive" CHECK ("totalIqd" > 0);
  END IF;

  -- الخطوة 0.5 — لا فحص لهذين في المخطّط إطلاقاً.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'request_rating_range' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "ServiceRequest"
      ADD CONSTRAINT "request_rating_range"
      CHECK ("ratedStars" IS NULL OR ("ratedStars" BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'apartment_completion_range' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Apartment"
      ADD CONSTRAINT "apartment_completion_range"
      CHECK ("completionPercentage" IS NULL OR ("completionPercentage" BETWEEN 0 AND 100));
  END IF;

  -- إلزامية ملاحظة الحل للانتقال إلى DONE — تُفرض في الخادم **وهنا**.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'request_done_needs_resolution' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "ServiceRequest"
      ADD CONSTRAINT "request_done_needs_resolution"
      CHECK ("status" <> 'DONE' OR ("resolutionNote" IS NOT NULL AND length(btrim("resolutionNote")) > 0));
  END IF;

  -- Q35 — طلب الشقة يحتاج شقة، وطلب المنطقة المشتركة لا يحملها.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'request_scope_apartment' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "ServiceRequest"
      ADD CONSTRAINT "request_scope_apartment"
      CHECK (
        ("scope" = 'APARTMENT'   AND "apartmentId" IS NOT NULL) OR
        ("scope" = 'COMMON_AREA' AND "apartmentId" IS NULL)
      );
  END IF;

  -- S5/Q28 — الكود يُسنَد عند الإصدار. باج ISSUED بلا كود غير قابل للتشغيل.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'badge_issued_needs_code' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Badge"
      ADD CONSTRAINT "badge_issued_needs_code"
      CHECK ("status" <> 'ISSUED' OR "code" IS NOT NULL);
  END IF;

  -- §4.4 — vendorId إلزامي عندما employmentType = VENDOR.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'staff_vendor_requires_vendor' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "StaffProfile"
      ADD CONSTRAINT "staff_vendor_requires_vendor"
      CHECK ("employmentType" <> 'VENDOR' OR "vendorId" IS NOT NULL);
  END IF;

  -- §4.14 — الاشتراك على شقة يحتاج شقة، وعلى ساكن يحتاج ساكناً.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'subscription_subject_consistent' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT "subscription_subject_consistent"
      CHECK (
        ("subjectType" = 'APARTMENT' AND "apartmentId" IS NOT NULL) OR
        ("subjectType" = 'RESIDENT'  AND "residentUserId" IS NOT NULL AND "apartmentId" IS NOT NULL)
      );
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- B4 — النقد لا يُقبض بلا صندوق، والإقفال لا يكون بلا مبلغ مُقرّ
  -- ═════════════════════════════════════════════════════════════════════
  --
  -- ⚠️ **دفعة نقدية بلا جلسة = نقدٌ لا يسأل عنه أحد.** الشرط في الكود
  -- وحده ينكسر عند أول مسار جديد يُكتب بعد سنة؛ والقيد في القاعدة لا.
  -- والدفع الإلكتروني لا صندوق له، فالشرط مقصور على `CASH_AT_CENTER`.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'payment_cash_needs_drawer' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "payment_cash_needs_drawer"
      CHECK ("method" <> 'CASH_AT_CENTER' OR "cashDrawerSessionId" IS NOT NULL);
  END IF;

  -- ⚠️ إقفالٌ بلا مبلغ مُقرّ ليس إقفالاً: الفرق بين المُسجَّل والمُورَّد
  -- لا يُحسب بلا رقم يُقرّه الموظف. وتاريخ الإقفال والمبلغ يأتيان معاً.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'cash_drawer_close_needs_declared' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "CashDrawerSession"
      ADD CONSTRAINT "cash_drawer_close_needs_declared"
      CHECK (("closedAt" IS NULL AND "declaredIqd" IS NULL AND "closedByUserId" IS NULL)
          OR ("closedAt" IS NOT NULL AND "declaredIqd" IS NOT NULL AND "closedByUserId" IS NOT NULL));
  END IF;

  -- المُقرّ لا يكون سالباً. صفرٌ مسموح: يوم بلا تحصيل يُقفَل بصفر.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'cash_drawer_declared_not_negative' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "CashDrawerSession"
      ADD CONSTRAINT "cash_drawer_declared_not_negative"
      CHECK ("declaredIqd" IS NULL OR "declaredIqd" >= 0);
  END IF;

  -- الاشتراك النشط يجب أن يحمل حساباً. القابلية لـnull للطلب المعلّق فقط.
  --
  -- ⚠️ **صُحِّح 2026-08-28.** الصيغة الأولى كانت
  --     CHECK ("status" = 'PENDING_APPROVAL' OR "accountId" IS NOT NULL)
  -- أي «كل ما ليس معلّقاً يحتاج حساباً» — وهي تحبس CANCELLED أيضاً.
  -- والنتيجة: **طلبٌ معلّق لا حساب له لا يمكن رفضه إطلاقاً**، لأن الرفض
  -- ينقله إلى CANCELLED فيطالبه القيد بحساب. رفضُ طلب لا مال فيه يستحيل.
  --
  -- والنيّة المكتوبة في هذا التعليق نفسه تقول «النشط»، فالصيغة كانت
  -- أوسع من قصدها. كُشف بالخطوة 2.4 حين فشل `rejectSubscription`.
  -- والاستبدال غير مشروط بـIF NOT EXISTS: القيد موجود بصيغته القديمة،
  -- والشرط كان سيتركها كما هي.
  ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "subscription_active_needs_account";
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "subscription_active_needs_account"
    CHECK ("status" IN ('PENDING_APPROVAL', 'CANCELLED') OR "accountId" IS NOT NULL);

  -- §4.13 — توافقات نموذج التسعير. JSON غير مُتحقَّق منه ينفجر في نموذج
  -- المستخدم لا هنا؛ هذه تمنعه من الدخول أصلاً.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'service_recurring_needs_cycle' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "service_recurring_needs_cycle"
      CHECK ("billingType" <> 'RECURRING' OR "billingCycle" IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'service_pricing_fields' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "service_pricing_fields"
      CHECK (
        ("pricingModel" = 'FLAT'       AND "basePriceIqd" IS NOT NULL) OR
        ("pricingModel" = 'PER_PERSON' AND "basePriceIqd" IS NOT NULL) OR
        ("pricingModel" = 'PER_UNIT'   AND "unitPriceIqd" IS NOT NULL AND "unitLabel" IS NOT NULL)
      );
  END IF;

  -- V11 — «إلزامية على ساكن» تركيبة صالحة في المخطّط **لا يُنشئها أي تدفق
  -- أبداً** (§7.3 يحصر الإنشاء التلقائي في «تنطبق على الشقق»). فتبقى
  -- إلزامية في الكتالوج وغير مطبَّقة في الواقع، بلا خطأ ولا تحذير.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'service_mandatory_not_resident_only' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "service_mandatory_not_resident_only"
      CHECK (NOT ("isMandatory" AND "appliesTo" = 'RESIDENT'));
  END IF;

  -- الأقساط والمبالغ المرجعية موجبة.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'installment_amount_positive' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Installment"
      ADD CONSTRAINT "installment_amount_positive" CHECK ("amountIqd" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'plan_count_positive' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "InstallmentPlan"
      ADD CONSTRAINT "plan_count_positive"
      CHECK ("installmentsCount" >= 1 AND "intervalMonths" >= 1);
  END IF;

  -- §4.1 — يوم الفوترة ضمن المدى. 31 في شهر أقصر يُثبَّت على آخر يوم
  -- في lib/dates، لكن القيمة نفسها يجب أن تبقى صالحة.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'settings_billing_day_range' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "CompoundSettings"
      ADD CONSTRAINT "settings_billing_day_range"
      CHECK ("billingDayOfMonth" BETWEEN 1 AND 31);
  END IF;

  -- §4.8 — بناية بلا طوابق أو بلا وحدات لا معنى لها.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'building_dimensions_positive' AND ns.nspname = current_schema()
  ) THEN
    ALTER TABLE "Building"
      ADD CONSTRAINT "building_dimensions_positive"
      CHECK ("floorsCount" >= 1 AND "unitsPerFloor" >= 1);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
--  الحماية النهائية للدفتر: append-only على مستوى المحرّك
--
--  قاعدة ESLint تمنع الكتابة المباشرة من الكود، لكنها لا تمنع psql ولا
--  سكربتاً عابراً ولا أداة إدارة. R29 ثابت لا اصطلاح — يُفرض هنا.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'الدفتر append-only (R29): لا تعديل ولا حذف لقيد. صحّح بقيد معاكس بمصدر MANUAL وسبب إلزامي.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ledger_no_update" ON "LedgerEntry";
CREATE TRIGGER "ledger_no_update"
  BEFORE UPDATE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

DROP TRIGGER IF EXISTS "ledger_no_delete" ON "LedgerEntry";
CREATE TRIGGER "ledger_no_delete"
  BEFORE DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- R35 — الفاتورة حصينة بعد الإصدار، عدا pdfUrl الذي يُملأ عند التوليد.
CREATE OR REPLACE FUNCTION reject_invoice_mutation() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
       OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
       OR NEW."totalIqd" IS DISTINCT FROM OLD."totalIqd"
       OR NEW."lines"::text IS DISTINCT FROM OLD."lines"::text
       OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" THEN
      RAISE EXCEPTION 'الفاتورة غير قابلة للتعديل بعد الإصدار (R35). الإلغاء بقيد معاكس وملاحظة، لا بتعديل.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "invoice_immutable" ON "Invoice";
CREATE TRIGGER "invoice_immutable"
  BEFORE UPDATE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();

DROP TRIGGER IF EXISTS "invoice_no_delete" ON "Invoice";
-- ⚠️ **رسالتها خاصّة بالفاتورة.** كانت تستعمل `reject_ledger_mutation()`
-- فيقرأ من يحذف فاتورةً رسالةً عن **الدفتر** تنصحه بقيد معاكس بمصدر
-- MANUAL — وهي نصيحة لا تنطبق على ما فعل. ورسالة قيدٍ تصف الشيء الخطأ
-- تُرسل من يقرؤها إلى الجهة الخطأ.
CREATE OR REPLACE FUNCTION reject_invoice_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'الفاتورة لا تُحذف بعد الإصدار (R35). الإلغاء بقيد معاكس وملاحظة على الفاتورة، لا بحذفها.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_no_delete"
  BEFORE DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION reject_invoice_delete();
