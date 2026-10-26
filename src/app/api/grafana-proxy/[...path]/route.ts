/**
 * Same-origin proxy for the TeslaMate integration.
 *
 * The app ships as a standalone Node server, so it can relay Grafana requests
 * itself — the browser calls this same origin and never makes a cross-origin
 * request. Grafana therefore needs no CORS configuration, and need not be
 * reachable from outside the network the app runs in.
 *
 * The upstream is fixed at deploy time via GRAFANA_UPSTREAM and is never taken
 * from the request, so this is not an open relay. Only the two read-only
 * endpoints the integration uses are forwarded.
 */

import { NextResponse } from 'next/server';

/** The Grafana base URL, without a trailing slash. Empty disables the proxy. */
const UPSTREAM = (process.env.GRAFANA_UPSTREAM ?? '').replace(/\/+$/, '');

/**
 * A Grafana service-account token supplied by the deployment.
 *
 * It is injected here, server-side, when the browser does not send one — so a
 * self-hosted instance can be pre-configured without the token ever reaching
 * the page. It is deliberately **not** a `NEXT_PUBLIC_` variable.
 */
const UPSTREAM_TOKEN = process.env.GRAFANA_TOKEN ?? '';

/** The only paths that may be relayed. All read-only. */
const ALLOWED_PATHS = new Set([
  'api/ds/query',
  'api/datasources',
  'api/search',
]);

export const dynamic = 'force-dynamic';

async function proxy(request: Request, segments: string[]): Promise<Response> {
  // A tiny status endpoint, so the app can enable itself when the deployment
  // is pre-configured. It reports booleans only — never the token itself.
  if (segments.length === 1 && segments[0] === 'status') {
    return NextResponse.json({
      configured: Boolean(UPSTREAM),
      tokenConfigured: Boolean(UPSTREAM_TOKEN),
    });
  }

  if (!UPSTREAM) {
    return NextResponse.json(
      { error: 'The Grafana proxy is not configured.' },
      { status: 404 },
    );
  }

  const path = segments.join('/');
  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const method = request.method;
  if (method !== 'GET' && method !== 'POST') {
    return NextResponse.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { allow: 'GET, POST' } },
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authorization = request.headers.get('authorization');
  if (authorization) {
    // Relayed verbatim and deliberately never logged.
    headers.Authorization = authorization;
  } else if (UPSTREAM_TOKEN) {
    // The deployment's own token, so the browser never has to hold one.
    headers.Authorization = `Bearer ${UPSTREAM_TOKEN}`;
  }

  const body = method === 'POST' ? await request.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${path}`, {
      method,
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach Grafana.' },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await params;
  return proxy(request, path ?? []);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await params;
  return proxy(request, path ?? []);
}
