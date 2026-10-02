export type DateRange = { from: Date; to: Date; utcFrom: Date; utcTo: Date };

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function monthRangeUTC(y: number, mo: number): DateRange {
  return {
    from: new Date(y, mo, 1, 0, 0, 0, 0),
    to: new Date(y, mo + 1, 0, 23, 59, 59, 999),
    utcFrom: new Date(Date.UTC(y, mo, 1, 0, 0, 0, 0)),
    utcTo: new Date(Date.UTC(y, mo + 1, 0, 23, 59, 59, 999)),
  };
}

function dayRangeUTC(y: number, mo: number, d: number): DateRange {
  return {
    from: startOfDay(new Date(y, mo, d)),
    to: endOfDay(new Date(y, mo, d)),
    utcFrom: new Date(Date.UTC(y, mo, d, 0, 0, 0, 0)),
    utcTo: new Date(Date.UTC(y, mo, d, 23, 59, 59, 999)),
  };
}

function yearRangeUTC(y: number): DateRange {
  return {
    from: new Date(y, 0, 1, 0, 0, 0, 0),
    to: new Date(y, 11, 31, 23, 59, 59, 999),
    utcFrom: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
    utcTo: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
  };
}

/** Try to interpret a history query as a date/range; null when not a date. */
export function parseHistoryDateQuery(input: string): DateRange | null {
  const q = String(input ?? "").trim();
  if (!q) return null;

  let m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const day = new Date(y, mo - 1, d);
    if (day.getFullYear() !== y || day.getMonth() !== mo - 1 || day.getDate() !== d) return null;
    return dayRangeUTC(y, mo - 1, d);
  }

  m = q.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return monthRangeUTC(y, mo - 1);
  }

  m = q.match(/^(\d{4})$/);
  if (m) {
    const y = Number(m[1]);
    if (y < 1900 || y > 2200) return null;
    return yearRangeUTC(y);
  }

  m = q.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const day = new Date(y, mo - 1, d);
    if (day.getFullYear() !== y || day.getMonth() !== mo - 1 || day.getDate() !== d) return null;
    return dayRangeUTC(y, mo - 1, d);
  }

  const longA = q.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  const longB = q.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (longA || longB) {
    let monthName = "";
    let dayNum = 0;
    let yearNum = 0;
    if (longA) {
      monthName = longA[1];
      dayNum = Number(longA[2]);
      yearNum = Number(longA[3]);
    } else if (longB) {
      dayNum = Number(longB[1]);
      monthName = longB[2];
      yearNum = Number(longB[3]);
    }
    const mo = MONTHS[monthName.toLowerCase()];
    if (mo === undefined || dayNum < 1 || dayNum > 31) return null;
    const day = new Date(yearNum, mo, dayNum);
    if (day.getFullYear() !== yearNum || day.getMonth() !== mo || day.getDate() !== dayNum) return null;
    return dayRangeUTC(yearNum, mo, dayNum);
  }

  m = q.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const y = Number(m[2]);
    if (mo === undefined) return null;
    return monthRangeUTC(y, mo);
  }

  return null;
}

export type HistoryRowLike = {
  vendor: string;
  name: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

/** Lowercase alphanumeric only — so "AOR" matches "A.O.R. INC.". */
export function normalizeHistoryText(input: string): string {
  return String(input ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Case-insensitive substring match for the file-store fallback path. */
export function matchesHistoryRow(row: HistoryRowLike, query: string): boolean {
  const raw = String(query ?? "").trim();
  if (!raw) return true;
  const q = raw.toLowerCase();
  const hay = `${row.vendor ?? ""} ${row.name ?? ""}`.toLowerCase();
  if (hay.includes(q)) return true;
  // Punctuation-insensitive fallback so "AOR" matches "A.O.R. INC.".
  const nq = normalizeHistoryText(raw);
  if (nq) {
    const hayN = normalizeHistoryText(`${row.vendor ?? ""} ${row.name ?? ""}`);
    if (hayN.includes(nq)) return true;
  }
  const range = parseHistoryDateQuery(q);
  if (range) {
    const created = new Date(row.createdAt).getTime();
    if (Number.isFinite(created)) {
      if ((created >= range.from.getTime() && created <= range.to.getTime()) ||
          (created >= range.utcFrom.getTime() && created <= range.utcTo.getTime())) return true;
    }
    const updated = new Date(row.updatedAt).getTime();
    if (Number.isFinite(updated)) {
      if ((updated >= range.from.getTime() && updated <= range.to.getTime()) ||
          (updated >= range.utcFrom.getTime() && updated <= range.utcTo.getTime())) return true;
    }
  }
  return false;
}

/** Prisma where clause: vendor OR name contains; plus date range when parsed. */
export function buildHistoryWhere(query: string): object | undefined {
  const q = String(query ?? "").trim().slice(0, 200);
  if (!q) return undefined;
  const range = parseHistoryDateQuery(q);
  const ors: object[] = [
    { vendor: { contains: q, mode: "insensitive" } },
    { name: { contains: q, mode: "insensitive" } },
  ];
  if (range) {
    // Cover both the server-local day and the UTC day (DB stores UTC while
    // the user types a local calendar date).
    ors.push({ createdAt: { gte: range.from, lte: range.to } });
    ors.push({ updatedAt: { gte: range.from, lte: range.to } });
    ors.push({ createdAt: { gte: range.utcFrom, lte: range.utcTo } });
    ors.push({ updatedAt: { gte: range.utcFrom, lte: range.utcTo } });
  }
  return { OR: ors };
}

export type HistorySearchParams = {
  /** LIKE pattern with % wildcards, e.g. "%aor%". */
  like: string;
  /** Normalized LIKE pattern, e.g. "%aorinc%". Null when same as `like`. */
  normLike: string | null;
  /** Inclusive date range bounds, or null when the query is not a date. */
  from: Date | null;
  to: Date | null;
  utcFrom: Date | null;
  utcTo: Date | null;
};

/** Parameter bundle for the server-side Postgres history search. */
export function buildHistorySearchParams(query: string): HistorySearchParams {
  const q = String(query ?? "").trim().slice(0, 200);
  const like = `%${q}%`;
  const normalized = normalizeHistoryText(q);
  // Always provide the normalized pattern when non-empty: even a plain query
  // like "AOR" must match punctuated values like "A.O.R. INC." via the
  // server-side regexp_replace comparison.
  const normLike = normalized ? `%${normalized}%` : null;
  const range = q ? parseHistoryDateQuery(q) : null;
  return {
    like, normLike,
    from: range ? range.from : null, to: range ? range.to : null,
    utcFrom: range ? range.utcFrom : null, utcTo: range ? range.utcTo : null,
  };
}

/**
 * Raw-SQL WHERE fragment for Postgres history search. Handles the full
 * punctuation-insensitive case ("AOR" vs "A.O.R. INC.") that Prisma's
 * `contains` cannot express, using parameterized $n placeholders.
 */
export function buildHistorySqlWhere(query: string, startParam: number): { sql: string; params: (string | Date)[] } {
  const q = String(query ?? "").trim().slice(0, 200);
  if (!q) return { sql: "", params: [] };
  const like = `%${q}%`;
  const normalized = normalizeHistoryText(q);
  const normLike = normalized ? `%${normalized}%` : null;
  const clauses: string[] = [
    `("vendor" ILIKE $${startParam} OR "name" ILIKE $${startParam})`,
  ];
  const params: (string | Date)[] = [like];
  let next = startParam + 1;
  if (normLike) {
    clauses.push(
      `(regexp_replace(lower("vendor"), '[^a-z0-9]', '', 'g') LIKE $${next} ` +
        `OR regexp_replace(lower("name"), '[^a-z0-9]', '', 'g') LIKE $${next})`,
    );
    params.push(normLike);
    next += 1;
  }
  const range = parseHistoryDateQuery(q);
  if (range) {
    // Match the UTC calendar day AND the server-local day: timestamps are
    // stored in UTC, but users type their local calendar date.
    clauses.push(`("createdAt" >= $${next} AND "createdAt" <= $${next + 1})`);
    clauses.push(`("updatedAt" >= $${next} AND "updatedAt" <= $${next + 1})`);
    clauses.push(`("createdAt" >= $${next + 2} AND "createdAt" <= $${next + 3})`);
    clauses.push(`("updatedAt" >= $${next + 2} AND "updatedAt" <= $${next + 3})`);
    params.push(range.from, range.to, range.utcFrom, range.utcTo);
  }
  return { sql: `WHERE (${clauses.join(" OR ")})`, params };
}


