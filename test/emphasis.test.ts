import { describe, expect, test } from "bun:test";
import { CONTEXT_WORDS, VOCABULARY, createPalette, decorate, replyGuidance, toneOf, type ThemeLike } from "../index.ts";

// A theme whose colors are readable tags, so tests can assert on what was colored.
const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	getFgAnsi: (color: string) => `\x1b[38;fg-${color}m`,
	getBgAnsi: (color: string) => `\x1b[48;bg-${color}m`,
} as unknown as ThemeLike;
const palette = createPalette(theme);
const plain = (text: string) => decorate(text, palette).replace(/\x1b\[[0-9;a-zA-Z-]*m/g, "").replace(/[\ue0b4\ue0b6]/g, "|").replace(/\u00a0/g, " ");

describe("pill tone", () => {
	test.each([
		["Failed", "error"], ["Blocked", "error"], ["Needs you", "warning"], ["Decision", "warning"],
		["Done", "success"], ["Observed", "success"], ["Costs money", "danger"], ["Irreversible", "danger"],
		["Implement", "mode"], ["Shared", "owner"], ["Inferred", "neutral"], ["Anything else", "neutral"],
	])("%s is %s", (word, tone) => expect(toneOf(word)).toBe(tone as never));

	test("case and spacing do not matter", () => expect(toneOf("  needs   YOU ")).toBe("warning"));
	test("a known word may carry detail", () => {
		expect(toneOf("Passed 12/12")).toBe("success");
		expect(toneOf("Failed: 3 tests")).toBe("error");
	});
	test("a longer word that starts like a known one is not that word", () => expect(toneOf("Donezo")).toBe("neutral"));
});

describe("pills", () => {
	test("a known word gets its icon", () => expect(plain("[[Done]]")).toBe("|\uf00c Done|"));
	test("an unknown word has no icon", () => expect(plain("[[Anything else]]")).toBe("|Anything else|"));
	test("synonyms display as one word and keep their detail", () => {
		expect(plain("[[Completed]]")).toBe("|\uf00c Done|");
		expect(plain("[[Fail: 3 tests]]")).toBe("|\uf00d Failed: 3 tests|");
	});
	test("a label's own glyph wins over the table's", () => expect(plain("[[\uf0e7 Done]]")).toBe("|\uf0e7 Done|"));
	test("a pill immediately before a link still renders", () => {
		expect(plain("[[Done]][**details**](https://example.com)")).toBe("|\uf00c Done|[**details**](https://example.com)");
	});
	test("labels over 32 characters are left alone", () => {
		const long = `[[${"x".repeat(33)}]]`;
		expect(plain(long)).toBe(long);
	});
});

describe("labels", () => {
	test("a heading takes an icon from its word", () => expect(plain("## Finding")).toBe("## \uf002 Finding"));
	test("an unknown heading is untouched", () => expect(plain("## What happened")).toBe("## What happened"));
	test("a leading bold label takes an icon, after list markers and tree connectors", () => {
		expect(plain("**Cause:** x")).toBe("**<mdLink>\uf0e7 Cause:</>** x");
		expect(plain("- **Fix:** x")).toBe("- **<mdLink>\uf0ad Fix:</>** x");
		expect(plain("  ├── **Risk:** x")).toBe("  <dim>├──</> **<mdLink>\uf071 Risk:</>** x");
	});
	test("bold later in a line gets color but no icon", () => expect(plain("see **Cause** here")).toBe("see **<mdLink>Cause</>** here"));
});

describe("action lead-ins", () => {
	test("take an icon anywhere in a line when they end in a colon", () => {
		expect(plain("[[Unverified]] red pills. **Check:** run it")).toBe("|\uf128 Unverified| red pills. **<mdLink>\uf046 Check:</>** run it");
		expect(plain("- **Unblock:** access")).toBe("- **<mdLink>\uf09c Unblock:</>** access");
	});
	test("get exactly one icon at the start of a line", () => expect(plain("**Next:** go")).toBe("**<mdLink>\uf061 Next:</>** go"));
	test("without a colon they are ordinary bold", () => expect(plain("please **do** it and **run** that")).toBe("please **<mdLink>do</>** it and **<mdLink>run</>** that"));
});

describe("what is left alone", () => {
	test("fenced code", () => {
		const block = "```\n**Cause:** → [[Done]]\n```";
		expect(plain(block)).toBe(block);
	});
	test("inline code", () => expect(plain("`[[Done]] → **x**`")).toBe("`[[Done]] → **x**`"));
	test.each([
		"[**v3.6.0**](https://example.com)",
		'[**API docs**](https://example.com/a(b(c)d)e "Title with ) and **bold**")',
	])("preserves %s while coloring adjacent bold text", (link) => {
		const ansi = { ...palette, bold: (s: string) => `\x1b[34m${s}\x1b[39m` };
		expect(decorate(`${link} and **details**`, ansi)).toBe(`${link} and **\x1b[34mdetails\x1b[39m**`);
	});
	test("an unfinished link does not swallow the remaining prose", () => {
		expect(plain("[**Docs**](https://example.com/a(b(c) and **notes**")).toBe("[**<mdLink>Docs</>**](https://example.com/a(b(c) and **<mdLink>notes</>**");
	});
	test("escaped asterisks", () => expect(plain("\\*\\*not bold\\*\\*")).toBe("\\*\\*not bold\\*\\*"));
});

test("arrows, checks and crosses take their colors", () => {
	expect(plain("a → b ✓ c ✗")).toBe("a <accent>→</> b <success>✓</> c <error>✗</>");
});

test("icons can be turned off", () => {
	process.env.PI_EMPHASIS_PILL_ICONS = "0";
	try {
		expect(plain("[[Done]]")).toBe("|Done|");
		expect(plain("## Finding")).toBe("## Finding");
	} finally {
		delete process.env.PI_EMPHASIS_PILL_ICONS;
	}
});

describe("reply guidance", () => {
	const text = replyGuidance();
	test("names every core word, and each one is colored as its tone", () => {
		for (const [tone, words] of Object.entries(VOCABULARY)) {
			for (const word of words.core) {
				expect(text).toContain(`[[${word}]]`);
				expect(toneOf(word)).toBe(tone as never);
			}
		}
		for (const word of CONTEXT_WORDS) expect(text).toContain(`[[${word}]]`);
	});
	test("every pill it mentions is a known word, so no example teaches an uncolored one", () => {
		const known = new Set([...Object.values(VOCABULARY).flatMap((w) => w.core), ...CONTEXT_WORDS, "Word"]);
		for (const [, label] of text.matchAll(/\[\[([^\]]+)\]\]/g)) expect([...known].some((k) => label === k || label.startsWith(`${k} `) || label.startsWith(`${k}:`))).toBe(true);
	});
	test("every lead-in it lists gets an icon", () => {
		for (const word of ["Check", "Do", "Next", "Unblock", "Left", "Run", "Guard", "Undo", "See"]) {
			expect(text).toContain(`**${word}:**`);
			expect(plain(`x **${word}:** y`)).not.toBe(`x **<mdLink>${word}:</>** y`);
		}
	});
	test("addresses any user", () => expect(text).not.toMatch(/\bJohn\b|~\/dev/));
});
