-- Extensión antes de las columnas geography.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('WEB', 'MOBILE', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPERADMIN', 'REVIEWER', 'OPERATIONS', 'SECURITY');

-- CreateEnum
CREATE TYPE "AccessInvitePurpose" AS ENUM ('RESTAURANT_MEMBERSHIP', 'ADMIN');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EstablishmentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CourierStatus" AS ENUM ('REGISTERING', 'PENDING_VERIFICATION', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('OPEN', 'INVITATION');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('CC', 'CE');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'CONSUMED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "CourierDocumentType" AS ENUM ('NATIONAL_ID', 'DRIVER_LICENSE', 'SOAT', 'TECH_INSPECTION', 'VEHICLE_PHOTO', 'PROFILE_PHOTO');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AvailabilityState" AS ENUM ('OFFLINE', 'AVAILABLE', 'ON_SERVICE');

-- CreateEnum
CREATE TYPE "LocationPurpose" AS ENUM ('AVAILABILITY', 'ACTIVE_SERVICE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('COLLECTING', 'SUBMITTED', 'AUTO_IN_PROGRESS', 'PENDING_HUMAN', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CheckOutcome" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_CHANGES');

-- CreateEnum
CREATE TYPE "LegalDocumentKind" AS ENUM ('PRIVACY_NOTICE', 'TERMS', 'GEOLOCATION_CONSENT', 'DOCUMENT_PROCESSING');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('ACCOUNT', 'GEOLOCATION', 'DOCUMENT_STORAGE', 'ORDER_CONTACT');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('WEB', 'MOBILE', 'ADMIN');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'DELETION', 'REVOCATION', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'DENIED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeclarationStatus" AS ENUM ('DECLARED', 'ACKNOWLEDGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'NEQUI', 'DAVIPLATA', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DispatchMode" AS ENUM ('DIRECT', 'OPEN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SEEKING_COURIER', 'ACCEPTED', 'ARRIVING_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'AT_DROPOFF', 'DELIVERED', 'EXPIRED', 'CANCELLED_RESTAURANT', 'CANCELLED_COURIER', 'CANCELLED_ADMIN', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('RESTAURANT', 'COURIER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PinKind" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('COURIER_NO_SHOW', 'RESTAURANT_NO_SHOW', 'CUSTOMER_ABSENT', 'PIN_LOCKOUT', 'ACCIDENT', 'HARASSMENT', 'DOCUMENT_FRAUD_SUSPICION', 'THEFT_SUSPICION', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254),
    "phoneE164" VARCHAR(20),
    "passwordHash" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "client" "ClientKind" NOT NULL,
    "userAgent" VARCHAR(255),
    "ip" VARCHAR(45),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "access_invites" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "purpose" "AccessInvitePurpose" NOT NULL,
    "restaurantId" UUID,
    "membershipRole" "MembershipRole",
    "platformRole" "PlatformRole",
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "legalName" VARCHAR(200) NOT NULL,
    "tradeName" VARCHAR(200) NOT NULL,
    "nit" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phoneE164" VARCHAR(20) NOT NULL,
    "status" "RestaurantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_memberships" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restaurant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishments" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "registrationNumber" VARCHAR(40),
    "status" "EstablishmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phoneE164" VARCHAR(20),
    "addressLine" VARCHAR(300) NOT NULL,
    "neighborhood" VARCHAR(120),
    "city" VARCHAR(120) NOT NULL DEFAULT 'Tocancipá',
    "department" VARCHAR(120) NOT NULL DEFAULT 'Cundinamarca',
    "countryCode" CHAR(2) NOT NULL DEFAULT 'CO',
    "location" geography(Point,4326),
    "status" "BranchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_hours" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "opensMinute" SMALLINT NOT NULL,
    "closesMinute" SMALLINT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "branch_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_invitations" (
    "id" UUID NOT NULL,
    "restaurantId" UUID,
    "createdById" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "documentType" "IdentityDocumentType" NOT NULL,
    "documentNumber" VARCHAR(20) NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL,
    "status" "CourierStatus" NOT NULL DEFAULT 'REGISTERING',
    "registrationSource" "RegistrationSource" NOT NULL,
    "invitationId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'MOTORCYCLE',
    "plate" VARCHAR(10) NOT NULL,
    "soatExpiresOn" DATE NOT NULL,
    "techExpiresOn" DATE NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_documents" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "type" "CourierDocumentType" NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "declaredExpiresOn" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "courier_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_availabilities" (
    "courierId" UUID NOT NULL,
    "state" "AvailabilityState" NOT NULL DEFAULT 'OFFLINE',
    "location" geography(Point,4326),
    "recordedAt" TIMESTAMPTZ(6),
    "accuracyM" INTEGER,
    "consentId" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "courier_availabilities_pkey" PRIMARY KEY ("courierId")
);

-- CreateTable
CREATE TABLE "location_pings" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "orderId" UUID,
    "purpose" "LocationPurpose" NOT NULL,
    "location" geography(Point,4326) NOT NULL,
    "accuracyM" INTEGER,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "location_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_cases" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'COLLECTING',
    "submittedAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_checks" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "outcome" "CheckOutcome" NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_decisions" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "legalDocumentId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "ip" VARCHAR(45),
    "userAgent" VARCHAR(255),

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "priceCop" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "maxBranches" INTEGER NOT NULL,
    "maxConcurrentOrders" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_subscriptions" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "priceCop" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "periodStartsAt" TIMESTAMPTZ(6) NOT NULL,
    "periodEndsAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restaurant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus" NOT NULL,
    "actorId" UUID,
    "reason" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payment_declarations" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amountCop" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(80),
    "status" "DeclarationStatus" NOT NULL DEFAULT 'DECLARED',
    "declaredById" UUID NOT NULL,
    "note" VARCHAR(500),
    "declaredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(6),

    CONSTRAINT "subscription_payment_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_versions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tariff_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_zones" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "area" geography(MultiPolygon,4326) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tariff_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_rules" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "zoneId" UUID,
    "baseFeeCop" INTEGER NOT NULL,
    "perKmCop" INTEGER NOT NULL,
    "minimumFeeCop" INTEGER NOT NULL,
    "nightMultiplierBps" INTEGER NOT NULL DEFAULT 10000,
    "nightStartsMinute" SMALLINT NOT NULL DEFAULT 0,
    "nightEndsMinute" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "tariff_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations_policies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "offerRadiusMeters" INTEGER NOT NULL,
    "directOfferTtlSeconds" INTEGER NOT NULL,
    "openOfferTtlSeconds" INTEGER NOT NULL,
    "seekingTtlSeconds" INTEGER NOT NULL,
    "maxOffersPerWave" INTEGER NOT NULL,
    "locationFreshnessSeconds" INTEGER NOT NULL DEFAULT 120,
    "pinLength" INTEGER NOT NULL DEFAULT 6,
    "maxPinAttempts" INTEGER NOT NULL DEFAULT 5,
    "trackingHoursAfterTerminal" INTEGER NOT NULL DEFAULT 24,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "referenceCode" VARCHAR(12) NOT NULL,
    "restaurantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "operationsPolicyId" UUID,
    "dispatchMode" "DispatchMode",
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "foodAmountCop" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeCop" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod",
    "customerName" VARCHAR(120),
    "customerPhoneE164" VARCHAR(20),
    "dropoffAddress" VARCHAR(300),
    "dropoffReference" VARCHAR(200),
    "pickupLocation" geography(Point,4326),
    "dropoffLocation" geography(Point,4326),
    "assignedCourierId" UUID,
    "pickupPinHash" VARCHAR(64),
    "pickupPinCiphertext" VARCHAR(500),
    "deliveryPinHash" VARCHAR(64),
    "deliveryPinCiphertext" VARCHAR(500),
    "pickupPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "deliveryPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "seekingExpiresAt" TIMESTAMPTZ(6),
    "acceptedAt" TIMESTAMPTZ(6),
    "pickedUpAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_quotes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tariffVersionId" UUID NOT NULL,
    "zoneCode" VARCHAR(40),
    "distanceMeters" INTEGER,
    "deliveryFeeCop" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tariff_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" UUID,
    "reason" VARCHAR(200),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_offers" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "wave" INTEGER NOT NULL DEFAULT 1,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "respondedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pin_attempts" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "kind" "PinKind" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pin_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "tokenCiphertext" VARCHAR(500) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_accesses" (
    "id" UUID NOT NULL,
    "trackingLinkId" UUID NOT NULL,
    "ip" VARCHAR(45),
    "userAgent" VARCHAR(255),
    "accessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "restaurantId" UUID,
    "courierId" UUID,
    "reporterId" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "summary" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "actorId" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "platform" "PushPlatform" NOT NULL DEFAULT 'ANDROID',
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "template" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(6),
    "lastError" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorKind" "ActorKind" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" UUID NOT NULL,
    "reason" VARCHAR(200),
    "diff" JSONB,
    "ip" VARCHAR(45),
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneE164_key" ON "users"("phoneE164");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "access_invites_tokenHash_key" ON "access_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "access_invites_email_consumedAt_idx" ON "access_invites"("email", "consumedAt");

-- CreateIndex
CREATE INDEX "access_invites_restaurantId_idx" ON "access_invites"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_nit_key" ON "restaurants"("nit");

-- CreateIndex
CREATE INDEX "restaurants_status_idx" ON "restaurants"("status");

-- CreateIndex
CREATE INDEX "restaurant_memberships_userId_idx" ON "restaurant_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_memberships_restaurantId_userId_key" ON "restaurant_memberships"("restaurantId", "userId");

-- CreateIndex
CREATE INDEX "establishments_restaurantId_idx" ON "establishments"("restaurantId");

-- CreateIndex
CREATE INDEX "branches_establishmentId_idx" ON "branches"("establishmentId");

-- CreateIndex
CREATE INDEX "branches_status_idx" ON "branches"("status");

-- CreateIndex
CREATE INDEX "branches_location_gist" ON "branches" USING GIST ("location");

-- CreateIndex
CREATE INDEX "branch_hours_branchId_weekday_idx" ON "branch_hours"("branchId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "courier_invitations_tokenHash_key" ON "courier_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "courier_invitations_restaurantId_status_idx" ON "courier_invitations"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_userId_key" ON "couriers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_invitationId_key" ON "couriers"("invitationId");

-- CreateIndex
CREATE INDEX "couriers_status_idx" ON "couriers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_documentType_documentNumber_key" ON "couriers"("documentType", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_courierId_key" ON "vehicles"("courierId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE INDEX "courier_documents_courierId_type_status_idx" ON "courier_documents"("courierId", "type", "status");

-- CreateIndex
CREATE INDEX "courier_availabilities_state_idx" ON "courier_availabilities"("state");

-- CreateIndex
CREATE INDEX "courier_availability_location_gist" ON "courier_availabilities" USING GIST ("location");

-- CreateIndex
CREATE INDEX "location_pings_courierId_recordedAt_idx" ON "location_pings"("courierId", "recordedAt");

-- CreateIndex
CREATE INDEX "location_pings_orderId_idx" ON "location_pings"("orderId");

-- CreateIndex
CREATE INDEX "location_pings_location_gist" ON "location_pings" USING GIST ("location");

-- CreateIndex
CREATE INDEX "verification_cases_status_submittedAt_idx" ON "verification_cases"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "verification_cases_courierId_createdAt_idx" ON "verification_cases"("courierId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_checks_caseId_idx" ON "verification_checks"("caseId");

-- CreateIndex
CREATE INDEX "verification_decisions_caseId_createdAt_idx" ON "verification_decisions"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_decisions_reviewerId_idx" ON "verification_decisions"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");

-- CreateIndex
CREATE INDEX "consent_records_userId_purpose_revokedAt_idx" ON "consent_records"("userId", "purpose", "revokedAt");

-- CreateIndex
CREATE INDEX "data_subject_requests_status_openedAt_idx" ON "data_subject_requests"("status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE INDEX "restaurant_subscriptions_restaurantId_isCurrent_idx" ON "restaurant_subscriptions"("restaurantId", "isCurrent");

-- CreateIndex
CREATE INDEX "restaurant_subscriptions_status_periodEndsAt_idx" ON "restaurant_subscriptions"("status", "periodEndsAt");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_createdAt_idx" ON "subscription_events"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_payment_declarations_subscriptionId_declaredAt_idx" ON "subscription_payment_declarations"("subscriptionId", "declaredAt");

-- CreateIndex
CREATE INDEX "tariff_versions_status_idx" ON "tariff_versions"("status");

-- CreateIndex
CREATE INDEX "tariff_zones_area_gist" ON "tariff_zones" USING GIST ("area");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_zones_versionId_code_key" ON "tariff_zones"("versionId", "code");

-- CreateIndex
CREATE INDEX "tariff_rules_versionId_idx" ON "tariff_rules"("versionId");

-- CreateIndex
CREATE INDEX "operations_policies_status_idx" ON "operations_policies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_referenceCode_key" ON "orders"("referenceCode");

-- CreateIndex
CREATE INDEX "orders_restaurantId_status_createdAt_idx" ON "orders"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_assignedCourierId_status_idx" ON "orders"("assignedCourierId", "status");

-- CreateIndex
CREATE INDEX "orders_status_seekingExpiresAt_idx" ON "orders"("status", "seekingExpiresAt");

-- CreateIndex
CREATE INDEX "orders_pickup_location_gist" ON "orders" USING GIST ("pickupLocation");

-- CreateIndex
CREATE INDEX "orders_dropoff_location_gist" ON "orders" USING GIST ("dropoffLocation");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_quotes_orderId_key" ON "tariff_quotes"("orderId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "dispatch_offers_courierId_status_expiresAt_idx" ON "dispatch_offers"("courierId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "dispatch_offers_orderId_status_idx" ON "dispatch_offers"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_offers_orderId_courierId_wave_key" ON "dispatch_offers"("orderId", "courierId", "wave");

-- CreateIndex
CREATE INDEX "pin_attempts_orderId_kind_createdAt_idx" ON "pin_attempts"("orderId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_orderId_key" ON "tracking_links"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_tokenHash_key" ON "tracking_links"("tokenHash");

-- CreateIndex
CREATE INDEX "tracking_accesses_trackingLinkId_accessedAt_idx" ON "tracking_accesses"("trackingLinkId", "accessedAt");

-- CreateIndex
CREATE INDEX "incidents_status_severity_createdAt_idx" ON "incidents"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "incidents_orderId_idx" ON "incidents"("orderId");

-- CreateIndex
CREATE INDEX "incident_events_incidentId_createdAt_idx" ON "incident_events"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_push_tokens_token_key" ON "device_push_tokens"("token");

-- CreateIndex
CREATE INDEX "device_push_tokens_userId_revokedAt_idx" ON "device_push_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "notification_outbox_status_availableAt_idx" ON "notification_outbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_userId_key_key" ON "idempotency_keys"("userId", "key");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_invites" ADD CONSTRAINT "access_invites_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_invites" ADD CONSTRAINT "access_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_memberships" ADD CONSTRAINT "restaurant_memberships_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_memberships" ADD CONSTRAINT "restaurant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_invitations" ADD CONSTRAINT "courier_invitations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_invitations" ADD CONSTRAINT "courier_invitations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "courier_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_documents" ADD CONSTRAINT "courier_documents_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_availabilities" ADD CONSTRAINT "courier_availabilities_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_availabilities" ADD CONSTRAINT "courier_availabilities_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "consent_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_decisions" ADD CONSTRAINT "verification_decisions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_decisions" ADD CONSTRAINT "verification_decisions_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_legalDocumentId_fkey" FOREIGN KEY ("legalDocumentId") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_subscriptions" ADD CONSTRAINT "restaurant_subscriptions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_subscriptions" ADD CONSTRAINT "restaurant_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "restaurant_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_declarations" ADD CONSTRAINT "subscription_payment_declarations_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "restaurant_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_declarations" ADD CONSTRAINT "subscription_payment_declarations_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_zones" ADD CONSTRAINT "tariff_zones_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_rules" ADD CONSTRAINT "tariff_rules_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_rules" ADD CONSTRAINT "tariff_rules_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "tariff_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_operationsPolicyId_fkey" FOREIGN KEY ("operationsPolicyId") REFERENCES "operations_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignedCourierId_fkey" FOREIGN KEY ("assignedCourierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_quotes" ADD CONSTRAINT "tariff_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_quotes" ADD CONSTRAINT "tariff_quotes_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "tariff_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_accesses" ADD CONSTRAINT "tracking_accesses_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "tracking_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Índices parciales, CHECKs y auditoría append-only.
-- Prisma no los expresa. Están especificados en docs/modelo-datos.md.

CREATE UNIQUE INDEX restaurant_subscriptions_one_current
  ON restaurant_subscriptions ("restaurantId")
  WHERE "isCurrent";

CREATE UNIQUE INDEX tariff_versions_one_published
  ON tariff_versions (status)
  WHERE status = 'PUBLISHED';

CREATE UNIQUE INDEX operations_policies_one_published
  ON operations_policies (status)
  WHERE status = 'PUBLISHED';

CREATE UNIQUE INDEX dispatch_offers_one_accepted
  ON dispatch_offers ("orderId")
  WHERE status = 'ACCEPTED';

CREATE INDEX courier_available_location_gist
  ON courier_availabilities USING GIST (location)
  WHERE state = 'AVAILABLE';

ALTER TABLE orders
  ADD CONSTRAINT orders_amounts_non_negative
  CHECK ("foodAmountCop" >= 0 AND "deliveryFeeCop" >= 0);

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_amounts
  CHECK ("priceCop" >= 0 AND "periodDays" > 0 AND "trialDays" >= 0
         AND "maxBranches" > 0 AND "maxConcurrentOrders" > 0);

ALTER TABLE subscription_payment_declarations
  ADD CONSTRAINT subscription_declarations_amount_positive
  CHECK ("amountCop" > 0);

ALTER TABLE tariff_rules
  ADD CONSTRAINT tariff_rules_fees
  CHECK ("baseFeeCop" >= 0 AND "perKmCop" >= 0 AND "minimumFeeCop" >= 0
         AND "nightMultiplierBps" > 0);

ALTER TABLE branch_hours
  ADD CONSTRAINT branch_hours_clock
  CHECK (weekday BETWEEN 1 AND 7
         AND "opensMinute" BETWEEN 0 AND 1439
         AND "closesMinute" BETWEEN 0 AND 1440);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es append-only';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
