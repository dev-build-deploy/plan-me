/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

/*
 * Runs Vale (https://github.com/errata-ai/vale, MIT) with the organization's prose styles on issue bodies. The way
 * Vale is found, verified and configured follows pull-me's src/vale.ts (https://github.com/dev-build-deploy/pull-me),
 * so an issue and a pull request description get the same findings for the same text.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import { IssueCheckConfig } from "./config";

const run = promisify(execFile);

/** The Vale release plan-me is built and tested against (the one pull-me pins). */
export const VALE_VERSION = "3.24.0";

/** SHA-256 of each release archive, from vale_3.24.0_checksums.txt of the release. */
export const VALE_CHECKSUMS: Record<string, string> = {
  "Linux_64-bit.tar.gz": "867534ddb678abca7f214bc4706ead0922bd5252ffe8035fc227013f66c8b214",
  "Linux_arm64.tar.gz": "104cbd349279e50c4cb40adb70adf345d93cc4a3a0191f9e68bdccb97086b582",
  "Windows_64-bit.zip": "3a8884774973b6f2826877e1c6388a5feae4704ef88a9a9c912c77ce186990f3",
  "Windows_arm64.zip": "3ec62981d49558d89c2ee2e9836f10db86ca335fdfaa2b701a9fbeca1496a5c7",
  "macOS_64-bit.tar.gz": "eeb39e86f1daac27cc2a77fef3af1824d50559bdc22329fb25fb921c80c79472",
  "macOS_arm64.tar.gz": "87b513f26499f6657c15cf7175ba5b058a7c1ff2bb2d4e07265db2dd43451e44",
};

/** The organization's style (a copy of pull-me's) and plan-me's own. */
export const STYLES = ["DevBuildDeploy", "PlanMe"];

/**
 * References that must not stand alone (pull-me's DEFAULT_REFERENCE_PATTERNS): an issue number (#12), "decision 4",
 * and ids such as L99.1, E1, D12 or ABC-123.
 */
export const DEFAULT_REFERENCE_PATTERNS = [
  "(?<![\\w/&])#\\d+\\b",
  "\\b[Dd]ecision \\d+\\b",
  "\\b[A-Z]\\d+(?:\\.\\d+)*\\b",
  "\\b[A-Z]{2,10}-\\d+\\b",
];

/** How long one Vale run may take. */
const VALE_TIMEOUT_MS = 60_000;

/** Fix-it hints per rule (pull-me's, plus plan-me's own). */
const HINTS: Record<string, string> = {
  "DevBuildDeploy.SentenceLength": "Split the sentence in two; one idea per sentence.",
  "DevBuildDeploy.Abbreviations":
    'Write it out once: "API (application programming interface)", or add it to the glossary.',
  "DevBuildDeploy.BareReferences":
    "Say what the issue, decision or document says in a sentence of your own; keep the reference in brackets.",
  "DevBuildDeploy.Weasel": "Remove the word, or replace it with the fact or the number.",
  "DevBuildDeploy.Wordy": "Use the shorter phrase.",
  "DevBuildDeploy.Hedging": "Say what you checked and what you did not check.",
  "DevBuildDeploy.Readability": "Use shorter sentences and shorter words.",
  "PlanMe.ItemReferences": 'Say what the other item is: "after the CSV export (export-csv)".',
};

/** One prose finding: the rule, where, what and how to fix it. Always a warning for an issue. */
export interface ValeFinding {
  rule: string;
  line: number;
  column: number;
  message: string;
  hint?: string;
}

/** Thrown when Vale cannot be found, downloaded or run. */
export class ValeError extends Error {}

/** The release archive suffix of this platform, as keyed in VALE_CHECKSUMS. */
export function platformAsset(platform: string = process.platform, arch: string = process.arch): string {
  const system =
    platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;
  const cpu = arch === "x64" ? "64-bit" : arch;
  const suffix = `${system}_${cpu}.${platform === "win32" ? "zip" : "tar.gz"}`;
  if (!(suffix in VALE_CHECKSUMS)) throw new ValeError(`no Vale release for ${platform}/${arch}`);
  return suffix;
}

function cacheBase(): string {
  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
}

/** The cache folder of the pinned Vale binary (override with PLAN_ME_CACHE). */
export function cacheDir(): string {
  return path.join(process.env.PLAN_ME_CACHE ?? path.join(cacheBase(), "plan-me"), `vale-${VALE_VERSION}`);
}

/** Refuses an archive whose SHA-256 is not the pinned one. */
export function verifyChecksum(archive: Buffer, suffix: string, source: string = suffix): void {
  const sum = createHash("sha256").update(archive).digest("hex");
  if (sum !== VALE_CHECKSUMS[suffix]) {
    throw new ValeError(`checksum mismatch for ${source} (got ${sum}); refusing to run it`);
  }
}

/** The version of a Vale binary, or undefined when it does not run. */
export async function binaryVersion(bin: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(bin, ["--version"]);
    return /\d+\.\d+\.\d+/.exec(stdout)?.[0];
  } catch (_e) {
    return undefined;
  }
}

function atLeast(version: string, wanted: string): boolean {
  const a = version.split(".").map(Number);
  const b = wanted.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * Finds the Vale to run: PLAN_ME_VALE, else one on the PATH at least the pinned version, else the pinned release in
 * plan-me's (or pull-me's) cache, else the pinned release from GitHub (SHA-256 verified), cached.
 */
export async function resolveVale(): Promise<string> {
  const exe = process.platform === "win32" ? "vale.exe" : "vale";
  if (process.env.PLAN_ME_VALE) {
    if (await binaryVersion(process.env.PLAN_ME_VALE)) return process.env.PLAN_ME_VALE;
    throw new ValeError(`PLAN_ME_VALE (${process.env.PLAN_ME_VALE}) does not run`);
  }
  const onPath = await binaryVersion("vale");
  if (onPath && atLeast(onPath, VALE_VERSION)) return "vale";
  const bin = path.join(cacheDir(), exe);
  const pullMe = path.join(cacheBase(), "pull-me", `vale-${VALE_VERSION}`, exe);
  for (const cached of [bin, pullMe]) if ((await binaryVersion(cached)) === VALE_VERSION) return cached;

  const suffix = platformAsset();
  const url = `https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}/vale_${VALE_VERSION}_${suffix}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new ValeError(`download failed (${response.status}): ${url}`);
  const archive = Buffer.from(await response.arrayBuffer());
  verifyChecksum(archive, suffix, url);

  // Extract in a private folder and move the binary into place: parallel runs never see a half-written cache.
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const work = fs.mkdtempSync(path.join(dir, "tmp-"));
  try {
    const archivePath = path.join(work, `archive.${suffix.endsWith(".zip") ? "zip" : "tar.gz"}`);
    fs.writeFileSync(archivePath, archive);
    await run("tar", ["-xf", archivePath, "-C", work, exe]);
    fs.chmodSync(path.join(work, exe), 0o755);
    fs.renameSync(path.join(work, exe), bin);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return bin;
}

/** The folder with the shipped `.vale.ini`, styles and glossary: next to the sources, the lib/ bundles or the plugin bundle. */
export function shippedValeDir(): string {
  const here = __dirname;
  const found = [path.join(here, "vale"), path.join(here, "..", "vale"), path.join(here, "..", "..", "vale")].find(d =>
    fs.existsSync(path.join(d, ".vale.ini"))
  );
  if (!found) throw new ValeError(`the shipped Vale configuration is missing (looked next to ${here})`);
  return found;
}

/** Reads a glossary in Markdown: one `- **term**: explanation` per line (pull-me's format). Other lines are ignored. */
export function parseGlossary(markdown: string): Record<string, string> {
  const terms: Record<string, string> = {};
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\*\*([^*]+)\*\*\s*[:—–-]\s*(.+?)\s*$/.exec(line);
    if (m) terms[m[1].trim()] = m[2];
  }
  return terms;
}

/** The glossary in force: the shipped base glossary, the repository's glossary file, then `issueCheck.glossary`. */
export function loadGlossary(config: IssueCheckConfig, root: string): Record<string, string> {
  const base = parseGlossary(fs.readFileSync(path.join(shippedValeDir(), "glossary.md"), "utf8"));
  const file = path.resolve(root, config.glossaryFile);
  const repo = fs.existsSync(file) ? parseGlossary(fs.readFileSync(file, "utf8")) : {};
  return { ...base, ...repo, ...config.glossary };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const yamlQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * Writes the Vale configuration for one run into `work`: the shipped styles with the reference patterns (and the
 * item ids given), the glossary terms and the known abbreviations filled in. Returns the path of the `.vale.ini`.
 */
export function writeValeConfig(
  work: string,
  config: IssueCheckConfig,
  glossary: Record<string, string>,
  itemIds: string[] = []
): string {
  const shipped = shippedValeDir();
  const references = [...DEFAULT_REFERENCE_PATTERNS, ...config.referencePatterns].join("|");
  const ids = [...new Set(itemIds)]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(id => `\\b${escapeRegExp(id)}\\b`);
  const terms = Object.keys(glossary)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp)
    .join("|");
  const known = Object.keys(glossary).filter(t => /^[A-Z]{2,6}$/.test(t));
  for (const style of STYLES) {
    const dir = path.join(work, "styles", style);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of fs.readdirSync(path.join(shipped, "styles", style))) {
      let text = fs.readFileSync(path.join(shipped, "styles", style, file), "utf8");
      if (file === "BareReferences.yml") text = text.split("REFERENCE").join(references.replace(/'/g, "''"));
      if (file === "ItemReferences.yml") {
        text = text.split("REFERENCE").join([references, ...ids].join("|").replace(/'/g, "''"));
      }
      if (file === "Glossary.yml") text = text.split("GLOSSARY").join((terms || "(?!x)x").replace(/'/g, "''"));
      if (file === "Abbreviations.yml" && known.length > 0) {
        text = `${text.trimEnd()}\n${known.map(k => `  - ${yamlQuote(k)}`).join("\n")}\n`;
      }
      fs.writeFileSync(path.join(dir, file), text);
    }
  }
  const ini = fs
    .readFileSync(path.join(shipped, ".vale.ini"), "utf8")
    .replace(/^StylesPath\s*=.*$/m, `StylesPath = ${path.join(work, "styles")}`);
  const file = path.join(work, ".vale.ini");
  fs.writeFileSync(file, ini);
  return file;
}

/** One alert in Vale's JSON output. */
export interface ValeAlert {
  Check: string;
  Line: number;
  Span: [number, number];
  Message: string;
  Match: string;
}

/** Maps Vale's alerts to findings. A glossary alert quotes the glossary's explanation in its hint (as pull-me does). */
export function mapAlerts(alerts: ValeAlert[], glossary: Record<string, string> = {}): ValeFinding[] {
  const byTerm = new Map(Object.entries(glossary).map(([t, e]) => [t.toLowerCase(), e]));
  return alerts.map(a => {
    let hint = HINTS[a.Check];
    if (a.Check === "DevBuildDeploy.Glossary" && byTerm.has(a.Match.toLowerCase())) {
      hint =
        `The glossary says: "${a.Match}: ${byTerm.get(a.Match.toLowerCase())}". ` +
        "Explain it in your own words, in brackets or after a colon.";
    }
    return { rule: a.Check, line: a.Line, column: a.Span[0], message: a.Message, hint };
  });
}

/** What runs Vale: the real one (default), or a stand-in in tests. */
export type ValeRunner = (
  bodies: string[],
  config: IssueCheckConfig,
  root: string,
  itemIds?: string[]
) => Promise<ValeFinding[][]>;

/**
 * Runs Vale once over several bodies (one file each) and returns the findings per body, in order. `root` is the
 * repository, for the glossary file. Throws ValeError when Vale cannot run.
 */
export const runVale: ValeRunner = async (bodies, config, root, itemIds = []) => {
  if (bodies.length === 0) return [];
  const bin = await resolveVale();
  const glossary = loadGlossary(config, root);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "plan-me-vale-"));
  try {
    const ini = writeValeConfig(work, config, glossary, itemIds);
    const files = bodies.map((body, i) => {
      const file = path.join(work, `issue-${i}.md`);
      fs.writeFileSync(file, body);
      return file;
    });
    let stdout: string;
    try {
      ({ stdout } = await run(bin, ["--output=JSON", "--no-exit", `--config=${ini}`, ...files], {
        cwd: work,
        timeout: VALE_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      }));
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message: string };
      throw new ValeError(`Vale failed: ${(e.stderr || e.stdout || e.message).trim().split("\n")[0]}`);
    }
    let parsed: Record<string, ValeAlert[]>;
    try {
      parsed = JSON.parse(stdout || "{}");
    } catch (_e) {
      throw new ValeError(`Vale printed output plan-me cannot read: ${stdout.slice(0, 200)}`);
    }
    const byName = new Map(Object.entries(parsed).map(([name, alerts]) => [path.basename(name), alerts]));
    return files.map(f => mapAlerts(byName.get(path.basename(f)) ?? [], glossary));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
