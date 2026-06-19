import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// Server-side store for the chat history so it follows the user across devices.
// The browser localStorage is only a per-device cache; THIS file is the source
// of truth. Runs on the Node runtime (needs the filesystem) and is never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kept outside the project dir so a rebuild/redeploy can't wipe the history.
// Override with HERMES_CHATS_FILE if you want it elsewhere.
const STORE_FILE =
  process.env.HERMES_CHATS_FILE || path.join(os.homedir(), '.hermes', 'ui-chats.json');

type StoredChat = Record<string, unknown> & { id: string };

async function readStore(): Promise<StoredChat[]> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed; // legacy: bare array
    if (Array.isArray(parsed?.chats)) return parsed.chats;
    return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; // not seeded yet
    throw err;
  }
}

async function writeStore(chats: StoredChat[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  // Write to a temp file then rename — an atomic replace, so a crash or a
  // concurrent read can never observe a half-written file.
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  const payload = JSON.stringify({ chats, updatedAt: new Date().toISOString() });
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, STORE_FILE);
}

export async function GET() {
  try {
    const chats = await readStore();
    return NextResponse.json({ chats });
  } catch (err) {
    console.error('[api/chats] read failed:', err);
    return NextResponse.json({ error: 'Konnte Chats nicht laden.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: { chats?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Request-Body (kein JSON).' }, { status: 400 });
  }

  if (!Array.isArray(body.chats)) {
    return NextResponse.json({ error: 'Feld "chats" fehlt oder ist kein Array.' }, { status: 400 });
  }

  try {
    await writeStore(body.chats as StoredChat[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/chats] write failed:', err);
    return NextResponse.json({ error: 'Konnte Chats nicht speichern.' }, { status: 500 });
  }
}
