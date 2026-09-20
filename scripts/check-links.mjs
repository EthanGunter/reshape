/**
 * Verifies every relative and in-page Markdown link resolves.
 *
 * The API table links each method to the example that uses it, and GitHub
 * derives anchors from heading text -- so renaming a heading breaks those
 * links silently, with nothing to see until a reader clicks one. External
 * (http) links are left alone: checking them needs the network and fails for
 * reasons that have nothing to do with the commit.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const FENCE = /^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?\n\1\2[^\n]*$/gm;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/gm;
const LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)<>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

/** Heading text minus the inline markup GitHub strips before slugging. */
const plain = (s) => s
	.replace(/`([^`]*)`/g, "$1")
	.replace(/\*\*([^*]*)\*\*/g, "$1")
	.replace(/\*([^*]*)\*/g, "$1")
	.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

/** GitHub's slug: lowercase, drop punctuation, spaces to hyphens. */
const slug = (s) => plain(s).trim().toLowerCase()
	.replace(/[^\p{L}\p{N}\s_-]/gu, "")
	.replace(/\s+/g, "-");

/** Fenced code is not content: `# comment` is no heading, and `[a](#b)` no link. */
const strip = (src) => src.replace(FENCE, (m) => m.replace(/[^\n]/g, " "));

function anchorsOf(file) {
	const seen = new Map();
	const out = new Set();
	for (const [, , text] of strip(readFileSync(file, "utf8")).matchAll(HEADING)) {
		const base = slug(text);
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		out.add(n === 0 ? base : `${base}-${n}`);
	}
	return out;
}

const anchorCache = new Map();
const anchors = (file) => {
	if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(file));
	return anchorCache.get(file);
};

const files = globSync(["README.md", "docs/**/*.md", "*.md"]);
const failures = [];
let checked = 0;

for (const file of files) {
	const src = readFileSync(file, "utf8");
	const body = strip(src);
	const lineOf = (i) => body.slice(0, i).split("\n").length;

	for (const m of body.matchAll(LINK)) {
		const target = m[1];
		if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
		checked++;

		const [path, hash] = target.split("#");
		const where = `${file}:${lineOf(m.index)}`;

		if (!path) {
			if (!anchors(file).has(hash)) {
				failures.push(`${where}  no heading matches #${hash}`);
			}
			continue;
		}

		const abs = resolve(dirname(file), decodeURIComponent(path));
		if (!existsSync(abs)) {
			failures.push(`${where}  missing file ${path}`);
		} else if (hash && abs.endsWith(".md") && !anchors(relative(".", abs)).has(hash)) {
			failures.push(`${where}  ${path} has no heading matching #${hash}`);
		}
	}
}

if (failures.length) {
	console.error(`\nBroken links (${failures.length}):\n`);
	for (const f of failures) console.error(`  ${f}`);
	console.error("");
	process.exit(1);
}
console.log(`links ok - ${checked} checked across ${files.length} file(s)`);
