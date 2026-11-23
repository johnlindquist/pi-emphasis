import { describe, expect, test } from "bun:test";
import { Markdown, getCapabilities, setCapabilities, type MarkdownTheme } from "@earendil-works/pi-tui";
import { marked, type Tokens } from "marked";
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

describe("email autolinks", () => {
	const identity = (text: string) => text;
	const markdownTheme: MarkdownTheme = {
		heading: identity, link: identity, linkUrl: identity, code: identity,
		codeBlock: identity, codeBlockBorder: identity, quote: identity, quoteBorder: identity,
		hr: identity, listBullet: identity, bold: (text) => `\x1b[1m${text}\x1b[22m`,
		italic: identity, strikethrough: identity, underline: identity,
	};
	const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");

	for (const [name, open] of [
		["standard", "\x1b[34m"], ["256-color", "\x1b[38;5;208m"], ["truecolor", "\x1b[38;2;255;128;0m"],
	]) {
		const ansiPalette = createPalette({
			fg: (_color, text) => `${open}${text}\x1b[39m`,
			getFgAnsi: () => open,
			getBgAnsi: () => open.replace("[38;", "[48;").replace("[34m", "[44m"),
		});
		test.each<[string, string, string[]]>([
			["**person@example.com**", "person@example.com", ["person@example.com"]],
			["__person@example.com__", "person@example.com", ["person@example.com"]],
			...[2, 3, 4].flatMap((count): [string, string, string[]][] => {
				const address = `first${"_".repeat(count)}last@example.com`;
				return [
					[`__${address}__`, address, [address]],
					[`__Contact ${address}__`, `Contact ${address}`, [address]],
					[`__${address} → [[Done]]__`, `${address} → [[Done]]`, [address]],
				];
			}),
			["(**person@example.com**),", "(person@example.com),", ["person@example.com"]],
			["**Contact person@example.com, then other+tag@example.org.**", "Contact person@example.com, then other+tag@example.org.", ["person@example.com", "other+tag@example.org"]],
			["**person@example.com** and **other@example.org**", "person@example.com and other@example.org", ["person@example.com", "other@example.org"]],
			["**Contact `literal`person@example.com**", "Contact literalperson@example.com", ["person@example.com"]],
			["**person@example.com `**` later**", "person@example.com ** later", ["person@example.com"]],
			["**person@example.com [[Done]] other@example.org**", "person@example.com [[Done]] other@example.org", ["person@example.com", "other@example.org"]],
			["**→person@example.com**", "→person@example.com", ["person@example.com"]],
			["**[[Done]]person@example.com**", "[[Done]]person@example.com", ["person@example.com"]],
			["**person@example.com [[Done]]**", "person@example.com [[Done]]", ["person@example.com"]],
			["**Contact \\*\\*person@example.com**", "Contact **person@example.com", ["person@example.com"]],
		])(`${name}: %s keeps text and mailto`, (source, visible, addresses) => {
			const decorated = decorate(source, ansiPalette);
			const links: Tokens.Link[] = [];
			marked.walkTokens(marked.lexer(decorated), (token) => {
				if (token.type === "link") links.push(token as Tokens.Link);
			});
			expect(links.map(({ text, href }) => ({ text, href }))).toEqual(addresses.map((text) => ({ text, href: `mailto:${text}` })));
			const capabilities = getCapabilities();
			try {
				setCapabilities({ ...capabilities, hyperlinks: true });
				const rendered = new Markdown(decorated, 0, 0, markdownTheme).render(200).join("\n");
				expect(stripAnsi(rendered).trimEnd()).toBe(visible);
				expect(rendered).toContain("\x1b[1m");
				expect(rendered).toBe(new Markdown(source, 0, 0, markdownTheme).render(200).join("\n"));
				const destinations = [...rendered.matchAll(/\x1b\]8;;([^\x1b]+)\x1b\\/g)].map((match) => match[1]);
				expect(destinations).toEqual(addresses.map((address) => `mailto:${address}`));
			} finally {
				setCapabilities(capabilities);
			}
		});

		test.each([
			"____first@example.com____",
			...[2, 3, 4].map((count) => `__first+${"_".repeat(count)}last@example.com__`),
			"**ordinary** **person@example.com** **later** [[Done]] →",
			"**ordinary `person@example.com` prose**",
			"**person@example.com",
			"→person@example.com [[Done]]person@example.com",
			"## **person@example.com** [[Done]]",
			"**Contact:** @synthetic [[Done]]",
		])(`${name}: %s preserves native parsing and rendering`, (source) => {
			const decorated = decorate(source, ansiPalette);
			const links = (text: string) => {
				const result: { text: string; href: string }[] = [];
				marked.walkTokens(marked.lexer(text), (token) => {
					if (token.type === "link") result.push({ text: token.text, href: token.href });
				});
				return result;
			};
			expect(links(decorated)).toEqual(links(source));
			const capabilities = getCapabilities();
			try {
				setCapabilities({ ...capabilities, hyperlinks: true });
				const render = (text: string) => new Markdown(text, 0, 0, markdownTheme).render(200).join("\n");
				const rendered = render(decorated);
				const baseline = render(source);
				expect(rendered).toBe(baseline);
				expect([...rendered.matchAll(/\x1b\]8;;([^\x1b]+)\x1b\\/g)].map((match) => match[1])).toEqual(links(source).map(({ href }) => href));
			} finally {
				setCapabilities(capabilities);
			}
			expect(decorated).toBe(source);
		});

		test(`${name}: only @-containing source lines bypass decoration`, () => {
			const ordinary = "**ordinary** → [[Done]]";
			const email = "**person@example.com** [[Done]]";
			expect(decorate(`${ordinary}\n${email}\n${ordinary}`, ansiPalette)).toBe(`${decorate(ordinary, ansiPalette)}\n${email}\n${decorate(ordinary, ansiPalette)}`);
			expect(decorate(ordinary, ansiPalette)).toContain(`${open}ordinary\x1b[39m`);
			expect(decorate(ordinary, ansiPalette)).not.toContain("[[Done]]");
			const fenced = "```@synthetic\n**ordinary** [[Done]]\n```\n";
			expect(decorate(fenced + ordinary, ansiPalette)).toBe(fenced + decorate(ordinary, ansiPalette));
		});
	}
});

describe("what is left alone", () => {
	test("fenced code", () => {
		const block = "```\n**Cause:** → [[Done]]\n```";
		expect(plain(block)).toBe(block);
	});
	test("inline code", () => expect(plain("`[[Done]] → **x**`")).toBe("`[[Done]] → **x**`"));
	test("emails inside code and escaped bold markers", () => {
		for (const source of ["`**person@example.com**`", "```\n**person@example.com**\n```", "\\*\\*person@example.com\\*\\*"]) {
			expect(decorate(source, palette)).toBe(source);
		}
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
