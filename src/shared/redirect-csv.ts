import { REDIRECT_CODES, REDIRECT_MATCH_TYPES } from "./types.ts";
import type { Redirect, RedirectCode, RedirectInput, RedirectMatchType } from "./types.ts";

/** Split CSV text into rows of cells, honouring quotes, doubled quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

const HEADERS: Record<string, "source" | "target" | "status_code" | "match_type" | "enabled"> = {
  source: "source",
  from: "source",
  url: "source",
  old: "source",
  target: "target",
  to: "target",
  destination: "target",
  new: "target",
  status: "status_code",
  status_code: "status_code",
  code: "status_code",
  type: "status_code",
  match_type: "match_type",
  match: "match_type",
  enabled: "enabled",
  active: "enabled",
};

/**
 * Redirect rules from CSV. A header row is used when there is one; otherwise
 * the columns are source, target, status code and match type, in that order.
 * Values that are not understood are left out, so the site reports the row.
 */
export function redirectsFromCsv(text: string): Partial<RedirectInput>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const names = rows[0].map(
    (cell) =>
      HEADERS[
        cell
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      ],
  );
  const hasHeader = names.includes("source");
  const columns = hasHeader ? names : (["source", "target", "status_code", "match_type"] as const);
  return (hasHeader ? rows.slice(1) : rows).map((cells) => {
    const rule: Partial<RedirectInput> = {};
    columns.forEach((column, index) => {
      const value = (cells[index] ?? "").trim();
      if (!column || value === "") return;
      if (column === "source" || column === "target") rule[column] = value;
      else if (column === "status_code") {
        const code = Number(value);
        if ((REDIRECT_CODES as readonly number[]).includes(code)) rule.status_code = code as RedirectCode;
      } else if (column === "match_type") {
        const type = value.toLowerCase();
        if ((REDIRECT_MATCH_TYPES as readonly string[]).includes(type)) rule.match_type = type as RedirectMatchType;
      } else if (column === "enabled") rule.enabled = !/^(0|false|no|off)$/i.test(value);
    });
    return { match_type: "exact", status_code: 301, ...rule };
  });
}

function cell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rules as CSV that redirectsFromCsv reads back. */
export function redirectsToCsv(rules: Redirect[]): string {
  const lines = ["source,target,status_code,match_type,enabled"];
  for (const rule of rules)
    lines.push([rule.source, rule.target, rule.status_code, rule.match_type, rule.enabled].map(cell).join(","));
  return lines.join("\n") + "\n";
}
