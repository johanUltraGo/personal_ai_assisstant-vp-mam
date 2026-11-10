import { Router } from "express";
import { gmailFromEnvironment } from "../connectors/gmailConnector";
import { driveFromEnvironment } from "../connectors/driveConnector";
import { whatsappFromEnvironment } from "../connectors/whatsappConnector";

/** Shows exactly which integrations are ready; it never exposes tokens or account secrets. */
export const connectorsRouter = Router();

connectorsRouter.get("/health", (_req, res) => {
  const connectors = [gmailFromEnvironment(), driveFromEnvironment(), whatsappFromEnvironment()];
  res.json(connectors.map((connector) => ({ type: connector.type, ...connector.health() })));
});
