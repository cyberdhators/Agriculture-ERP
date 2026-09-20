-- Rename the language enum value from 'ar-juba' to 'ar'. The project switches
-- from Juba Arabic to standard Arabic for the farmer interface.
-- PostgreSQL 10+ supports ALTER TYPE ... RENAME VALUE.

ALTER TYPE "public"."language" RENAME VALUE 'ar-juba' TO 'ar';
