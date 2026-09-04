import type { Capability } from "@/lib/auth/roles";

/**
 * سجلّ الإجراءات (‏§9.2).
 *
 * **44 إجراءً في المواصفة + 9 مفقودة كشفها التدقيق = 53.**
 *
 * السجلّ ليس توثيقاً: هو ما يجعل «كل إجراء له صلاحية معلَنة» قابلاً للفحص.
 * كل إجراء يعلن `capability` و`kind` (‏read/write)، ومغلّف `defineAction`
 * يقرأ منه — فلا يمكن أن يُكتب action كتابي بلا فحص صلاحية.
 *
 * ── لماذا التسعة المفقودة هنا ─────────────────────────────────────────
 * ‏6 رصدها التدقيق الأصلي، و3 أضافها التحقّق المستقل (‏V2 · V3 · V4).
 * اثنان منها — `createUser` و`setUserActive` — **يمنعان تشغيل النظام**:
 * الأول لأن المالك بلا مسار لإنشاء الأدمن، والثاني لأن `isActive` هو آلية
 * منع الدخول الوحيدة (‏§10.1) ولا إجراء يضبطه.
 */

export type ActionKind = "read" | "write";

export interface ActionSpec {
  name: string;
  ar: string;
  group:
    | "buildings"
    | "people"
    | "contracts"
    | "services"
    | "finance"
    | "access"
    | "users";
  kind: ActionKind;
  capability: Capability;
  /** معاملة قاعدة بيانات واحدة إلزامياً. */
  transactional?: true;
  /** موجود في §9.2 أم كشفه التدقيق؟ */
  source: "spec" | "audit";
  blockedBy?: string;
  note?: string;
}

export const ACTIONS: readonly ActionSpec[] = Object.freeze([
  // ── البنايات والشقق (6) ────────────────────────────────────────────
  { name: "createBuilding", ar: "إنشاء بناية", group: "buildings", kind: "write", capability: "BUILDINGS", source: "spec" },
  { name: "updateBuilding", ar: "تعديل بناية", group: "buildings", kind: "write", capability: "BUILDINGS", source: "spec" },
  { name: "regenerateApartments", ar: "إعادة توليد الشقق", group: "buildings", kind: "write", capability: "APARTMENTS", source: "spec",
    note: "لا تلمس شقة لها **أي** صف تابع (عقد أو ساكن أو اشتراك أو سيارة أو طلب أو مرفق) وتُبلّغ عن كل متخطَّاة (Q31)." },
  { name: "updateApartment", ar: "تعديل شقة", group: "buildings", kind: "write", capability: "APARTMENTS", source: "spec" },
  { name: "setApartmentConstructionStatus", ar: "ضبط حالة الإنشاء", group: "buildings", kind: "write", capability: "APARTMENTS", source: "spec" },
  { name: "setApartmentOccupancy", ar: "ضبط حالة السكن", group: "buildings", kind: "write", capability: "APARTMENT_OCCUPANCY", source: "spec", transactional: true,
    blockedBy: "effectiveDate", note: "مفتاح الفوترة. هل التاريخ الماضي يُنتج قيوداً رجعية؟" },

  // ── الأشخاص (6) ────────────────────────────────────────────────────
  { name: "createMyRequest", ar: "طلب أو شكوى من الساكن", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "audit",
    note: "نطاق بنيويّ خارج المصفوفة: LEVEL_ACTIONS.OWN يمنح القراءة وحدها. المعرّف من الجلسة، والشقة يجب أن تكون شقّته. ثالث موضع بهذا النمط بعد staff-self وrequestSubscription." },
  { name: "commentOnMyRequest", ar: "تعليق الساكن على طلبه", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "audit",
    note: "isInternal غير موجود في التوقيع أصلاً — لا يُقبَل ثم يُتجاهَل." },
  { name: "createServiceRequest", ar: "إنشاء طلب أو شكوى", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec", transactional: true,
    note: "Q35 — COMMON_AREA بلا شقة، وAPARTMENT يوجبها. والقسم يُشتقّ من المهمّة لا يُقبَل من المتصل." },
  { name: "assignServiceRequest", ar: "إسناد طلب إلى موظف", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec", transactional: true,
    note: "D4 — الإسناد قرار ترخيص: المُكلَّف بطلب غير مغلق على شقة يرى تلك الشقة." },
  { name: "setRequestStatus", ar: "تغيير حالة طلب", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec", transactional: true,
    note: "DONE بلا resolutionNote مرفوض في الخادم — حقلٌ مطلوب في نموذج وحده يُتجاوَز بطلب HTTP." },
  { name: "addRequestComment", ar: "تعليق على طلب", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec", transactional: true,
    note: "الساكن لا يكتب تعليقاً داخلياً مهما أرسل — يُجبَر على false لدوره." },
  { name: "listServiceRequests", ar: "قائمة الطلبات والشكاوى", group: "access", kind: "read", capability: "SERVICE_REQUESTS", source: "spec",
    note: "نطاق الساكن في where لا في العرض. والترتيب بالأولوية ثم الأقدم." },
  { name: "getServiceRequest", ar: "تفصيل طلب", group: "access", kind: "read", capability: "SERVICE_REQUESTS", source: "spec",
    note: "التعليق الداخلي مُرشَّح من الاستعلام لا من العرض — لا يصل إلى متصفّح الساكن." },
  { name: "createResident", ar: "إنشاء ساكن", group: "people", kind: "write", capability: "RESIDENT_PROFILES", source: "spec" },
  { name: "linkResidentToApartment", ar: "ربط ساكن بشقة", group: "people", kind: "write", capability: "APARTMENT_RESIDENT_LINKS", source: "spec" },
  { name: "unlinkResident", ar: "فكّ ربط ساكن", group: "people", kind: "write", capability: "APARTMENT_RESIDENT_LINKS", source: "spec" },
  { name: "createStaff", ar: "إنشاء موظف", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "spec" },
  { name: "updateStaff", ar: "تعديل الملفّ الوظيفي", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit", transactional: true,
    note: "لم يكن للموظّف سبيل تعديل بعد الإنشاء — فالنقل بين الأقسام كان يُنشئ ملفّاً ثانياً ويُفرّق التدقيق. والاسم والهاتف خارجه: قدرتهما USERS_AND_ROLES لأن الهاتف مفتاح دخول." },
  { name: "getStaff", ar: "ملفّ موظّف واحد", group: "people", kind: "read", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit",
    note: "لا يُخفي المعطَّل: تدقيقه وجلسات صندوقه تشير إليه." },
  { name: "setStaffAvailability", ar: "ضبط تواجد الموظف", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "spec" },
  { name: "setStaffSkills", ar: "ضبط مهارات الموظف", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "spec" },

  // ── العقود والأقساط (6) ────────────────────────────────────────────
  { name: "createContract", ar: "إنشاء عقد", group: "contracts", kind: "write", capability: "CONTRACTS", source: "spec" },
  { name: "activateContract", ar: "تفعيل عقد", group: "contracts", kind: "write", capability: "CONTRACTS", source: "spec", transactional: true,
    note: "يُنشئ Account في نفس المعاملة — وإلا نتج عقد نشط بلا حساب تفشل فوترته لاحقاً بصمت." },
  { name: "endContract", ar: "إنهاء عقد", group: "contracts", kind: "write", capability: "CONTRACTS", source: "spec", transactional: true,
    note: "D1/5: إنهاء الإيجار لا يمسّ حساب البيع؛ وإنهاء البيع أثناء إيجار نشط مرفوض." },
  { name: "createInstallmentPlan", ar: "إنشاء خطة أقساط", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "spec", transactional: true,
    note: "B1 محسوم 2026-09-02 — المقدّمة مقبوضة: الإجراء يُنتج خطة + قيداً + دفعة + فاتورة في معاملة واحدة." },
  { name: "markInstallmentPaid", ar: "تعليم قسط مدفوعاً", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "audit", transactional: true,
    note: "ذرّي بـupdateMany مشروط — نقرتان متزامنتان كانتا تُنتجان دفعتين وقيدين." },
  { name: "recordFollowUp", ar: "تسجيل متابعة على قسط", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "audit",
    note: "ملاحظة تحصيل لا قيد — خلطُها بالسداد كان يجعل «سيدفع غداً» تُسقط الدَين." },
  { name: "migrateInstallmentPlan", ar: "ترحيل عقد قائم إلى خطة أقساط", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "audit", transactional: true,
    note: "N3 محسوم 2026-09-02 — خطة كاملة بأقساط ماضية. قيود OPENING بلا دفعة ولا فاتورة: المال لم يمرّ بهذا النظام." },
  { name: "listInstallmentPlans", ar: "قائمة خطط الأقساط", group: "contracts", kind: "read", capability: "INSTALLMENT_PLANS", source: "audit" },
  { name: "getInstallmentPlan", ar: "تفصيل خطة أقساط", group: "contracts", kind: "read", capability: "INSTALLMENT_PLANS", source: "audit" },
  { name: "sweepOverdueInstallments", ar: "قلب الأقساط المتأخّرة", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "audit",
    note: "تغيير حالة لا قيد. ولا غرامات — قرارٌ لم يُتّخذ." },
  { name: "assignInstallmentFollowUp", ar: "تكليف متابع قسط", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "spec" },
  { name: "recordInstallmentFollowUp", ar: "تسجيل ملاحظة متابعة", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "spec" },

  // ── الخدمات والاشتراكات (11) ───────────────────────────────────────
  { name: "createService", ar: "إنشاء خدمة", group: "services", kind: "write", capability: "SERVICES_CATALOGUE", source: "spec" },
  { name: "updateService", ar: "تعديل خدمة", group: "services", kind: "write", capability: "SERVICES_CATALOGUE", source: "spec",
    note: "R23: لا أثر رجعي على الاشتراكات القائمة. التطبيق الرجعي إجراء صريح يكتب لقطة جديدة." },
  { name: "setServiceAvailability", ar: "إتاحة/إيقاف خدمة", group: "services", kind: "write", capability: "SERVICES_CATALOGUE", source: "spec" },
  { name: "createSubscription", ar: "إنشاء اشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec" },
  { name: "requestSubscription", ar: "طلب اشتراك (ساكن)", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec",
    note: "R25: PENDING_APPROVAL لا يُنتج أي قيد حتى الموافقة." },
  { name: "approveSubscription", ar: "الموافقة على اشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec", transactional: true,
    note: "B2 محسوم 2026-08-28: التقسيط بالتناسب. الفترة الأولى تبدأ يوم الموافقة وتنتهي مع الدورة المحاذية." },
  { name: "rejectSubscription", ar: "رفض اشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec" },
  { name: "updateSubscriptionQuantity", ar: "تغيير كمية الاشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec" },
  { name: "pauseSubscription", ar: "إيقاف اشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec" },
  { name: "resumeSubscription", ar: "استئناف اشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec" },
  { name: "cancelSubscription", ar: "إلغاء اشتراك", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "spec" },
  { name: "listSubscriptions", ar: "قائمة الاشتراكات", group: "services", kind: "read", capability: "SUBSCRIPTIONS", source: "audit",
    note: "شاشة الإدارة — المعلّق أولاً، وعدّاد المعلّق على الكلّ لا على الصفحة." },
  { name: "previewMandatoryRollout", ar: "معاينة تعميم خدمة إلزامية", group: "services", kind: "read", capability: "SUBSCRIPTIONS", source: "audit",
    note: "2.6 — «يعرض عدد الشقق والمبلغ الإجمالي قبل التأكيد». لا كتابة." },
  { name: "applyMandatoryRollout", ar: "تعميم خدمة إلزامية", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "audit", transactional: true,
    note: "2.6 — يوجب confirm ومطابقة عدد الشقق المُعايَن. فشلٌ على شقة يُرجع الكل." },

  // ── المال (5) ──────────────────────────────────────────────────────
  { name: "openMyCashDrawer", ar: "فتح صندوق النقد", group: "finance", kind: "write", capability: "RECORD_CASH_PAYMENT", source: "audit",
    note: "B4 — جلسة واحدة مفتوحة لكل موظف (فهرس فريد جزئي)." },
  { name: "closeCashDrawer", ar: "إقفال صندوق النقد", group: "finance", kind: "write", capability: "RECORD_CASH_PAYMENT", source: "audit", transactional: true,
    note: "B4 — يوجب مبلغاً مُقرّاً. الفرق يُسجَّل ولا يمنع الإقفال." },
  { name: "getCashDrawer", ar: "حالة صندوق النقد", group: "finance", kind: "read", capability: "RECORD_CASH_PAYMENT", source: "audit" },
  { name: "staffCashHistory", ar: "تحصيل الموظف — سجلّ الصناديق", group: "finance", kind: "read", capability: "FINANCIAL_REPORTS", source: "audit",
    note: "B4 — تقرير رقابي. كانت قدرته DEPARTMENTS_SKILLS_STAFF فكشف اختبار أنها تجعل كل موظف يقرأ فروق زملائه." },
  { name: "staffCollectionToday", ar: "تحصيل اليوم لمجموعة موظفين", group: "finance", kind: "read", capability: "FINANCIAL_REPORTS", source: "audit",
    note: "B4 — عمود شاشة الموظفين. تجميع واحد للصفحة كلها لا استعلام لكل صفّ." },
  { name: "recordCashPayment", ar: "تسجيل دفعة نقدية", group: "finance", kind: "write", capability: "RECORD_CASH_PAYMENT", source: "spec", transactional: true,
    note: "B4 محسوم 2026-09-01: مقيَّد بـcanReceiveCash **وبجلسة صندوق مفتوحة**، وpaidAt = now() لا مُدخَل (N4). " +
      "و3.1: يُصدر الفاتورة برقمها في **نفس المعاملة** — R33/R34/R35." },
  { name: "createWaylPaymentLink", ar: "إنشاء رابط دفع", group: "finance", kind: "write", capability: "CREATE_PAYMENT_LINK", source: "spec", blockedBy: "B6" },
  { name: "addLedgerAdjustment", ar: "قيد تسوية", group: "finance", kind: "write", capability: "LEDGER_AND_ACCOUNTS", source: "spec", transactional: true,
    blockedBy: "B5", note: "D2: يُترجم إلى CHARGE/PAYMENT بمصدر MANUAL وسبب إلزامي — لا قيمة ADJUSTMENT." },
  { name: "getAccountStatement", ar: "كشف الحساب", group: "finance", kind: "read", capability: "LEDGER_AND_ACCOUNTS", source: "spec",
    note: "ترتيب مستقرّ (createdAt, id) وإلا اختلف الرصيد الجاري بين طلبين متطابقين." },
  { name: "regenerateInvoicePdf", ar: "إعادة توليد PDF الفاتورة", group: "finance", kind: "write", capability: "INVOICES", source: "spec", blockedBy: "B7" },

  // ── الوصول والطلبات (10) ───────────────────────────────────────────
  { name: "addVehicle", ar: "إضافة سيارة", group: "access", kind: "write", capability: "VEHICLES", source: "spec" },
  { name: "approveVehicle", ar: "الموافقة على سيارة", group: "access", kind: "write", capability: "VEHICLES", source: "spec" },
  { name: "rejectVehicle", ar: "رفض سيارة", group: "access", kind: "write", capability: "VEHICLES", source: "spec" },
  { name: "issueBadge", ar: "إصدار باج", group: "access", kind: "write", capability: "BADGES", source: "spec", transactional: true,
    blockedBy: "B3", note: "R36: القيد في نفس المعاملة — لكن على حساب مَن؟ حسابان مفتوحان ممكنان بعد D1." },
  { name: "revokeBadge", ar: "إلغاء باج", group: "access", kind: "write", capability: "BADGES", source: "spec" },
  { name: "createMyRequest", ar: "طلب أو شكوى من الساكن", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "audit",
    note: "نطاق بنيويّ خارج المصفوفة: LEVEL_ACTIONS.OWN يمنح القراءة وحدها. المعرّف من الجلسة، والشقة يجب أن تكون شقّته. ثالث موضع بهذا النمط بعد staff-self وrequestSubscription." },
  { name: "commentOnMyRequest", ar: "تعليق الساكن على طلبه", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "audit",
    note: "isInternal غير موجود في التوقيع أصلاً — لا يُقبَل ثم يُتجاهَل." },
  { name: "createServiceRequest", ar: "إنشاء طلب/شكوى", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec" },
  { name: "routeRequest", ar: "توجيه طلب لقسم", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec" },
  { name: "assignRequest", ar: "تكليف موظف بطلب", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec" },
  { name: "updateRequestStatus", ar: "تغيير حالة طلب", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec" },
  { name: "addRequestComment", ar: "إضافة تعليق على طلب", group: "access", kind: "write", capability: "SERVICE_REQUESTS", source: "spec",
    note: "isInternal يُصفّى على **الخادم** — الترشيح في العميل يعني إرسال التعليق الداخلي فعلاً إلى المتصفح." },

  // ═══ التسعة المفقودة — يطلبها النص ولا توجد في §9.2 ═══════════════
  { name: "createUser", ar: "إنشاء مستخدم (أدمن/موظف/ساكن)", group: "users", kind: "write", capability: "USERS_AND_ROLES", source: "audit",
    note: "🔴 V2 — §3.1 و§7.1/2 و§3.2 تفترضه، والقائمة فيها createResident و createStaff فقط. **بدونه لا مسار إقلاع للنظام** ولا يمرّ تعريف إنجاز P0." },
  { name: "setUserActive", ar: "تفعيل/تعطيل مستخدم", group: "users", kind: "write", capability: "USERS_AND_ROLES", source: "audit",
    note: "🔴 V3 — R2 و§8.2/3 و§10.1 تفترضه. isActive هو **آلية منع الدخول الوحيدة**، وبلا إجراء يضبطه لا سبيل لمنع دخول موظف تُرك عمله." },
  { name: "updateResident", ar: "تعديل بيانات ساكن ورفع مستنداته", group: "people", kind: "write", capability: "RESIDENT_PROFILES", source: "audit",
    note: "V4 — createResident يقبل الصور عند الإنشاء فقط، و§8.2/3 يعدّ الرفع عملية مستقلة." },
  { name: "requestBadge", ar: "طلب باج (ساكن)", group: "access", kind: "write", capability: "BADGES", source: "audit",
    note: "Q37 — §3.3 «طلب باج يُنشئ سجلاً معلّقاً» و BadgeStatus.REQUESTED بلا منشئ من جهة الساكن." },
  { name: "requestSubscriptionCancellation", ar: "طلب إلغاء اشتراك (ساكن)", group: "services", kind: "write", capability: "SUBSCRIPTIONS", source: "audit",
    note: "Q37 — §8.4 يعدّه صراحةً ولا نموذج ولا حالة ولا إجراء." },
  { name: "requestProfileChange", ar: "طلب تعديل بيانات (ساكن)", group: "people", kind: "write", capability: "RESIDENT_PROFILES", source: "audit",
    note: "Q37 — §3.2 «قراءة + طلب تغيير» بلا مسار إطلاقاً." },
  { name: "cancelPayment", ar: "إلغاء دفعة", group: "finance", kind: "write", capability: "LEDGER_AND_ACCOUNTS", source: "audit", transactional: true,
    note: "Q40 — R35 يفترضه و PaymentStatus.CANCELLED موجودة بلا كاتب. الإلغاء بقيد معاكس لا بحذف." },
  { name: "cancelInstallmentPlan", ar: "إلغاء خطة أقساط", group: "contracts", kind: "write", capability: "INSTALLMENT_PLANS", source: "audit",
    note: "Q40 — PlanStatus.CANCELLED و InstallmentStatus.CANCELLED قيمتان بلا كاتب." },
  { name: "bulkSetApartmentConstructionStatus", ar: "تحديث جماعي لحالة الإنشاء", group: "buildings", kind: "write", capability: "APARTMENTS", source: "audit",
    note: "§8.2/1 يطلبه والإجراء الموجود مفرد فقط." },

  // ═══ البيانات المرجعية التنظيمية — كشفتها الخطوة 1.8 ═══════════════
  //
  // §9.2 فيه `createStaff` و`setStaffAvailability` و`setStaffSkills` — أي
  // أنه يفترض وجود **أقسام ومهارات وبائعين** يُختار منها، ولا يذكر أي
  // إجراء يُنشئها. النتيجة: `createStaff` بـ`departmentId` لا سبيل إلى
  // إنشائه، و`setStaffSkills` بمهارة لا وجود لها.
  { name: "createDepartment", ar: "إنشاء قسم", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit",
    note: "§4.6 يعرّف Department و§9.2 يفترض وجوده في منتقي الموظف، بلا إجراء يُنشئه." },
  { name: "listDepartmentTasks", ar: "قائمة مهامّ الأقسام", group: "people", kind: "read", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit" },
  { name: "updateDepartmentTask", ar: "تعديل مهمّة قسم", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit", transactional: true,
    note: "كانت المهمّة تُنشأ ولا تُصحَّح — خطأٌ في اسمها يبقى أبداً." },
  { name: "setDepartmentTaskActive", ar: "إيقاف مهمّة قسم أو تفعيلها", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit", transactional: true,
    note: "لا حذف: كل ServiceRequest يشير إلى مهمّته، والحذف يقتل مراجع لا تُستعاد." },
  { name: "setDepartmentActive", ar: "إيقاف قسم أو تفعيله", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit", transactional: true,
    note: "يُرفض إن كان فيه موظفون — الإيقاف يُخفي القسم ويترك موظفيه بلا موضع ظاهر." },
  { name: "createDepartmentTask", ar: "إنشاء مهمة قسم", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit",
    note: "§7.10/2 يضبط departmentTaskId على الطلب، والقيمة تُختار من قائمة لا كاتب لها. **قائمة مرجعية لا محرّك مهام.**" },
  { name: "createSkill", ar: "إنشاء مهارة", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit",
    note: "setStaffSkills يربط بمهارة، ولا إجراء يُنشئ المهارة نفسها. **ملصق لا وحدة تدريب.**" },
  { name: "createVendor", ar: "إنشاء شركة بائع", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit",
    note: "§4.5 يعرّف Vendor، وvendorId إلزامي عند employmentType = VENDOR — بلا إجراء يُنشئ الشركة يستحيل إنشاء موظف بائع." },
  { name: "setStaffCashPermission", ar: "منح صلاحية قبض النقد", group: "people", kind: "write", capability: "DEPARTMENTS_SKILLS_STAFF", source: "audit",
    note: "Q11 — المنح **فعل صريح مستقلّ** لا حقل في نموذج الإنشاء يُملأ سهواً. B4 محسوم: السحب مرفوض وصندوقه مفتوح." },
]);

export function auditActions() {
  const fromSpec = ACTIONS.filter((a) => a.source === "spec").length;
  const fromAudit = ACTIONS.filter((a) => a.source === "audit").length;
  const blocked = ACTIONS.filter((a) => a.blockedBy);
  const names = new Set(ACTIONS.map((a) => a.name));
  return {
    total: ACTIONS.length,
    fromSpec,
    fromAudit,
    duplicates: ACTIONS.length - names.size,
    blocked: blocked.map((a) => `${a.name} (${a.blockedBy})`),
  };
}
