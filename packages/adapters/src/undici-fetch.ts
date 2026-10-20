import { fetch as undiciFetch } from "undici";

/** The fetch that must drive any `Agent` built from the `undici` package.
 *
 * Node's built-in fetch bundles its own undici, and the two diverge: undici 8
 * only accepts the current handler protocol (`onRequestStart`), so a request
 * from Node's fetch through a package `Agent` fails with "invalid
 * onRequestStart method" before a socket opens. Pairing the package's fetch
 * with its `Agent` keeps both on one version. Callers still inject a fetch
 * for tests and emulators.
 *
 * Global `FormData` fails this package's brand check and is sent as the string
 * "[object FormData]". Serialize it with the implementation that created it so
 * the multipart fields and Content-Type boundary stay paired. Other bodies are
 * passed through unchanged.
 *
 * The package `Response` fails `instanceof Response` against the global
 * constructor. Callers such as the MCP SDK then stringify the object
 * (`"[object Response]"`) instead of reading its status and body. Re-wrap the
 * payload in the global `Response` after the package fetch returns. The
 * request still uses this package's fetch and `Agent`, so host pinning is
 * unchanged. */
export const dispatcherFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    (await initForPackageFetch(init)) as Parameters<typeof undiciFetch>[1],
  );
  return responseForGlobalRealm(response as object);
}) as unknown as typeof globalThis.fetch;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

type PackageResponse = {
  status: number;
  statusText: string;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  body: ReadableStream<Uint8Array> | null;
};

/** Copy a package `Response` into the global realm.
 *
 * Header iteration is a method call, so it works across the two `Headers`
 * classes. Hop-by-hop headers describe the socket undici already finished and
 * would mislabel the re-streamed body. The parameter is not typed as the
 * global `Response`: a failed `instanceof` check would otherwise narrow it
 * to `never`, which is the mismatch this function exists to repair. */
function responseForGlobalRealm(input: object): Response {
  if (input instanceof globalThis.Response) return input;
  const response = input as PackageResponse;
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.append(key, value);
  });
  const init = { status: response.status, statusText: response.statusText, headers };
  if (response.body == null || NULL_BODY_STATUSES.has(response.status)) {
    return new Response(null, init);
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, init);
}

/** Node's fetch as this module loaded it. A later replacement of
 * `globalThis.fetch` is a different function; the original is still paired
 * here so a captured builtin is not handed the package Agent. */
const nodeFetch = globalThis.fetch;

/** True when the failure is an undici handler-protocol version mismatch.
 *
 * A dispatcher built by this package's undici carries the current handler shape
 * (`onRequestStart`). Node's built-in fetch bundles its own undici, which still
 * expects the previous protocol, so a request that crosses that pair fails with
 * `UND_ERR_INVALID_ARG` before a socket opens. */
function isDispatcherVersionMismatch(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const err = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (
      err.code === "UND_ERR_INVALID_ARG" &&
      typeof err.message === "string" &&
      err.message.includes("invalid onRequestStart method")
    ) {
      return true;
    }
    current = err.cause;
  }
  return false;
}

/** Package fetch for an `Agent` from this undici.
 *
 * A missing transport, the fetch currently installed as `globalThis.fetch`,
 * and a captured builtin all use `dispatcherFetch`.
 *
 * Any other function is the caller's transport and stays in charge, because
 * callers inject a fetch for tests and emulators. A caller that merely wraps
 * the global fetch cannot accept a package `Agent`, so its transport is kept
 * for the first attempt and the request is retried on `dispatcherFetch` when
 * the pair turns out to be incompatible. The mismatch is raised before any
 * socket opens, so nothing is replayed and no response body is consumed twice.
 * Host pinning via the `Agent` still applies to the retry. */
export function fetchPairedWithDispatcher(
  baseFetch?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  if (
    baseFetch == null ||
    baseFetch === nodeFetch ||
    baseFetch === globalThis.fetch ||
    baseFetch === dispatcherFetch
  ) {
    return dispatcherFetch;
  }
  const callerFetch = baseFetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await callerFetch(input, init);
    } catch (error) {
      if (!isDispatcherVersionMismatch(error)) throw error;
      return await dispatcherFetch(input, init);
    }
  }) as typeof globalThis.fetch;
}

/** Snapshot a global FormData body before this package's fetch sees it.
 *
 * The snapshot's Content-Type is the boundary embedded in the bytes. Set that
 * header only when the caller did not already supply one, matching fetch. */
async function initForPackageFetch(init?: RequestInit): Promise<RequestInit | undefined> {
  if (!(init?.body instanceof FormData)) return init;
  const encoded = new Request("https://example.com/", { method: "POST", body: init.body });
  const contentType = encoded.headers.get("content-type");
  if (!contentType?.includes("boundary=")) {
    throw new Error("FormData body did not include a multipart Content-Type.");
  }
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", contentType);
  return { ...init, body: new Uint8Array(await encoded.arrayBuffer()), headers };
}
