// ---------------------------------------------------------------------------
// Read a Google Sheet LIVE, without a manual "download as .xlsx" step.
//
// Every Google Sheet exposes a built-in export endpoint:
//   https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx
// Hitting it returns the whole workbook (all tabs) exactly as "File → Download →
// Microsoft Excel" would — but on demand, so the platform always sees the
// current sheet instead of whatever file someone last downloaded.
//
// Requirement: the sheet must be shared as "Anyone with the link can view"
// (link access). For a fully private sheet you'd need a Google service account
// instead — not handled here.
// ---------------------------------------------------------------------------

/** Extract the spreadsheet ID from a full edit URL, or pass an ID straight through. */
export function sheetIdFromUrl(urlOrId: string): string {
  const s = urlOrId.trim();
  // Full URL: .../spreadsheets/d/<ID>/edit#gid=...
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // Bare ID (Google sheet IDs are long, no slashes).
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  throw new Error(
    `Could not find a Google Sheet ID in "${urlOrId}". Pass the sheet URL ` +
      `(https://docs.google.com/spreadsheets/d/<ID>/edit) or the bare ID.`
  );
}

/** The live xlsx-export URL for a sheet ID or URL. */
export function xlsxExportUrl(urlOrId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetIdFromUrl(
    urlOrId
  )}/export?format=xlsx`;
}

/**
 * Fetch the live workbook bytes from Google. Throws a helpful error if the
 * sheet isn't publicly readable (Google answers a share/login HTML page with a
 * 2xx or 3xx instead of the binary xlsx, so we check the content type too).
 */
export async function fetchSheetXlsx(urlOrId: string): Promise<ArrayBuffer> {
  const url = xlsxExportUrl(urlOrId);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Google Sheet fetch failed (HTTP ${res.status}). Make sure the sheet is ` +
        `shared as "Anyone with the link can view". URL: ${url}`
    );
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("text/html")) {
    throw new Error(
      `Google returned an HTML page, not a spreadsheet — the sheet is likely ` +
        `not shared publicly. Set sharing to "Anyone with the link can view". URL: ${url}`
    );
  }
  return res.arrayBuffer();
}
