-- Mail language per tenant and per user.
--
-- Tenant.locale  -> language of mail to that studio's CUSTOMERS
--                   (gallery invite, upload receipt, expiry notice).
--                   We never learn a customer's own language, so it
--                   follows the studio.
-- User.locale    -> language of mail to that individual team member
--                   (comment notice, storage warning, password reset).
--
-- Both nullable on purpose: NULL means "use the instance default"
-- (DEFAULT_MAIL_LOCALE). No backfill — existing rows keep NULL and so
-- keep exactly the behaviour they have today.
ALTER TABLE "Tenant" ADD COLUMN "locale" TEXT;
ALTER TABLE "User" ADD COLUMN "locale" TEXT;
