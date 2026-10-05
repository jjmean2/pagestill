/** Query parameters that only track where a click came from; they never change the page. */
const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_[ce]id|_ga|_gl|ref_src|igshid)$/i;

/**
 * Canonical form used for de-duplication: no fragment, no tracking params,
 * sorted query, no trailing slash (except the root).
 */
export function normalizeUrl(input: string, base?: string): string | undefined {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") return undefined;
  u.hash = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  u.search = new URLSearchParams(params).toString();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

const ID_SEGMENT: [RegExp, string][] = [
  [/^\d+$/, ":id"],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ":uuid"],
  [/^\d{4}-\d{2}-\d{2}$/, ":date"],
  [/^[0-9a-f]{12,}$/i, ":hash"],
  // long opaque tokens that mix letters and digits (slugs with ids, nanoids...)
  [/^(?=[^/]*\d)[\w-]{20,}$/, ":token"],
];

/**
 * Collapse variable path segments so that /users/42 and /users/7 share the pattern
 * /users/:id. Query keys (not values) are part of the pattern.
 */
export function urlPattern(url: string): string {
  const u = new URL(url);
  const path = u.pathname
    .split("/")
    .map((seg) => {
      const decoded = safeDecode(seg);
      return ID_SEGMENT.find(([re]) => re.test(decoded))?.[1] ?? decoded;
    })
    .join("/");
  const keys = [...new Set(u.searchParams.keys())].sort();
  return (u.origin === "null" ? "" : u.origin) + path + (keys.length ? `?${keys.map((k) => `${k}=`).join("&")}` : "");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `*` matches within a path segment, `**` across segments. Matched against pathname + search. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "\\?";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export function matchesAny(url: string, globs: string[]): boolean {
  if (!globs.length) return false;
  const u = new URL(url);
  const target = u.pathname + u.search;
  return globs.some((g) => globToRegExp(g).test(target) || globToRegExp(g).test(u.pathname));
}

/** Links that are destructive or end the session when merely visited. Never followed by default. */
export const DEFAULT_EXCLUDES = [
  "**/logout**",
  "**/log-out**",
  "**/signout**",
  "**/sign-out**",
  "**/sign_out**",
  "**/delete**",
  "**/remove**",
  "**/destroy**",
  "**/unsubscribe**",
  "**/*.{pdf,zip,gz,tgz,dmg,exe,csv,xlsx,docx,pptx,mp4,mp3,png,jpg,jpeg,gif,webp,svg}",
];

/** Expand a single `{a,b}` group (enough for DEFAULT_EXCLUDES and typical user globs). */
export function expandBraces(glob: string): string[] {
  const m = /\{([^{}]+)\}/.exec(glob);
  if (!m) return [glob];
  return m[1]!.split(",").flatMap((alt) => expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)));
}

export function matchesAnyGlob(url: string, globs: string[]): boolean {
  return matchesAny(url, globs.flatMap(expandBraces));
}

const LOGIN_HINT = /\/(login|log-in|signin|sign-in|sign_in|auth|sso|oauth|session\/new)(\/|\?|$)/i;

/**
 * True when navigating to `target` ended on a login page: the final URL matches `pattern`
 * (substring or /regex/), or, by default, looks like a login route the target itself wasn't.
 */
export function isLoginRedirect(target: string, final: string, pattern?: string): boolean {
  if (pattern) {
    const re = /^\/(.+)\/([a-z]*)$/.exec(pattern);
    const hit = re ? new RegExp(re[1]!, re[2]).test(final) : final.includes(pattern);
    return hit && !(re ? new RegExp(re[1]!, re[2]).test(target) : target.includes(pattern));
  }
  if (LOGIN_HINT.test(new URL(target).pathname)) return false;
  const f = new URL(final);
  return LOGIN_HINT.test(f.pathname) || (f.host !== new URL(target).host && /login|signin|auth|sso|accounts\./i.test(f.href));
}
