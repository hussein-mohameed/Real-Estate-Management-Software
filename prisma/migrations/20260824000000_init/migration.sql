-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF', 'RESIDENT');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('INTERNAL', 'FREELANCE', 'VENDOR');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "NumberingScheme" AS ENUM ('SEQUENTIAL', 'PER_FLOOR');

-- CreateEnum
CREATE TYPE "ConstructionStatus" AS ENUM ('UNDER_CONSTRUCTION', 'COMPLETED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('UNSOLD', 'SOLD', 'RENTED_BY_COMPANY');

-- CreateEnum
CREATE TYPE "OccupancyStatus" AS ENUM ('VACANT', 'OCCUPIED_BY_OWNER', 'OCCUPIED_BY_TENANT');

-- CreateEnum
CREATE TYPE "ResidentRelation" AS ENUM ('FAMILY_MEMBER', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('SALE', 'RENTAL');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('FULL', 'INSTALLMENTS');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceBillingType" AS ENUM ('RECURRING', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FLAT', 'PER_UNIT', 'PER_PERSON');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('OWNER', 'OCCUPANT');

-- CreateEnum
CREATE TYPE "ServiceAppliesTo" AS ENUM ('APARTMENT', 'RESIDENT', 'BOTH');

-- CreateEnum
CREATE TYPE "SubscriptionSubjectType" AS ENUM ('APARTMENT', 'RESIDENT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CHARGE', 'PAYMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('SUBSCRIPTION', 'ONE_TIME_SERVICE', 'INSTALLMENT', 'RENT', 'BADGE', 'MANUAL', 'OPENING');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_AT_CENTER', 'WAYL_LINK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "BadgeStatus" AS ENUM ('REQUESTED', 'ISSUED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('SERVICE_REQUEST', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "RequestScope" AS ENUM ('APARTMENT', 'COMMON_AREA');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "ResidentRequestKind" AS ENUM ('BADGE', 'SUBSCRIPTION_CANCELLATION', 'PROFILE_CHANGE');

-- CreateEnum
CREATE TYPE "ResidentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CounterKind" AS ENUM ('INV', 'CTR', 'REQ');

-- CreateTable
CREATE TABLE "CompoundSettings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "billingDayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'IQD',
    "defaultBadgeFeeIqd" BIGINT,
    "installmentReminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompoundSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "supabaseUserId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "gender" "Gender",
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentProfile" (
    "userId" TEXT NOT NULL,
    "nationalIdImageUrl" TEXT,
    "residenceCardImageUrl" TEXT,
    "emergencyPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "userId" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL,
    "vendorId" TEXT,
    "departmentId" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "jobTitle" TEXT,
    "hiredAt" TIMESTAMP(3),
    "canReceiveCash" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "specialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "managerUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentTask" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSkill" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL,
    "needsTraining" BOOLEAN NOT NULL DEFAULT false,
    "hasTrained" BOOLEAN NOT NULL DEFAULT false,
    "trainingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "floorsCount" INTEGER NOT NULL,
    "unitsPerFloor" INTEGER NOT NULL,
    "numberingScheme" "NumberingScheme" NOT NULL,
    "displayNumberFormat" TEXT NOT NULL DEFAULT '{building}-{floor}-{unit}',
    "plannedApartmentsCount" INTEGER,
    "constructionStatus" "ConstructionStatus" NOT NULL DEFAULT 'UNDER_CONSTRUCTION',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorUnitsOverride" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "unitsCount" INTEGER NOT NULL,

    CONSTRAINT "FloorUnitsOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Apartment" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "unitNumber" INTEGER NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "displayNumberLocked" BOOLEAN NOT NULL DEFAULT false,
    "companyCode" TEXT,
    "areaSqm" DECIMAL(10,2),
    "roomsCount" INTEGER,
    "constructionStatus" "ConstructionStatus" NOT NULL DEFAULT 'UNDER_CONSTRUCTION',
    "completionPercentage" INTEGER,
    "ownershipStatus" "OwnershipStatus" NOT NULL DEFAULT 'UNSOLD',
    "occupancyStatus" "OccupancyStatus" NOT NULL DEFAULT 'VACANT',
    "occupancyChangedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "priceIqd" BIGINT,
    "paymentType" "PaymentType",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Apartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentResident" (
    "id" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relationType" "ResidentRelation" NOT NULL,
    "isContractHolder" BOOLEAN NOT NULL DEFAULT false,
    "movedInAt" TIMESTAMP(3) NOT NULL,
    "movedOutAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentResident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "holderUserId" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "totalAmountIqd" BIGINT,
    "paymentType" "PaymentType",
    "rentAmountIqd" BIGINT,
    "rentCycle" "BillingCycle",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "totalAmountIqd" BIGINT NOT NULL,
    "downPaymentIqd" BIGINT,
    "installmentsCount" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountIqd" BIGINT NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "followUpStaffId" TEXT,
    "lastFollowUpAt" TIMESTAMP(3),
    "followUpNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconKey" TEXT,
    "billingType" "ServiceBillingType" NOT NULL,
    "billingCycle" "BillingCycle",
    "pricingModel" "PricingModel" NOT NULL,
    "basePriceIqd" BIGINT,
    "unitLabel" TEXT,
    "unitPriceIqd" BIGINT,
    "minUnits" INTEGER,
    "maxUnits" INTEGER,
    "payerType" "PayerType" NOT NULL DEFAULT 'OCCUPANT',
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" "ServiceAppliesTo" NOT NULL DEFAULT 'APARTMENT',
    "customFieldsSchema" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "subjectType" "SubscriptionSubjectType" NOT NULL,
    "apartmentId" TEXT,
    "residentUserId" TEXT,
    "accountId" TEXT,
    "payerType" "PayerType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceSnapshotIqd" BIGINT NOT NULL,
    "periodAmountIqd" BIGINT NOT NULL,
    "billingCycle" "BillingCycle",
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextChargeDate" TIMESTAMP(3),
    "lastChargedPeriodStart" TIMESTAMP(3),
    "customFieldValues" JSONB,
    "requestedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "holderUserId" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "balanceIqd" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "amountIqd" BIGINT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "subscriptionId" TEXT,
    "installmentId" TEXT,
    "badgeId" TEXT,
    "paymentId" TEXT,
    "createdByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountIqd" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "purpose" "LedgerSource" NOT NULL,
    "installmentId" TEXT,
    "referenceId" TEXT NOT NULL,
    "waylLinkId" TEXT,
    "waylPaymentUrl" TEXT,
    "waylRawPayload" JSONB,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "receivedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalIqd" BIGINT NOT NULL,
    "lines" JSONB NOT NULL,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "kind" "CounterKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("kind","year")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "plateNumber" TEXT NOT NULL,
    "plateProvince" TEXT,
    "make" TEXT,
    "model" TEXT,
    "color" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "code" TEXT,
    "status" "BadgeStatus" NOT NULL DEFAULT 'REQUESTED',
    "feeIqd" BIGINT,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "apartmentId" TEXT,
    "scope" "RequestScope" NOT NULL DEFAULT 'APARTMENT',
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "departmentId" TEXT,
    "departmentTaskId" TEXT,
    "assignedStaffId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "resolutionNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "ratedStars" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestComment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentRequest" (
    "id" TEXT NOT NULL,
    "kind" "ResidentRequestKind" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ResidentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "uploadedByUserId" TEXT,
    "apartmentId" TEXT,
    "contractId" TEXT,
    "serviceRequestId" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "StaffProfile_departmentId_idx" ON "StaffProfile"("departmentId");

-- CreateIndex
CREATE INDEX "StaffProfile_vendorId_idx" ON "StaffProfile"("vendorId");

-- CreateIndex
CREATE INDEX "StaffProfile_isAvailable_idx" ON "StaffProfile"("isAvailable");

-- CreateIndex
CREATE INDEX "StaffProfile_canReceiveCash_idx" ON "StaffProfile"("canReceiveCash");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE INDEX "Department_managerUserId_idx" ON "Department"("managerUserId");

-- CreateIndex
CREATE INDEX "DepartmentTask_departmentId_idx" ON "DepartmentTask"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentTask_departmentId_name_key" ON "DepartmentTask"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "StaffSkill_skillId_idx" ON "StaffSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSkill_staffProfileId_skillId_key" ON "StaffSkill"("staffProfileId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "Building_code_key" ON "Building"("code");

-- CreateIndex
CREATE INDEX "FloorUnitsOverride_buildingId_idx" ON "FloorUnitsOverride"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorUnitsOverride_buildingId_floorNumber_key" ON "FloorUnitsOverride"("buildingId", "floorNumber");

-- CreateIndex
CREATE INDEX "Apartment_buildingId_floorNumber_idx" ON "Apartment"("buildingId", "floorNumber");

-- CreateIndex
CREATE INDEX "Apartment_constructionStatus_idx" ON "Apartment"("constructionStatus");

-- CreateIndex
CREATE INDEX "Apartment_ownershipStatus_idx" ON "Apartment"("ownershipStatus");

-- CreateIndex
CREATE INDEX "Apartment_occupancyStatus_idx" ON "Apartment"("occupancyStatus");

-- CreateIndex
CREATE INDEX "Apartment_displayNumber_idx" ON "Apartment"("displayNumber");

-- CreateIndex
CREATE INDEX "Apartment_deletedAt_idx" ON "Apartment"("deletedAt");

-- CreateIndex
CREATE INDEX "ApartmentResident_apartmentId_isActive_idx" ON "ApartmentResident"("apartmentId", "isActive");

-- CreateIndex
CREATE INDEX "ApartmentResident_userId_isActive_idx" ON "ApartmentResident"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- CreateIndex
CREATE INDEX "Contract_apartmentId_type_status_idx" ON "Contract"("apartmentId", "type", "status");

-- CreateIndex
CREATE INDEX "Contract_holderUserId_idx" ON "Contract"("holderUserId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_deletedAt_idx" ON "Contract"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_contractId_key" ON "InstallmentPlan"("contractId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_status_idx" ON "InstallmentPlan"("status");

-- CreateIndex
CREATE INDEX "Installment_followUpStaffId_status_idx" ON "Installment"("followUpStaffId", "status");

-- CreateIndex
CREATE INDEX "Installment_status_dueDate_idx" ON "Installment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Installment_paymentId_idx" ON "Installment"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_planId_sequence_key" ON "Installment"("planId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");

-- CreateIndex
CREATE INDEX "Service_isAvailable_idx" ON "Service"("isAvailable");

-- CreateIndex
CREATE INDEX "Service_isMandatory_idx" ON "Service"("isMandatory");

-- CreateIndex
CREATE INDEX "Subscription_serviceId_status_idx" ON "Subscription"("serviceId", "status");

-- CreateIndex
CREATE INDEX "Subscription_apartmentId_status_idx" ON "Subscription"("apartmentId", "status");

-- CreateIndex
CREATE INDEX "Subscription_accountId_idx" ON "Subscription"("accountId");

-- CreateIndex
CREATE INDEX "Subscription_residentUserId_idx" ON "Subscription"("residentUserId");

-- CreateIndex
CREATE INDEX "Subscription_status_nextChargeDate_idx" ON "Subscription"("status", "nextChargeDate");

-- CreateIndex
CREATE INDEX "Subscription_deletedAt_idx" ON "Subscription"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_contractId_key" ON "Account"("contractId");

-- CreateIndex
CREATE INDEX "Account_apartmentId_status_idx" ON "Account"("apartmentId", "status");

-- CreateIndex
CREATE INDEX "Account_holderUserId_idx" ON "Account"("holderUserId");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_subscriptionId_idx" ON "LedgerEntry"("subscriptionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_installmentId_idx" ON "LedgerEntry"("installmentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_badgeId_idx" ON "LedgerEntry"("badgeId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_source_idx" ON "LedgerEntry"("source");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_referenceId_key" ON "Payment"("referenceId");

-- CreateIndex
CREATE INDEX "Payment_accountId_status_idx" ON "Payment"("accountId", "status");

-- CreateIndex
CREATE INDEX "Payment_status_expiresAt_idx" ON "Payment"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Payment_receivedByUserId_paidAt_idx" ON "Payment"("receivedByUserId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentId_key" ON "Invoice"("paymentId");

-- CreateIndex
CREATE INDEX "Invoice_accountId_issuedAt_idx" ON "Invoice"("accountId", "issuedAt");

-- CreateIndex
CREATE INDEX "Vehicle_plateNumber_idx" ON "Vehicle"("plateNumber");

-- CreateIndex
CREATE INDEX "Vehicle_apartmentId_status_idx" ON "Vehicle"("apartmentId", "status");

-- CreateIndex
CREATE INDEX "Vehicle_ownerUserId_idx" ON "Vehicle"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_code_key" ON "Badge"("code");

-- CreateIndex
CREATE INDEX "Badge_vehicleId_status_idx" ON "Badge"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "Badge_status_expiresAt_idx" ON "Badge"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Badge_issuedByUserId_idx" ON "Badge"("issuedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_number_key" ON "ServiceRequest"("number");

-- CreateIndex
CREATE INDEX "ServiceRequest_assignedStaffId_status_idx" ON "ServiceRequest"("assignedStaffId", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_apartmentId_status_idx" ON "ServiceRequest"("apartmentId", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_departmentId_status_idx" ON "ServiceRequest"("departmentId", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_priority_idx" ON "ServiceRequest"("status", "priority");

-- CreateIndex
CREATE INDEX "ServiceRequest_createdByUserId_idx" ON "ServiceRequest"("createdByUserId");

-- CreateIndex
CREATE INDEX "RequestComment_requestId_createdAt_idx" ON "RequestComment"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestComment_authorUserId_idx" ON "RequestComment"("authorUserId");

-- CreateIndex
CREATE INDEX "ResidentRequest_status_kind_idx" ON "ResidentRequest"("status", "kind");

-- CreateIndex
CREATE INDEX "ResidentRequest_createdByUserId_status_idx" ON "ResidentRequest"("createdByUserId", "status");

-- CreateIndex
CREATE INDEX "Attachment_apartmentId_idx" ON "Attachment"("apartmentId");

-- CreateIndex
CREATE INDEX "Attachment_contractId_idx" ON "Attachment"("contractId");

-- CreateIndex
CREATE INDEX "Attachment_serviceRequestId_idx" ON "Attachment"("serviceRequestId");

-- CreateIndex
CREATE INDEX "Attachment_paymentId_idx" ON "Attachment"("paymentId");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_templateKey_idx" ON "Notification"("templateKey");

-- CreateIndex
CREATE INDEX "OtpCode_phone_createdAt_idx" ON "OtpCode"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginLink_tokenHash_key" ON "LoginLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginLink_userId_idx" ON "LoginLink"("userId");

-- CreateIndex
CREATE INDEX "LoginLink_expiresAt_idx" ON "LoginLink"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitHit_bucketKey_createdAt_idx" ON "RateLimitHit"("bucketKey", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentProfile" ADD CONSTRAINT "ResidentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentTask" ADD CONSTRAINT "DepartmentTask_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSkill" ADD CONSTRAINT "StaffSkill_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSkill" ADD CONSTRAINT "StaffSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorUnitsOverride" ADD CONSTRAINT "FloorUnitsOverride_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartment" ADD CONSTRAINT "Apartment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentResident" ADD CONSTRAINT "ApartmentResident_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentResident" ADD CONSTRAINT "ApartmentResident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_followUpStaffId_fkey" FOREIGN KEY ("followUpStaffId") REFERENCES "StaffProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_residentUserId_fkey" FOREIGN KEY ("residentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_departmentTaskId_fkey" FOREIGN KEY ("departmentTaskId") REFERENCES "DepartmentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "StaffProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestComment" ADD CONSTRAINT "RequestComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestComment" ADD CONSTRAINT "RequestComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentRequest" ADD CONSTRAINT "ResidentRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentRequest" ADD CONSTRAINT "ResidentRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLink" ADD CONSTRAINT "LoginLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══ القيود التي لا يعبّر عنها Prisma ═══

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

-- N3 — قيد افتتاحي واحد لكل حساب عند الترحيل، لا أكثر.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_opening_entry_per_account"
  ON "LedgerEntry" ("accountId")
  WHERE "source" = 'OPENING';

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

DO $$
BEGIN
  -- D2/3 — المبالغ موجبة **دائماً بلا استثناء**. الاتجاه يحمله type وحده،
  -- فصيغة الرصيد بلا أي فرع للإشارة — وهذا يزيل أكثر موضع محتمل للخطأ.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_amount_positive') THEN
    ALTER TABLE "LedgerEntry"
      ADD CONSTRAINT "ledger_amount_positive" CHECK ("amountIqd" > 0);
  END IF;

  -- D2/1 — لا تسوية يدوية بلا سبب مكتوب.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_manual_needs_reason') THEN
    ALTER TABLE "LedgerEntry"
      ADD CONSTRAINT "ledger_manual_needs_reason"
      CHECK ("source" <> 'MANUAL' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));
  END IF;

  -- الدفعة والفاتورة موجبتان أيضاً.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_amount_positive') THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amountIqd" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_total_positive') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_total_positive" CHECK ("totalIqd" > 0);
  END IF;

  -- الخطوة 0.5 — لا فحص لهذين في المخطّط إطلاقاً.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_rating_range') THEN
    ALTER TABLE "ServiceRequest"
      ADD CONSTRAINT "request_rating_range"
      CHECK ("ratedStars" IS NULL OR ("ratedStars" BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apartment_completion_range') THEN
    ALTER TABLE "Apartment"
      ADD CONSTRAINT "apartment_completion_range"
      CHECK ("completionPercentage" IS NULL OR ("completionPercentage" BETWEEN 0 AND 100));
  END IF;

  -- إلزامية ملاحظة الحل للانتقال إلى DONE — تُفرض في الخادم **وهنا**.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_done_needs_resolution') THEN
    ALTER TABLE "ServiceRequest"
      ADD CONSTRAINT "request_done_needs_resolution"
      CHECK ("status" <> 'DONE' OR ("resolutionNote" IS NOT NULL AND length(btrim("resolutionNote")) > 0));
  END IF;

  -- Q35 — طلب الشقة يحتاج شقة، وطلب المنطقة المشتركة لا يحملها.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_scope_apartment') THEN
    ALTER TABLE "ServiceRequest"
      ADD CONSTRAINT "request_scope_apartment"
      CHECK (
        ("scope" = 'APARTMENT'   AND "apartmentId" IS NOT NULL) OR
        ("scope" = 'COMMON_AREA' AND "apartmentId" IS NULL)
      );
  END IF;

  -- S5/Q28 — الكود يُسنَد عند الإصدار. باج ISSUED بلا كود غير قابل للتشغيل.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'badge_issued_needs_code') THEN
    ALTER TABLE "Badge"
      ADD CONSTRAINT "badge_issued_needs_code"
      CHECK ("status" <> 'ISSUED' OR "code" IS NOT NULL);
  END IF;

  -- §4.4 — vendorId إلزامي عندما employmentType = VENDOR.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_vendor_requires_vendor') THEN
    ALTER TABLE "StaffProfile"
      ADD CONSTRAINT "staff_vendor_requires_vendor"
      CHECK ("employmentType" <> 'VENDOR' OR "vendorId" IS NOT NULL);
  END IF;

  -- §4.14 — الاشتراك على شقة يحتاج شقة، وعلى ساكن يحتاج ساكناً.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_subject_consistent') THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT "subscription_subject_consistent"
      CHECK (
        ("subjectType" = 'APARTMENT' AND "apartmentId" IS NOT NULL) OR
        ("subjectType" = 'RESIDENT'  AND "residentUserId" IS NOT NULL AND "apartmentId" IS NOT NULL)
      );
  END IF;

  -- الاشتراك النشط يجب أن يحمل حساباً. القابلية لـnull للطلب المعلّق فقط.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_active_needs_account') THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT "subscription_active_needs_account"
      CHECK ("status" = 'PENDING_APPROVAL' OR "accountId" IS NOT NULL);
  END IF;

  -- §4.13 — توافقات نموذج التسعير. JSON غير مُتحقَّق منه ينفجر في نموذج
  -- المستخدم لا هنا؛ هذه تمنعه من الدخول أصلاً.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_recurring_needs_cycle') THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "service_recurring_needs_cycle"
      CHECK ("billingType" <> 'RECURRING' OR "billingCycle" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_pricing_fields') THEN
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_mandatory_not_resident_only') THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "service_mandatory_not_resident_only"
      CHECK (NOT ("isMandatory" AND "appliesTo" = 'RESIDENT'));
  END IF;

  -- الأقساط والمبالغ المرجعية موجبة.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'installment_amount_positive') THEN
    ALTER TABLE "Installment"
      ADD CONSTRAINT "installment_amount_positive" CHECK ("amountIqd" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_count_positive') THEN
    ALTER TABLE "InstallmentPlan"
      ADD CONSTRAINT "plan_count_positive"
      CHECK ("installmentsCount" >= 1 AND "intervalMonths" >= 1);
  END IF;

  -- §4.1 — يوم الفوترة ضمن المدى. 31 في شهر أقصر يُثبَّت على آخر يوم
  -- في lib/dates، لكن القيمة نفسها يجب أن تبقى صالحة.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_billing_day_range') THEN
    ALTER TABLE "CompoundSettings"
      ADD CONSTRAINT "settings_billing_day_range"
      CHECK ("billingDayOfMonth" BETWEEN 1 AND 31);
  END IF;

  -- §4.8 — بناية بلا طوابق أو بلا وحدات لا معنى لها.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_dimensions_positive') THEN
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
CREATE TRIGGER "invoice_no_delete"
  BEFORE DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
