import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

// Only these two actions are allowed — no dynamic command injection possible.
const COMMANDS: Record<string, { cmd: string; timeout: number }> = {
  restart: { cmd: 'systemctl --user restart hermes-gateway.service', timeout: 15_000 },
  update:  { cmd: 'hermes update 2>&1',                              timeout: 120_000 },
};

export async function POST(req: Request) {
  let action: string;
  try {
    ({ action } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body' }, { status: 400 });
  }

  const entry = COMMANDS[action];
  if (!entry) {
    return NextResponse.json({ error: `Unbekannte Aktion: ${action}` }, { status: 400 });
  }

  try {
    const { stdout, stderr } = await execAsync(entry.cmd, { timeout: entry.timeout });
    return NextResponse.json({ ok: true, output: (stdout + stderr).trim() || '(kein Output)' });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? '') + (err.stderr ?? '')) || (err.message ?? String(e));
    return NextResponse.json({ ok: false, output: output.trim() }, { status: 500 });
  }
}
