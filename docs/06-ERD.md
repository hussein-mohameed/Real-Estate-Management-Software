# مخطّط العلاقات

> **مُولَّد من `prisma/schema.prisma`** — لا يُحرَّر بيد. أعد التوليد بـ`npm run erd`.
> **آخر توليد:** 2026-08-24
> **الإحصاء:** 35 جدولاً · 37 نوعاً · 59 علاقة موجَّهة.

## كيف يُقرأ

`A ||--o{ B` تعني: **B يحمل المفتاح الأجنبي** إلى A. الاسم على السهم هو حقل العلاقة.
`|o` بدل `||` تعني أن المفتاح **قابل لـnull** — أي أن الصف قد يوجد بلا هذا الربط، وهذا في حدّ ذاته قرار مجال لا تفصيل تقني.

---

## النظرة العامة — المحاور الأربعة

هذه الكيانات الستة عشر هي ما يجري عليه العمل يومياً. الباقي مرجعي أو عرضي.

```mermaid
erDiagram
  User |o--o{ User : "createdBy"
  Building ||--o{ Apartment : "building"
  Apartment ||--o{ ApartmentResident : "apartment"
  User ||--o{ ApartmentResident : "user"
  Apartment ||--o{ Contract : "apartment"
  User ||--o{ Contract : "holder"
  Contract ||--o{ InstallmentPlan : "contract"
  InstallmentPlan ||--o{ Installment : "plan"
  Payment |o--o{ Installment : "payment"
  Service ||--o{ Subscription : "service"
  Apartment |o--o{ Subscription : "apartment"
  User |o--o{ Subscription : "residentUser"
  Account |o--o{ Subscription : "account"
  User |o--o{ Subscription : "requestedBy"
  User |o--o{ Subscription : "approvedBy"
  Contract ||--o{ Account : "contract"
  Apartment ||--o{ Account : "apartment"
  User ||--o{ Account : "holder"
  Account ||--o{ LedgerEntry : "account"
  Subscription |o--o{ LedgerEntry : "subscription"
  Installment |o--o{ LedgerEntry : "installment"
  Badge |o--o{ LedgerEntry : "badge"
  Payment |o--o{ LedgerEntry : "payment"
  User |o--o{ LedgerEntry : "createdBy"
  Account ||--o{ Payment : "account"
  User |o--o{ Payment : "receivedBy"
  Payment ||--o{ Invoice : "payment"
  Account ||--o{ Invoice : "account"
  Apartment ||--o{ Vehicle : "apartment"
  User |o--o{ Vehicle : "owner"
  Vehicle ||--o{ Badge : "vehicle"
  User |o--o{ Badge : "issuedBy"
  Apartment |o--o{ ServiceRequest : "apartment"
  User ||--o{ ServiceRequest : "createdBy"
```

**ثلاث حقائق يقولها هذا الرسم وحده:**

1. **`Account` يتدلّى من `Contract` لا من `Apartment`.** هذا المبدأ 3 مرسوماً: مالك جديد أو مستأجر جديد **لا يرث** رصيد سابقه أبداً.
2. **`Apartment` له `Contract` متعدّد.** بعد `S1`/`D1` يجوز عقد بيع وعقد إيجار نشطان معاً — «شقة مباعة يسكنها مستأجر». والفهرس الفريد الجزئي هو ما يمنع الثاني **من نفس النوع**.
3. **`LedgerEntry` يشير إلى أربعة مصادر** (`Subscription` · `Installment` · `Badge` · `Payment`) وكلها **قابلة لـnull** — لأن القيد قد يكون يدوياً أو افتتاحياً بلا أي مصدر منها.


---

## الإعدادات

```mermaid
erDiagram
  CompoundSettings {
    String id PK
    String name
    String_nullable logoUrl
    String_nullable address
    String_nullable phone
    String invoicePrefix
    Int billingDayOfMonth
    String currency
    BigInt_nullable defaultBadgeFeeIqd
    Int installmentReminderDaysBefore
    DateTime updatedAt
  }
  Setting {
    String key PK
    Json value
    DateTime updatedAt
  }
  Counter {
    Int year
    Int lastValue
    DateTime updatedAt
  }
```


---

## الهوية والتنظيم

```mermaid
erDiagram
  User {
    String id PK
    String_nullable supabaseUserId UK
    String fullName
    String phone UK
    String_nullable email UK
    String_nullable avatarUrl
    Boolean isActive
    DateTime_nullable lastLoginAt
    String_nullable createdByUserId
    String_nullable notes
    DateTime createdAt
    DateTime updatedAt
  }
  ResidentProfile {
    String userId PK
    String_nullable nationalIdImageUrl
    String_nullable residenceCardImageUrl
    String_nullable emergencyPhone
    String_nullable notes
    DateTime createdAt
    DateTime updatedAt
  }
  StaffProfile {
    String userId PK
    String_nullable vendorId
    String_nullable departmentId
    Boolean isAvailable
    String_nullable jobTitle
    DateTime_nullable hiredAt
    Boolean canReceiveCash
    DateTime createdAt
    DateTime updatedAt
  }
  Vendor {
    String id PK
    String name
    String_nullable contactPerson
    String_nullable phone
    String_nullable specialty
    Boolean isActive
    DateTime createdAt
    DateTime updatedAt
  }
  Department {
    String id PK
    String name UK
    String_nullable description
    String_nullable managerUserId
    Boolean isActive
    DateTime createdAt
    DateTime updatedAt
  }
  DepartmentTask {
    String id PK
    String departmentId
    String name
    String_nullable description
    Boolean isActive
    DateTime createdAt
    DateTime updatedAt
  }
  Skill {
    String id PK
    String name UK
    Boolean isActive
    DateTime createdAt
    DateTime updatedAt
  }
  StaffSkill {
    String id PK
    String staffProfileId
    String skillId
    Boolean needsTraining
    Boolean hasTrained
    String_nullable trainingNote
    DateTime createdAt
    DateTime updatedAt
  }
  OtpCode {
    String id PK
    String phone
    String codeHash
    DateTime expiresAt
    DateTime_nullable consumedAt
    Int attempts
    String_nullable requestIp
    DateTime createdAt
  }
  LoginLink {
    String id PK
    String userId
    String tokenHash UK
    DateTime expiresAt
    DateTime_nullable consumedAt
    String_nullable createdByUserId
    DateTime createdAt
  }
  RateLimitHit {
    String id PK
    String bucketKey
    DateTime createdAt
  }
  User |o--o{ User : "createdBy"
  User ||--o{ ResidentProfile : "user"
  User ||--o{ StaffProfile : "user"
  Vendor |o--o{ StaffProfile : "vendor"
  Department |o--o{ StaffProfile : "department"
  User |o--o{ Department : "manager"
  Department ||--o{ DepartmentTask : "department"
  StaffProfile ||--o{ StaffSkill : "staffProfile"
  Skill ||--o{ StaffSkill : "skill"
  User ||--o{ LoginLink : "user"
```


---

## العقار

```mermaid
erDiagram
  Building {
    String id PK
    String code UK
    String_nullable name
    Int floorsCount
    Int unitsPerFloor
    String displayNumberFormat
    Int_nullable plannedApartmentsCount
    String_nullable notes
    DateTime createdAt
    DateTime updatedAt
  }
  FloorUnitsOverride {
    String id PK
    String buildingId
    Int floorNumber
    Int unitsCount
  }
  Apartment {
    String id PK
    String buildingId
    Int floorNumber
    Int unitNumber
    String displayNumber
    Boolean displayNumberLocked
    String_nullable companyCode
    Decimal_nullable areaSqm
    Int_nullable roomsCount
    Int_nullable completionPercentage
    DateTime_nullable occupancyChangedAt
    DateTime_nullable deliveredAt
    BigInt_nullable priceIqd
    String_nullable notes
    _ ويتبقّى_3_حقلاً
  }
  ApartmentResident {
    String id PK
    String apartmentId
    String userId
    Boolean isContractHolder
    DateTime movedInAt
    DateTime_nullable movedOutAt
    Boolean isActive
    DateTime createdAt
    DateTime updatedAt
  }
  Building ||--o{ FloorUnitsOverride : "building"
  Building ||--o{ Apartment : "building"
  Apartment ||--o{ ApartmentResident : "apartment"
```


---

## العقود والأقساط

```mermaid
erDiagram
  Contract {
    String id PK
    String contractNumber UK
    String apartmentId
    String holderUserId
    DateTime startDate
    DateTime_nullable endDate
    BigInt_nullable totalAmountIqd
    BigInt_nullable rentAmountIqd
    String_nullable notes
    DateTime createdAt
    DateTime updatedAt
    DateTime_nullable deletedAt
  }
  InstallmentPlan {
    String id PK
    String contractId UK
    BigInt totalAmountIqd
    BigInt_nullable downPaymentIqd
    Int installmentsCount
    Int intervalMonths
    DateTime startDate
    DateTime createdAt
    DateTime updatedAt
  }
  Installment {
    String id PK
    String planId
    Int sequence
    DateTime dueDate
    BigInt amountIqd
    DateTime_nullable paidAt
    String_nullable paymentId
    String_nullable followUpStaffId
    DateTime_nullable lastFollowUpAt
    String_nullable followUpNote
    DateTime createdAt
    DateTime updatedAt
  }
  Contract ||--o{ InstallmentPlan : "contract"
  InstallmentPlan ||--o{ Installment : "plan"
```


---

## الخدمات والاشتراكات

```mermaid
erDiagram
  Service {
    String id PK
    String name UK
    String_nullable description
    String_nullable iconKey
    BigInt_nullable basePriceIqd
    String_nullable unitLabel
    BigInt_nullable unitPriceIqd
    Int_nullable minUnits
    Int_nullable maxUnits
    Boolean isMandatory
    Boolean isAvailable
    Json_nullable customFieldsSchema
    String_nullable notes
    DateTime createdAt
    _ ويتبقّى_1_حقلاً
  }
  Subscription {
    String id PK
    String serviceId
    String_nullable apartmentId
    String_nullable residentUserId
    String_nullable accountId
    Int quantity
    BigInt unitPriceSnapshotIqd
    BigInt periodAmountIqd
    DateTime startDate
    DateTime_nullable endDate
    DateTime_nullable nextChargeDate
    DateTime_nullable lastChargedPeriodStart
    Json_nullable customFieldValues
    String_nullable requestedByUserId
    _ ويتبقّى_5_حقلاً
  }
  Service ||--o{ Subscription : "service"
```


---

## المال

```mermaid
erDiagram
  Account {
    String id PK
    String contractId UK
    String apartmentId
    String holderUserId
    DateTime openedAt
    DateTime_nullable closedAt
    BigInt balanceIqd
    DateTime createdAt
    DateTime updatedAt
  }
  LedgerEntry {
    String id PK
    String accountId
    BigInt amountIqd
    String descriptionAr
    DateTime_nullable periodStart
    DateTime_nullable periodEnd
    String_nullable subscriptionId
    String_nullable installmentId
    String_nullable badgeId
    String_nullable paymentId
    String_nullable createdByUserId
    String_nullable reason
    DateTime createdAt
  }
  Payment {
    String id PK
    String accountId
    BigInt amountIqd
    String_nullable installmentId
    String referenceId UK
    String_nullable waylLinkId
    String_nullable waylPaymentUrl
    Json_nullable waylRawPayload
    DateTime_nullable expiresAt
    DateTime_nullable paidAt
    String_nullable receivedByUserId
    String_nullable notes
    DateTime createdAt
    DateTime updatedAt
  }
  Invoice {
    String id PK
    String number UK
    String paymentId UK
    String accountId
    DateTime issuedAt
    BigInt totalIqd
    Json lines
    String_nullable pdfUrl
    DateTime createdAt
  }
  Account ||--o{ LedgerEntry : "account"
  Payment |o--o{ LedgerEntry : "payment"
  Account ||--o{ Payment : "account"
  Payment ||--o{ Invoice : "payment"
  Account ||--o{ Invoice : "account"
```


---

## الوصول

```mermaid
erDiagram
  Vehicle {
    String id PK
    String apartmentId
    String_nullable ownerUserId
    String plateNumber
    String_nullable plateProvince
    String_nullable make
    String_nullable model
    String_nullable color
    String_nullable notes
    DateTime createdAt
    DateTime updatedAt
  }
  Badge {
    String id PK
    String vehicleId
    String_nullable code UK
    BigInt_nullable feeIqd
    DateTime_nullable issuedAt
    String_nullable issuedByUserId
    DateTime_nullable expiresAt
    DateTime_nullable revokedAt
    String_nullable revokeReason
    DateTime createdAt
    DateTime updatedAt
  }
  Vehicle ||--o{ Badge : "vehicle"
```


---

## الطلبات

```mermaid
erDiagram
  ServiceRequest {
    String id PK
    String number UK
    String_nullable apartmentId
    String createdByUserId
    String title
    String description
    String_nullable departmentId
    String_nullable departmentTaskId
    String_nullable assignedStaffId
    String_nullable resolutionNote
    DateTime_nullable closedAt
    Int_nullable ratedStars
    DateTime createdAt
    DateTime updatedAt
  }
  RequestComment {
    String id PK
    String requestId
    String authorUserId
    String body
    Boolean isInternal
    DateTime createdAt
  }
  ResidentRequest {
    String id PK
    String createdByUserId
    Json payload
    String_nullable reviewedByUserId
    DateTime_nullable reviewedAt
    String_nullable reviewNote
    DateTime createdAt
    DateTime updatedAt
  }
  ServiceRequest ||--o{ RequestComment : "request"
```


---

## العرضية

```mermaid
erDiagram
  Attachment {
    String id PK
    String url
    String bucket
    String fileName
    String mimeType
    Int sizeBytes
    Boolean isPrivate
    String_nullable uploadedByUserId
    String_nullable apartmentId
    String_nullable contractId
    String_nullable serviceRequestId
    String_nullable paymentId
    DateTime createdAt
  }
  Notification {
    String id PK
    String userId
    String templateKey
    Json payload
    String body
    String_nullable providerMessageId
    String_nullable error
    Int retryCount
    DateTime_nullable sentAt
    DateTime_nullable readAt
    DateTime createdAt
  }
  AuditLog {
    String id PK
    String_nullable actorUserId
    String action
    String entityType
    String_nullable entityId
    Json_nullable before
    Json_nullable after
    String_nullable ip
    String_nullable userAgent
    DateTime createdAt
  }
```


---

## الأنواع المعدودة (37)

- **`UserRole`** — OWNER · ADMIN · STAFF · RESIDENT
- **`Gender`** — MALE · FEMALE
- **`EmploymentType`** — INTERNAL · FREELANCE · VENDOR
- **`SkillLevel`** — BEGINNER · INTERMEDIATE · ADVANCED · EXPERT
- **`NumberingScheme`** — SEQUENTIAL · PER_FLOOR
- **`ConstructionStatus`** — UNDER_CONSTRUCTION · COMPLETED · DELIVERED
- **`OwnershipStatus`** — UNSOLD · SOLD · RENTED_BY_COMPANY
- **`OccupancyStatus`** — VACANT · OCCUPIED_BY_OWNER · OCCUPIED_BY_TENANT
- **`ResidentRelation`** — FAMILY_MEMBER · OTHER
- **`ContractType`** — SALE · RENTAL
- **`ContractStatus`** — DRAFT · ACTIVE · EXPIRED · TERMINATED
- **`PaymentType`** — FULL · INSTALLMENTS
- **`PlanStatus`** — ACTIVE · COMPLETED · CANCELLED
- **`InstallmentStatus`** — PENDING · PAID · OVERDUE · CANCELLED
- **`ServiceBillingType`** — RECURRING · ONE_TIME
- **`BillingCycle`** — MONTHLY · QUARTERLY · YEARLY
- **`PricingModel`** — FLAT · PER_UNIT · PER_PERSON
- **`PayerType`** — OWNER · OCCUPANT
- **`ServiceAppliesTo`** — APARTMENT · RESIDENT · BOTH
- **`SubscriptionSubjectType`** — APARTMENT · RESIDENT
- **`SubscriptionStatus`** — PENDING_APPROVAL · ACTIVE · PAUSED · CANCELLED
- **`AccountStatus`** — OPEN · CLOSED
- **`LedgerEntryType`** — CHARGE · PAYMENT · ADJUSTMENT
- **`LedgerSource`** — SUBSCRIPTION · ONE_TIME_SERVICE · INSTALLMENT · RENT · BADGE · MANUAL · OPENING
- **`PaymentMethod`** — CASH_AT_CENTER · WAYL_LINK
- **`PaymentStatus`** — PENDING · PAID · FAILED · EXPIRED · CANCELLED
- **`VehicleStatus`** — PENDING_APPROVAL · APPROVED · REJECTED · REMOVED
- **`BadgeStatus`** — REQUESTED · ISSUED · REVOKED · EXPIRED
- **`RequestType`** — SERVICE_REQUEST · COMPLAINT
- **`RequestScope`** — APARTMENT · COMMON_AREA
- **`RequestStatus`** — NEW · ASSIGNED · IN_PROGRESS · DONE · CANCELLED
- **`Priority`** — LOW · NORMAL · HIGH
- **`ResidentRequestKind`** — BADGE · SUBSCRIPTION_CANCELLATION · PROFILE_CHANGE
- **`ResidentRequestStatus`** — PENDING · APPROVED · REJECTED
- **`NotificationChannel`** — WHATSAPP · IN_APP
- **`NotificationStatus`** — PENDING · SENT · FAILED
- **`CounterKind`** — INV · CTR · REQ
