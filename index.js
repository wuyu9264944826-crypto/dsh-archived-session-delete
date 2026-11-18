/**
 * Host half of "Delete conversation" for archived Sessions.
 *
 * An archived Session is not open in any Agent, so the only durable trace is
 * its own log directory plus the registry bookkeeping that keeps the row in the
 * sidebar: the Workspace's `sessionIds` slot and the registry-global archive
 * set. This half owns both, behind one exact same-origin route, because the
 * browser cannot touch either.
 *
 * Order matters. The log is removed first: if the bookkeeping then fails, the
 * leftover row is a log-less row that the next list pull drops anyway. Doing it
 * the other way round would first publish the Session as an ordinary visible
 * row it can never open.
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Exact pathname the Client half posts to; it must not start with the `/api` bridge. */
const ROUTE_PATH = '/plugin-api/archived-session/delete'
/** A Session id is the branded `session-<uuid>` string; nothing else may name a directory. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Request bodies carry one id; anything larger is not this route's request. */
const MAX_BODY_BYTES = 4096
const CORS_METHODS = 'POST, OPTIONS'
const CORS_HEADERS = 'content-type'

export const inject = ['webServer', 'workspaceRegistry']

/**
 * The root holding every stored Session log:
 * `$DSH_HOME/sessions`, defaulting to `~/.dsh/sessions`.
 * @returns absolute directory of the per-Workspace groups.
 */
function sessionsRoot() {
  const configured = process.env.DSH_HOME;
  const home = typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : join(homedir(), '.dsh');
  return join(home, 'sessions');
}

/**
 * The origin a page may read this route from. The Web GUI runs on the desktop
 * shell's `dsh-app:` origin or on the loopback HTTP listener, so its script is
 * cross-origin here even though everything stays on this machine.
 * @param origin - the request's Origin header, when it has one.
 * @returns the origin to echo, or undefined for a caller that must be refused.
 */
function permittedOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') return undefined;
  // A `null` origin is an opaque document: a non-http shell, a sandboxed frame,
  // or `file:`. Chromium matches the literal text, so echo it back as-is.
  if (origin === 'null') return 'null';
  try {
    const url = new URL(origin);
    if (url.protocol === 'dsh-app:') return origin;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.hostname === 'localhost' || url.hostname === '::1' || /^127\./.test(url.hostname)) return origin;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the request physically arrived over the loopback interface. The
 * listener may be bound to one LAN address, so the peer address — not the
 * bind address — decides who is local.
 * @param request - the incoming request.
 * @returns true only for a loopback peer.
 */
function fromLoopback(request) {
  const peer = request.socket === undefined || request.socket === null
    ? undefined
    : request.socket.remoteAddress;
  return peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
}

/**
 * Read one bounded request body.
 * @param request - the incoming request.
 * @returns the body text.
 * @throws when the body exceeds {@link MAX_BODY_BYTES}.
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body-too-large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
    request.on('error', reject);
  });
}

/**
 * Every stored directory for one Session, across the per-Workspace groups.
 * A Session id is unique, so at most one group holds it; the scan keeps the
 * lookup independent of the group-name encoding.
 * @param sessionId - validated Session id.
 * @returns absolute paths that existed.
 */
async function findSessionDirectories(sessionId) {
  const root = sessionsRoot();
  let groups;
  try {
    groups = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const candidate = join(root, group.name, sessionId);
    try {
      if (!(await stat(candidate)).isDirectory()) continue;
    } catch {
      continue;
    }
    found.push(candidate);
  }
  return found;
}

/**
 * Delete one archived Session: its stored log, its Workspace slot, and its
 * archive-set entry.
 * @param ctx - Host context carrying the registry and the live Session store.
 * @param sessionId - validated Session id.
 * @returns the outcome the route answers with.
 */
async function deleteArchivedSession(ctx, sessionId) {
  const registry = ctx.workspaceRegistry;
  // The browser gates this row, but the Host is the authority: a Session that
  // is not archived is not this operation's subject.
  if (!registry.archivedSessionIds.includes(sessionId)) {
    return { status: 409, body: { ok: false, reason: 'not-archived' } };
  }
  const live = ctx.get('sessions')?.get(sessionId);
  if (live !== undefined) {
    return { status: 409, body: { ok: false, reason: 'active' } };
  }

  let removed;
  try {
    removed = await findSessionDirectories(sessionId);
    for (const directory of removed) await rm(directory, { recursive: true, force: true });
  } catch (error) {
    return { status: 500, body: { ok: false, reason: 'unlink-failed', message: String(error) } };
  }

  try {
    for (const workspace of registry.list()) {
      if (!workspace.sessionIds.includes(sessionId)) continue;
      await workspace.detachSession(sessionId);
    }
    await registry.unarchiveSession(sessionId);
  } catch (error) {
    return {
      status: 500,
      body: { ok: false, reason: 'bookkeeping-failed', removed, message: String(error) },
    };
  }

  return { status: 200, body: { ok: true, removed } };
}

/**
 * Register the route the Client half calls.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    /**
     * Own the whole exchange: a preflight, one POST, and a JSON answer.
     * @param request - the incoming request.
     * @param response - the response this handler ends.
     */
    handler: async (request, response) => {
      const origin = permittedOrigin(request.headers.origin);
      const headers = { 'cache-control': 'no-store' };
      if (origin !== undefined) {
        headers['access-control-allow-origin'] = origin;
        headers.vary = 'origin';
      }
      const send = (status, body) => {
        response.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(body));
      };

      // Deleting a Session is owner-only in practice: only a page on this
      // machine reaches this listener over loopback.
      if (!fromLoopback(request)) {
        send(403, { ok: false, reason: 'origin-refused' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          ...headers,
          'access-control-allow-methods': CORS_METHODS,
          'access-control-allow-headers': CORS_HEADERS,
          'access-control-max-age': '600',
        });
        response.end();
        return;
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { ...headers, allow: CORS_METHODS });
        response.end();
        return;
      }
      // A page from a real foreign origin never gets to name a Session.
      if (request.headers.origin !== undefined && origin === undefined) {
        send(403, { ok: false, reason: 'origin-refused' });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(await readBody(request));
      } catch (error) {
        send(400, { ok: false, reason: 'bad-request', message: String(error) });
        return;
      }
      const sessionId = payload !== null && typeof payload === 'object' ? payload.sessionId : undefined;
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
        send(400, { ok: false, reason: 'bad-session-id' });
        return;
      }

      try {
        const outcome = await deleteArchivedSession(ctx, sessionId);
        send(outcome.status, outcome.body);
      } catch (error) {
        send(500, { ok: false, reason: 'internal', message: String(error) });
      }
    },
  }), 'archived-session-delete: route');
}
