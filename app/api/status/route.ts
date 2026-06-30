import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function gatewayBase(): string {
  const base = process.env.HERMES_API_BASE ?? 'http://127.0.0.1:8081/v1';
  return base.replace(/\/v1\/?$/, '');
}

function authHeader(): HeadersInit {
  const key = process.env.HERMES_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export async function GET() {
  const root = gatewayBase();
  const headers = authHeader();

  try {
    const [healthRes, capsRes] = await Promise.all([
      fetch(`${root}/health/detailed`, { headers, signal: AbortSignal.timeout(5000) }),
      fetch(`${root}/v1/capabilities`,  { headers, signal: AbortSignal.timeout(5000) }),
    ]);

    const health = healthRes.ok ? await healthRes.json() : null;
    const caps   = capsRes.ok  ? await capsRes.json()   : null;

    return NextResponse.json({ health, capabilities: caps });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
