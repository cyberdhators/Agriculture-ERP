# CYBER DHATORS AGRICULTURE ERP

This is a production client project. Read this file before any work.

SOURCE OF TRUTH: Approved Phase 1 scope and project documentation. Do not implement deferred requirements.

PHASE 1: Authentication, users/RBAC, farmers, cooperatives, extension, GIS/farm mapping, dashboards/reporting, Flutter app, PostgreSQL/PostGIS, SMS, email, weather, testing and deployment.

DEFERRED: Mobile Money, payments, WhatsApp, USSD, IVR, AI disease detection, credit bureau, insurance, loans, government integrations, blockchain, IoT, advanced analytics and unapproved custom modules.

STACK: Flutter; Next.js; Supabase; PostgreSQL/PostGIS; Supabase Auth; Supabase Storage; Vercel; Mapbox; Africa's Talking; SendGrid; OpenWeather; GitHub.

BEFORE CODING: Inspect repository; read documentation; understand existing architecture; identify dependencies; plan the change; modify only what is necessary.

DATABASE: Use migrations. Protect existing schema. Use constraints/indexes. Use PostGIS for spatial data.

SECURITY: Never commit secrets. Validate input. Enforce authorization server-side. Use least privilege.

GIT: Never push directly to main. Use feature branches and pull requests. Run tests/lint/type checks before committing.

MODULE STANDARD: Requirements → database → data/API → validation → authorization → web → mobile → tests → documentation → review.

STOP: If requirements are ambiguous, architecture would change, a destructive migration is required, or a new paid service/library is needed, stop and ask for developer approval.

COMPLETION REPORT: State changes, files changed, database changes, APIs/data services, tests run, build/lint/type-check results, remaining issues and approval decisions.
