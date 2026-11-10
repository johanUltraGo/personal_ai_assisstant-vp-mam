import { Router } from "express";
import { prisma } from "../db";
import { gmailFromEnvironment } from "../connectors/gmailConnector";
import { driveFromEnvironment } from "../connectors/driveConnector";
import { whatsappFromEnvironment } from "../connectors/whatsappConnector";
import { isOAuthConfigured } from "../google/accounts";

/** Shows exactly which integrations are ready; never exposes tokens. */
export const connectorsRouter = Router();

connectorsRouter.get("/health", async (_req, res) => {
  const accounts = await prisma.googleAccount.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  const emails = accounts.map((a) => a.email + (a.isDefault ? " (default)" : "")).join(", ");
  const setupHint = isOAuthConfigured()
    ? "Use \"Connect Google account\" to sign in."
    : "Google sign-in is not set up yet (see server/README.md).";
  const gmail = accounts.length
    ? { type: "gmail", configured: true, detail: `Email sends from ${emails}.` }
    : { type: "gmail", ...gmailFromEnvironment().health(), ...(process.env.GOOGLE_ACCESS_TOKEN ? {} : { detail: `No Google account connected. ${setupHint}` }) };
  const drive = accounts.length
    ? { type: "drive", configured: true, detail: `Drive files are read from ${emails}.` }
    : { type: "drive", ...driveFromEnvironment().health(), ...(process.env.GOOGLE_ACCESS_TOKEN ? {} : { detail: `No Google account connected. ${setupHint}` }) };
  const whatsapp = whatsappFromEnvironment();
  res.json([gmail, drive, { type: whatsapp.type, ...whatsapp.health() }]);
});
