import { NextRequest, NextResponse } from 'next/server';

// This route runs on the Node.js runtime and must never be cached:
// every chat turn is a fresh, server-side call to the local Hermes gateway.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Hermes agent does real tool use, so a turn can take a while. Cap the
// wait so a stuck turn surfaces a clean error instead of hanging the UI.
const REQUEST_TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS) || 180_000;

export async function POST(request: NextRequest) {
  let body: { messages?: unknown; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Request-Body (kein JSON).' }, { status: 400 });
  }

  const { messages, model } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Feld "messages" fehlt oder ist leer.' }, { status: 400 });
  }

  // Server-side config only — the API key must NOT be exposed to the browser,
  // so it is read here (no NEXT_PUBLIC_ prefix) and never sent to the client.
  const base = (process.env.HERMES_API_BASE || 'http://127.0.0.1:8081/v1').replace(/\/+$/, '');
  const apiModel = model || process.env.HERMES_MODEL || 'hermes-agent';
  const apiKey = process.env.HERMES_API_KEY;

  if (!apiKey) {
    console.error('[api/chat] HERMES_API_KEY is not set — refusing to call the gateway.');
    return NextResponse.json(
      { error: 'Server-Konfiguration unvollständig: HERMES_API_KEY ist nicht gesetzt.' },
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: apiModel, messages, stream: false }),
      signal: controller.signal,
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      console.error(`[api/chat] gateway ${upstream.status}: ${text.slice(0, 500)}`);
      // Surface the upstream status so the UI can show something actionable.
      return NextResponse.json(
        { error: `Hermes-Gateway antwortete mit ${upstream.status}.`, detail: safeDetail(text) },
        { status: 502 }
      );
    }

    // Pass the OpenAI-shaped completion straight through to the client.
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[api/chat] gateway timeout after', REQUEST_TIMEOUT_MS, 'ms');
      return NextResponse.json(
        { error: `Zeitüberschreitung: Hermes hat nicht innerhalb von ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s geantwortet.` },
        { status: 504 }
      );
    }
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    console.error('[api/chat] fetch to gateway failed:', message);
    return NextResponse.json(
      { error: `Gateway nicht erreichbar (${base}): ${message}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

// Try to extract a human-readable message from an upstream error payload.
function safeDetail(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.error || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
