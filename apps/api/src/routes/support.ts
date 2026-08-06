/**
 * Lumio API — Support-Anfragen aus dem Studio
 *
 *   POST /support-request  — eingeloggter Nutzer schreibt an den Support
 *
 * Warum ein eigener Endpoint und nicht das Formular der Marketing-Site:
 *
 *  1. Session-authentifiziert → kein Spam-Problem, kein Honeypot, kein
 *     CAPTCHA. Wer hier schreibt, hat sich eingeloggt.
 *  2. Der Kontext haengt automatisch dran: Tenant, Plan, Rolle, die Seite
 *     von der aus geschrieben wurde, Instanz-Version. Genau die Rueckfragen,
 *     die man sonst stellen muss, bevor man helfen kann.
 *  3. Keine Abhaengigkeit zum Marketing-Container.
 *
 * NUR IN SAAS-BETRIEB registriert (BILLING_ENABLED). In einer
 * selbstgehosteten Instanz gibt es keinen Support, den dieses Formular
 * erreichen koennte — die Anfrage wuerde beim Betreiber von lumio-cloud.de
 * landen, der mit dieser Instanz nichts zu tun hat. Self-Hoster bekommen
 * den Button deshalb gar nicht zu sehen (siehe GET /instance →
 * supportFormEnabled).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { LUMIO_VERSION } from "../version.js";
import {
  sendMail,
  supportAddress,
  tmplSupportRequest,
  tmplSupportRequestConfirmation,
} from "../services/mail.js";

const supportRequestSchema = z.object({
  /** Freitext des Nutzers. */
  message: z.string().trim().min(10).max(5000),
  /** Optionale Rueckrufadresse, falls abweichend von der Login-Mail. */
  replyEmail: z.string().email().max(200).optional(),
  /** Pfad im Studio, von dem aus geschrieben wurde. Kommt vom Client,
   *  ist also nur ein Hinweis — wird nicht fuer Autorisierung benutzt. */
  fromPath: z.string().max(300).optional(),
});

export async function registerSupportRoutes(app: FastifyInstance) {
  app.post(
    "/support-request",
    {
      // Eingeloggt, aber nicht unbegrenzt: ein durchgedrehtes Skript oder
      // ein frustrierter Doppelklick soll das Postfach nicht fluten.
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const s = req.requireAuth();

      const parsed = supportRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "invalid_input", details: parsed.error.issues });
      }
      const { message, replyEmail, fromPath } = parsed.data;

      const to = supportAddress();
      if (!to) {
        // Sollte in SaaS-Betrieb nicht passieren, waere aber ein stiller
        // Datenverlust: der Nutzer sieht "gesendet" und niemand liest es.
        req.log.error(
          "[support] SUPPORT_EMAIL/SMTP_REPLY_TO nicht gesetzt — Anfrage " +
            "kann nicht zugestellt werden"
        );
        return reply.status(503).send({ error: "support_unavailable" });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          subscription: {
            select: {
              status: true,
              trialEndsAt: true,
              plan: { select: { slug: true, name: true } },
            },
          },
        },
      });

      const from = replyEmail ?? s.user.email;

      const ok = await sendMail({
        to,
        replyTo: from,
        ...tmplSupportRequest({
          message,
          userEmail: s.user.email,
          replyEmail: replyEmail ?? null,
          userName: s.user.name ?? null,
          userRole: s.user.role,
          isImpersonated: s.isImpersonated,
          tenantName: tenant?.name ?? null,
          tenantSlug: tenant?.slug ?? null,
          tenantId: req.tenantId,
          tenantStatus: tenant?.status ?? null,
          planName: tenant?.subscription?.plan?.name ?? null,
          planSlug: tenant?.subscription?.plan?.slug ?? null,
          planStatus: tenant?.subscription?.status ?? null,
          trialEndsAt: tenant?.subscription?.trialEndsAt ?? null,
          fromPath: fromPath ?? null,
          version: LUMIO_VERSION,
        }),
      });

      if (!ok) {
        // Ehrlich bleiben: hier gibt es keine SQLite als Auffangnetz wie
        // beim Marketing-Formular. Geht die Mail nicht raus, ist die
        // Anfrage weg — dann darf der Nutzer kein "gesendet" sehen.
        req.log.error(
          { tenantId: req.tenantId, userId: s.user.id },
          "[support] Mailversand fehlgeschlagen"
        );
        return reply.status(502).send({ error: "send_failed" });
      }

      // Bestaetigung an den Nutzer. Fire-and-forget: wenn die nicht
      // ankommt, ist die Anfrage trotzdem zugestellt.
      void sendMail({
        to: from,
        ...tmplSupportRequestConfirmation({ message, name: s.user.name ?? null }),
      });

      req.log.info(
        { tenantId: req.tenantId, userId: s.user.id },
        "[support] Anfrage zugestellt"
      );
      return { ok: true };
    }
  );
}

/** Ist das Support-Formular auf dieser Instanz nutzbar?
 *
 *  Zwei Bedingungen: SaaS-Betrieb (sonst gibt es keinen Support, der
 *  gemeint sein koennte) und eine konfigurierte Zieladresse (sonst
 *  laeuft das Formular ins Leere). Das Frontend fragt das ueber
 *  GET /instance ab und blendet den Button sonst aus. */
export function isSupportFormEnabled(): boolean {
  return config.BILLING_ENABLED && supportAddress() !== null;
}
