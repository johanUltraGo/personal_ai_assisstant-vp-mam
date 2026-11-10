import { Router } from "express";
import * as google from "../google/accounts";

export const googleRouter = Router();

/** Starts Google sign-in for one more account (spec §7: multiple accounts). */
googleRouter.get("/connect", (req, res) => {
  const label = typeof req.query.label === "string" ? req.query.label.slice(0, 60) : undefined;
  res.redirect(google.authUrl(label));
});

googleRouter.get("/oauth/callback", async (req, res) => {
  if (req.query.error) return res.redirect(`/?google=cancelled#connections-section`);
  try {
    const account = await google.handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
    res.redirect(`/?google=connected&email=${encodeURIComponent(account.email)}#connections-section`);
  } catch (err) {
    res.redirect(`/?google=error&message=${encodeURIComponent((err as Error).message)}#connections-section`);
  }
});

googleRouter.get("/accounts", async (_req, res) => {
  res.json(await google.listAccounts());
});

googleRouter.post("/accounts/:id/default", async (req, res) => {
  await google.setDefault(req.params.id);
  res.json(await google.listAccounts());
});

googleRouter.delete("/accounts/:id", async (req, res) => {
  await google.removeAccount(req.params.id);
  res.json(await google.listAccounts());
});
