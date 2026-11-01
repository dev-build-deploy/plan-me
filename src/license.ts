/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

/** reuse-me's configuration file in the repository root. */
export const REUSE_ME_CONFIG = ".reuse-me.json";

/** One rule of `.reuse-me.json`: the first rule whose paths match a file gives its holder, year and licence. */
interface ReuseRule {
  paths?: string[];
  holder?: string | string[];
  year?: string | number;
  license?: string;
}

/** The parts of `.reuse-me.json` plan-me reads (reuse-me's README documents the format). */
interface ReuseConfig {
  rules?: ReuseRule[];
  defaults?: Omit<ReuseRule, "paths">;
  exclude?: string[];
}

/**
 * A glob as reuse-me reads it: `**` crosses folders, `*` and `?` don't; a glob without a slash matches at any depth;
 * a trailing slash means everything below.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/^\.?\//, "");
  const anyDepth = !g.includes("/");
  if (g.endsWith("/")) g += "**";
  let out = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      i++;
      if (g[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else out += ".*";
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp((anyDepth ? "(?:^|.*/)" : "^") + out + "$");
}

const matches = (globs: string[] | undefined, rel: string): boolean =>
  (globs ?? []).some(g => globToRegExp(g).test(rel));

/** The tag prefix, built from parts so no line of this source starts with an SPDX tag (reuse-me reads those). */
const TAG = "SPDX-";

/**
 * The SPDX tag lines for a file (`<tag>FileCopyrightText: ...`, `<tag>License-Identifier: ...`) when the repository has
 * a `.reuse-me.json`: the holder and licence of its first rule matching the path (else its defaults; else the only
 * licence in `LICENSES/`). Undefined without `.reuse-me.json`, for an excluded path, or when no holder or licence is
 * known.
 * @param root The repository root
 * @param rel The file's path relative to the root (forward slashes)
 * @param year The copyright year when the rule gives none (for a decision: the year it was decided, so the output
 *   doesn't change with the calendar)
 */
export function licenseLines(root: string, rel: string, year: string): string[] | undefined {
  const file = path.join(root, REUSE_ME_CONFIG);
  if (!fs.existsSync(file)) return undefined;
  const config: ReuseConfig = JSON.parse(fs.readFileSync(file, "utf8"));
  if (matches(config.exclude, rel)) return undefined;
  const rule = (config.rules ?? []).find(r => matches(r.paths, rel));
  const d = config.defaults ?? {};
  const holder = rule?.holder ?? d.holder;
  const licensesDir = path.join(root, "LICENSES");
  const sole = fs.existsSync(licensesDir) ? fs.readdirSync(licensesDir).filter(f => f.endsWith(".txt")) : [];
  const license = rule?.license ?? d.license ?? (sole.length === 1 ? sole[0].replace(/\.txt$/, "") : undefined);
  if (!holder || !license) return undefined;
  const y = String(rule?.year ?? d.year ?? year);
  const holders = (Array.isArray(holder) ? holder : [holder]).map(h => (/^\d{4}/.test(h) ? h : `${y} ${h}`));
  return [...holders.map(h => `${TAG}FileCopyrightText: ${h}`), `${TAG}License-Identifier: ${license}`];
}

/** The SPDX header for a markdown file, as an HTML comment (licenseLines); undefined when there is none. */
export function licenseHeader(root: string, rel: string, year: string): string | undefined {
  const lines = licenseLines(root, rel, year);
  return lines && ["<!--", ...lines, "-->"].join("\n");
}

/** The SPDX header for a YAML file, as `#` comment lines (licenseLines); undefined when there is none. */
export function yamlLicenseHeader(root: string, rel: string, year: string): string | undefined {
  const lines = licenseLines(root, rel, year);
  return lines && lines.map(l => `# ${l}`).join("\n");
}
