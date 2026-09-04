/**
 * سجلّ القواعد `R1–R39` (‏§4).
 *
 * ── لماذا سجلّ في الكود لا جدول في وثيقة ──────────────────────────────
 * «كل القواعد مُغطّاة» ادّعاء لا يُفحص إن عاش في markdown. هنا كل قاعدة
 * كائن يحمل **أين تُفرَض** و**هل تحجبها قرارات**، و`audit:completeness`
 * يؤكّد أن العدد 39 بلا فجوة في الترقيم وأن لكل قاعدة موضع إنفاذ.
 *
 * `enforcedIn` يشير إلى الوحدة التي تحمل الفرض فعلاً — لا إلى نيّة.
 * القاعدة التي لا موضع لها بعد تُعلَّم `pending` صراحةً، فيظهر النقص بدل
 * أن يختفي.
 */

export type EnforcementLayer =
  | "database" // قيد أو فهرس في Postgres — لا يخترقه سباق تزامن
  | "domain" // منطق مجال خالص
  | "action" // فحص في Server Action
  | "job" // مهمة مجدولة
  | "ui"; // الواجهة فقط (لا يُعتمد عليها وحدها أبداً)

export interface DomainRule {
  id: `R${number}`;
  /** نصّ القاعدة مختصراً بالعربية. */
  ar: string;
  /** طبقة الإنفاذ — الأقوى أولاً. */
  layers: EnforcementLayer[];
  /** الوحدة أو الخطوة التي تحملها. `null` = لم تُنفَّذ بعد. */
  enforcedIn: string | null;
  /** معرّف القرار الذي يحجبها، إن وُجد. */
  blockedBy?: string;
  /** ملاحظة تصحيح أو تفصيل ملزم. */
  note?: string;
}

export const DOMAIN_RULES: readonly DomainRule[] = Object.freeze([
  { id: "R1", ar: "مالك نشط واحد بالضبط", layers: ["database"], enforcedIn: "‏SQL:uniq_active_owner ✔ مُختبَر",
    note: "فهرس فريد جزئي WHERE role='OWNER' AND isActive — طلبان متوازيان يُنشئان مالكين لو اعتمدنا فحصاً تطبيقياً." },
  { id: "R2", ar: "لا حذف صلب للمستخدم؛ isActive = false", layers: ["action"], enforcedIn: null,
    note: "⚠️ لا إجراء setUserActive في §9.2 إطلاقاً — الفراغ V2/V3. يُبنى في الخطوة 0.14." },
  { id: "R3", ar: "تطبيع الهاتف إلى E.164 قبل فحص التفريد", layers: ["domain", "database"], enforcedIn: "lib/domain/phone.ts" },
  { id: "R4", ar: "صور الهوية في bucket خاص + رابط موقَّع 5 دقائق", layers: ["action"], enforcedIn: null },
  { id: "R5", ar: "الأدمن/المالك والساكن نفسه فقط يولّدون الرابط، وكل توليد يُدقَّق", layers: ["action"], enforcedIn: null,
    note: "T5: الواجهة تستقبل مرجع كيان لا مساراً خاماً — منع IDOR." },
  { id: "R6", ar: "«تمتلك سيارة/باج» مشتقّة لا مخزّنة", layers: ["domain"], enforcedIn: null },
  { id: "R7", ar: "قاعدة الفوترة: VACANT = لا قيود دورية", layers: ["domain", "job"], enforcedIn: "lib/actions/apartments.ts:setApartmentOccupancy ✔ مُختبَر" },
  { id: "R8", ar: "SOLD تتطلب عقد بيع نشطاً؛ OCCUPIED_BY_TENANT تتطلب عقد إيجار نشطاً", layers: ["action"], enforcedIn: "lib/actions/apartments.ts:setApartmentOccupancy ✔ مُختبَر",
    note: "D1: يجوز النوعان معاً — «شقة مباعة يسكنها مستأجر» حالة تجارية أساسية." },
  { id: "R9", ar: "الحقول المشتقّة لا تُخزَّن", layers: ["domain"], enforcedIn: "lib/domain/statistics.ts" },
  { id: "R10", ar: "شقة تحت الإنشاء لا تخرج من VACANT", layers: ["action"], enforcedIn: "lib/actions/apartments.ts:assertR10 ✔ مُختبَر من الجهتين" },
  { id: "R11", ar: "المستخدم قد يُربط بعدة شقق", layers: ["domain"], enforcedIn: null,
    note: "كل شاشة ساكن تتعامل مع **قائمة** شقق لا شقة واحدة." },
  { id: "R12", ar: "أفراد الأسرة لهم اشتراكاتهم الخاصة", layers: ["domain"], enforcedIn: null },
  { id: "R13", ar: "إخراج آخر ساكن نشط يُطالب بضبط VACANT", layers: ["ui", "action"], enforcedIn: null,
    note: "تنبيه لا إجراء تلقائي — الإخلاء قرار إداري له أثر مالي." },
  { id: "R14", ar: "عقد ACTIVE واحد لكل (شقة + نوع)", layers: ["database"], enforcedIn: "‏SQL:uniq_active_contract_per_type ✔ مُختبَر",
    note: "معدَّلة بـD1/S1: الأصل «واحد لكل شقة» يجعل «مباعة يسكنها مستأجر» غير قابلة للتمثيل." },
  { id: "R15", ar: "تفعيل العقد يُنشئ Account في نفس المعاملة", layers: ["action"], enforcedIn: "lib/actions/contracts.ts:activateContract ✔ مُختبَر",
    note: "الاختبار يزرع حساباً مسبقاً فيُفشل الخطوة الوسطى، ويؤكّد بقاء العقد DRAFT — الذرّية مُثبَتة لا مُدَّعاة." },
  { id: "R16", ar: "إنهاء العقد يُغلق الحساب ويؤرشف الدفتر", layers: ["action"], enforcedIn: "lib/actions/contracts.ts:endContract ✔ مُختبَر",
    note: "D1/5: مفصولة بحسب النوع — إنهاء الإيجار لا يمسّ حساب البيع إطلاقاً." },
  { id: "R17", ar: "مستندات العقد كـAttachment في bucket خاص", layers: ["action"], enforcedIn: null },
  { id: "R18", ar: "توليد الأقساط بالتساوي والباقي في الأخير ليطابق المجموع", layers: ["domain"], enforcedIn: "lib/money.ts:splitEvenlyIqd",
    note: "B1 محسوم 2026-09-02: المُقسَّم هو **الكلي ناقص الدفعة المقدّمة**. انظر lib/services/installments.ts:buildSchedule." },
  { id: "R19", ar: "مهمة يومية تقلب PENDING → OVERDUE بلا غرامات", layers: ["job"], enforcedIn: "lib/services/installments.ts:markOverdue",
    note: "updateMany بشرط الحالة — تشغيلان لا يقلبان الصفّ مرّتين. ولا غرامة: القلب تغيير حالة لا قيد." },
  { id: "R20", ar: "تعليم القسط مدفوعاً ذرّياً: دفعة + فاتورة + قيد", layers: ["action"], enforcedIn: null },
  { id: "R21", ar: "تنبيه واتساب قبل الاستحقاق بـN يوماً ويوم الاستحقاق", layers: ["job"], enforcedIn: null },
  { id: "R22", ar: "إحصاءات المشتركين محسوبة دائماً", layers: ["domain"], enforcedIn: "lib/domain/statistics.ts" },
  { id: "R23", ar: "تغيير سعر الخدمة لا يرتدّ على الاشتراكات القائمة", layers: ["domain", "action"], enforcedIn: "lib/actions/services.ts:updateService ✔ مُختبَر",
    note: "لكل اشتراك لقطة سعره. الأثر الرجعي بإجراء أدمن صريح يكتب لقطة جديدة ويُسجّل." },
  { id: "R24", ar: "خدمة لها اشتراكات لا تُحذف — isAvailable = false فقط", layers: ["action"], enforcedIn: "lib/actions/services.ts:setServiceAvailability ✔ مُختبَر (لا إجراء حذف إطلاقاً)" },
  { id: "R25", ar: "PENDING_APPROVAL لا يُنتج أي قيد", layers: ["domain"], enforcedIn: null },
  { id: "R26", ar: "خدمة ONE_TIME بعد قيدها ← CANCELLED + endDate", layers: ["action"], enforcedIn: null,
    note: "S8: النصّ الأصلي «أو تبقى ACTIVE» ليس قاعدة بل خيارين. الحسم: CANCELLED. ولا قيمة COMPLETED في الـenum." },
  { id: "R27", ar: "الخدمات الإلزامية تلقائية مع السكن، موقوفة مع الإخلاء", layers: ["action"], enforcedIn: "lib/services/mandatory-subscriptions.ts ⚠️ الإيقاف مبنيّ؛ **الإنشاء محجوب بـB2**",
    note: "V11: isMandatory مع appliesTo=RESIDENT تركيبة صالحة لا يُنشئها أي تدفق — تُرفض عند الحفظ." },
  { id: "R28", ar: "payerType يحدّد الحساب المُقيَّد عليه", layers: ["domain"], enforcedIn: "lib/domain/payer.ts:resolvePayerAccount ✔ مُختبَر (الحالات الثماني)",
    note: "D1 جعلها قابلة للتنفيذ: OWNER ← حساب عقد SALE · OCCUPANT ← حساب RENTAL وإلا SALE." },
  { id: "R29", ar: "الدفتر append-only — لا تعديل ولا حذف", layers: ["database", "domain"], enforcedIn: "prisma/sql/001-constraints.sql:ledger_no_update/no_delete triggers", },
  { id: "R30", ar: "تفريد (subscriptionId, periodStart) يجعل إعادة تشغيل الفوترة آمنة", layers: ["database"], enforcedIn: "‏SQL: 4 فهارس فريدة جزئية ✔ مُختبَر",
    note: "⚠️ V1: لا يغطي RENT ولا INSTALLMENT ولا ONE_TIME — و§5.1/2 **يُعلن** ثغرة NULL مقصودة. تُضاف فهارس جزئية وتُشطب الملاحظة." },
  { id: "R31", ar: "balanceIqd = Σ CHARGE − Σ PAYMENT، ومهمة ليلية تكشف الانحراف", layers: ["domain", "job"], enforcedIn: "lib/ledger",
    note: "D2 بسّطها: لا فرع للإشارة إطلاقاً — وهذا يحذف أكثر موضع كان يمكن أن يُخطئ فيه الحساب." },
  { id: "R32", ar: "كشف حساب الساكن = الدفتر مرشّحاً، الأحدث أولاً، برصيد جارٍ", layers: ["domain"], enforcedIn: null,
    note: "يحتاج ترتيباً مستقراً (createdAt, id) وإلا اختلف الرصيد الجاري بين طلبين متطابقين." },
  { id: "R33", ar: "الفاتورة تُنشأ فقط عند وصول الدفعة إلى PAID", layers: ["action"], enforcedIn: null },
  { id: "R34", ar: "الترقيم داخل معاملة الدفع — الفراغات مقبولة والتكرار ممنوع", layers: ["database"], enforcedIn: null,
    note: "Q17: جدول Counter بمفتاح (kind, year) و SELECT … FOR UPDATE. لا MAX(number)+1." },
  { id: "R35", ar: "الفاتورة حصينة؛ الإلغاء بقيد معاكس لا بحذف", layers: ["database", "domain"], enforcedIn: "‏SQL:invoice_immutable trigger",
    note: "⚠️ لا إجراء cancelPayment في §9.2 مع أن R35 يفترضه — الفراغ Q40." },
  { id: "R36", ar: "إصدار باج برسم > 0 يُنشئ قيد CHARGE مصدره BADGE في نفس المعاملة", layers: ["action"], enforcedIn: null, blockedBy: "B3",
    note: "على حساب مَن؟ D1 جعل حسابين مفتوحين ممكنين — القرار B3." },
  { id: "R37", ar: "شاشة الأمن تسرد الباجات ISSUED وتبحث برقم اللوحة", layers: ["domain"], enforcedIn: "lib/auth/access.ts:SECURITY_GATE_FIELDS" },
  { id: "R38", ar: "انتهاء العقد يُلغي كل باجات سيارات الشقة بسبب «انتهاء العقد»", layers: ["action"], enforcedIn: "lib/actions/contracts.ts:endContract ✔ مُختبَر" },
  { id: "R39", ar: "«سيارة/باج» مشتقّة على شاشة الساكن", layers: ["domain"], enforcedIn: null },
]);

/** فحص سلامة السجلّ نفسه — يُستدعى من التدقيق ومن الاختبار. */
export function auditRules(): { total: number; missingIds: string[]; unenforced: string[] } {
  const ids = new Set(DOMAIN_RULES.map((r) => r.id));
  const missingIds: string[] = [];
  for (let i = 1; i <= 39; i += 1) {
    if (!ids.has(`R${i}` as DomainRule["id"])) missingIds.push(`R${i}`);
  }
  const unenforced = DOMAIN_RULES.filter((r) => r.enforcedIn === null).map((r) => r.id);
  return { total: DOMAIN_RULES.length, missingIds, unenforced };
}
