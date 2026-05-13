/**
 * buildSearchUrl
 * ──────────────
 * Converts structured search-filter UI state into a valid LinkedIn
 * people-search URL.  Each filter type maps to its OWN URL parameter —
 * nothing is merged into a single boolean keyword string.
 *
 * LinkedIn URL parameter reference
 * ─────────────────────────────────
 *  keywords        Free-text search across the whole profile.
 *                  Boolean operators AND / OR / NOT and "quoted phrases"
 *                  are supported by LinkedIn.
 *  title           Dedicated job-title filter (LinkedIn people search).
 *  company         Current company name filter.
 *  network         JSON array of degree codes: "F"=1st, "S"=2nd, "O"=3rd+
 *  facetCompanySize Comma-separated size codes: B=1-10, C=11-50, D=51-200 …
 */

export interface SearchFilters {
  /** General industry / topic keywords (e.g. "SaaS B2B") */
  keywords: string;
  /** Comma-separated terms to exclude (e.g. "Intern, Student") */
  exclude: string;
  /** Job title (e.g. "Founder") — mapped to LinkedIn's title= param */
  title: string;
  /** Company name (e.g. "Stripe") — mapped to LinkedIn's company= param */
  company: string;
  /** UI degree labels: "1st" | "2nd" | "3rd+" */
  connectionDegrees: string[];
  /** LinkedIn size codes: "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" */
  companySizes: string[];
}

/** Maps UI degree labels to LinkedIn network filter codes */
const DEGREE_CODE: Record<string, string> = {
  "1st":  "F",
  "2nd":  "S",
  "3rd+": "O",
};

/**
 * Build a LinkedIn people-search URL from structured UI filter state.
 *
 * Rules:
 *   - title               → `title` param, wrapped in "quotes" for exact match
 *   - keywords            → `keywords` param, each word quoted for exact match
 *   - exclude             → appended as NOT "term" inside the keywords param
 *   - company             → `company` param
 *   - connectionDegrees   → `network` param as JSON array of letter codes
 *   - companySizes        → `facetCompanySize` param, comma-separated
 *
 * Quoting strategy
 * ─────────────────
 * Wrapping a value in double-quotes ("Founder") switches LinkedIn from
 * semantic/fuzzy matching to exact-phrase matching.  URL.searchParams.set
 * handles the percent-encoding automatically, so:
 *   set("title", '"Founder"')  →  title=%22Founder%22  →  LinkedIn sees: "Founder"
 *
 * @returns Absolute URL string ready to be opened in a browser.
 */
export function buildSearchUrl(filters: SearchFilters): string {
  const {
    keywords,
    exclude,
    title,
    company,
    connectionDegrees,
    companySizes,
  } = filters;

  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");

  // ── keywords + NOT excludes ───────────────────────────────────────────────
  // Each individual keyword term is quoted for exact-phrase matching.
  // Exclude terms are appended as NOT "term" — also quoted.
  // URL.searchParams.set() percent-encodes the quotes automatically.
  const kwParts: string[] = [];

  if (keywords.trim()) {
    // Wrap multi-word phrases as a single quoted unit; wrap each
    // comma-separated keyword individually for single-term exactness.
    keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((term) => {
        // Only add quotes if the term isn't already quoted by the user
        const quoted = term.startsWith('"') ? term : `"${term}"`;
        kwParts.push(quoted);
      });
  }

  if (exclude.trim()) {
    exclude
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .forEach((term) => kwParts.push(`NOT "${term}"`));
  }

  if (kwParts.length > 0) {
    url.searchParams.set("keywords", kwParts.join(" "));
  }

  // ── title ─────────────────────────────────────────────────────────────────
  // Wrap in double quotes → LinkedIn uses exact-phrase matching on the title
  // field instead of semantic matching.
  // "Founder" will NOT match "Co-Founder" or "Head of Growth" — tighter results.
  if (title.trim()) {
    const t = title.trim();
    // Only add quotes if the user hasn't already quoted the term
    const quoted = t.startsWith('"') ? t : `"${t}"`;
    url.searchParams.set("title", quoted);
  }

  // ── company ───────────────────────────────────────────────────────────────
  if (company.trim()) {
    url.searchParams.set("company", company.trim());
  }

  // ── connection degree → network array ────────────────────────────────────
  // LinkedIn expects the value as a JSON-encoded array of letter codes.
  // Example: &network=%5B%22F%22%2C%22S%22%5D  (decoded: ["F","S"])
  if (connectionDegrees.length > 0) {
    const codes = connectionDegrees
      .map((d) => DEGREE_CODE[d])
      .filter(Boolean);

    if (codes.length > 0) {
      url.searchParams.set("network", JSON.stringify(codes));
    }
  }

  // ── company size ──────────────────────────────────────────────────────────
  if (companySizes.length > 0) {
    url.searchParams.set("facetCompanySize", companySizes.join(","));
  }

  return url.toString();
}

/**
 * Human-readable summary of the active filters — shown in the UI preview.
 * This is NOT sent to LinkedIn; it is for display / DB storage only.
 */
export function buildQuerySummary(filters: SearchFilters): string {
  const parts: string[] = [];

  if (filters.title.trim())    parts.push(`title:"${filters.title.trim()}"`);
  if (filters.company.trim())  parts.push(`company:"${filters.company.trim()}"`);
  if (filters.keywords.trim()) parts.push(filters.keywords.trim());

  if (filters.exclude.trim()) {
    filters.exclude
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .forEach((e) => parts.push(`NOT "${e}"`));
  }

  if (filters.connectionDegrees.length > 0) {
    parts.push(`degree:[${filters.connectionDegrees.join(", ")}]`);
  }

  return parts.join(" AND ");
}
