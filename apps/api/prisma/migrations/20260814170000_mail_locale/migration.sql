-- Mail language per tenant and per user.
--
-- tenants.locale (Prisma: Tenant.locale)  -> language of mail to that studio's CUSTOMERS
--                   (gallery invite, upload receipt, expiry notice).
--                   We never learn a customer's own language, so it
--                   follows the studio.
-- users.locale   (Prisma: User.locale)    -> language of mail to that individual team member
--                   (comment notice, storage warning, password reset).
--
-- Both nullable on purpose: NULL means "use the instance default"
-- (DEFAULT_MAIL_LOCALE). No backfill — existing rows keep NULL and so
-- keep exactly the behaviour they have today.
ALTER TABLE "tenants" ADD COLUMN "locale" TEXT;
ALTER TABLE "users" ADD COLUMN "locale" TEXT;
-- NB: die Tabellen heissen 'tenants'/'users', nicht 'Tenant'/'User' —
-- das Schema mappt jedes Modell per @@map auf snake_case. Rohes SQL
-- muss den DB-Namen nehmen, nicht den Prisma-Modellnamen.
