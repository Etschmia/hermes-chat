import { NextRequest } from 'next/server';
import { forwardToGateway, forwardToGatewayStream, gatewayConfigFromEnv } from '@hermes/gateway-client/server';

// This route runs on the Node.js runtime and must never be cached:
// every chat turn is a fresh, server-side call to the local Hermes gateway.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Thin proxy: parse the body, then hand the messages to the shared gateway
// transport (Bearer auth, timeout/abort, 502/504 mapping all live there — see
// @hermes/gateway-client/server). hermes-chat forwards raw; apps that need a
// system prompt or auth gate (e.g. depot3) do that before forwardToGateway.
export async function POST(request: NextRequest) {
  let body: { messages?: unknown; model?: string; stream?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Ungültiger Request-Body (kein JSON).' }, { status: 400 });
  }

  // Server-side config only — the API key must NOT reach the browser, so it is
  // read here from the environment (no NEXT_PUBLIC_ prefix).
  const cfg = gatewayConfigFromEnv();
  if (body.model) cfg.model = body.model; // optional per-request model override

  // Streaming path keeps the connection byte-alive (keepalive every ~30s) so a
  // deep agent turn never trips an idle-connection timeout. request.signal is
  // forwarded so a client disconnect cancels the upstream turn. The blocking
  // path stays for any caller that doesn't opt in.
  if (body.stream) {
    return forwardToGatewayStream(body.messages, cfg, request.signal);
  }

  return forwardToGateway(body.messages, cfg);
}
