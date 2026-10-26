// Minimal Markdown engine for Vibe Studio. parse() is pure; render() builds DOM nodes with textContent only,
// so no HTML from a deliverable is ever interpreted.

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX~!])\]\s+/;
export const TASK_STATUS = { " ": "todo", x: "done", X: "done", "~": "in_progress", "!": "blocked" };

const indent = line => line.match(/^ */)[0].length;
const blank = line => !line.trim();

function stripComments(lines) {
    const out = [];
    let fence = null, comment = false;
    for (const raw of lines) {
        const line = raw.replace(/\t/g, "    ");
        if (!comment && fence === null && FENCE.test(line)) { fence = line.trim().slice(0, 3); out.push(line); continue; }
        if (fence !== null) { if (line.trim().startsWith(fence)) fence = null; out.push(line); continue; }
        let rest = line, kept = "";
        while (rest) {
            if (comment) {
                const end = rest.indexOf("-->");
                if (end < 0) { rest = ""; break; }
                rest = rest.slice(end + 3); comment = false;
            } else {
                const start = rest.indexOf("<!--");
                if (start < 0) { kept += rest; break; }
                kept += rest.slice(0, start); rest = rest.slice(start + 4); comment = true;
            }
        }
        // A line made only of a comment disappears instead of leaving a blank paragraph break.
        if (kept.trim() || !line.includes("<!--") && !line.includes("-->")) out.push(kept);
    }
    return out;
}

function startsBlock(line) {
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || (ITEM.test(line) && indent(line) < 4);
}

export function splitRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
    const cells = [];
    let cell = "", code = false;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === "\\" && value[i + 1] === "|") { cell += "|"; i++; continue; }
        if (char === "`") code = !code;
        if (char === "|" && !code) { cells.push(cell.trim()); cell = ""; continue; }
        cell += char;
    }
    cells.push(cell.trim());
    return cells;
}

function parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (blank(line)) { i++; continue; }
        let match;
        if ((match = line.match(FENCE))) {
            const marker = match[1], body = [];
            i++;
            while (i < lines.length && !(lines[i].trim().startsWith(marker[0].repeat(marker.length)) && !lines[i].trim().slice(marker.length).trim())) body.push(lines[i++]);
            i++;
            blocks.push({ type: "code", lang: match[2] || "", text: body.join("\n") });
            continue;
        }
        if ((match = line.match(HEADING))) {
            blocks.push({ type: "heading", level: match[1].length, inline: parseInline(match[2] || "") }); i++; continue;
        }
        if (RULE.test(line)) { blocks.push({ type: "rule" }); i++; continue; }
        if (QUOTE.test(line)) {
            const body = [];
            while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) {
                const quoted = lines[i].match(QUOTE);
                body.push(quoted ? quoted[1] : lines[i]); i++;
            }
            blocks.push({ type: "quote", blocks: parseBlocks(body) });
            continue;
        }
        if (line.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("-")) {
            const header = splitRow(line);
            const align = splitRow(lines[i + 1]).map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null);
            i += 2;
            const rows = [];
            while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
                const cells = splitRow(lines[i++]);
                rows.push(header.map((_, index) => parseInline(cells[index] ?? "")));
            }
            blocks.push({ type: "table", align: header.map((_, index) => align[index] ?? null), header: header.map(parseInline), rows });
            continue;
        }
        if ((match = line.match(ITEM)) && indent(line) < 4) {
            const ordered = /\d/.test(match[2]);
            const base = indent(line);
            const list = { type: "list", ordered, start: ordered ? parseInt(match[2], 10) : null, items: [] };
            while (i < lines.length) {
                const current = lines[i].match(ITEM);
                if (!current || indent(lines[i]) !== base || /\d/.test(current[2]) !== ordered) break;
                const contentIndent = base + current[2].length + Math.min(Math.max(current[3].length, 1), 4);
                const body = [current[4]];
                i++;
                while (i < lines.length) {
                    const next = lines[i];
                    if (blank(next)) {
                        const following = lines.slice(i + 1).find(item => !blank(item));
                        if (following === undefined || indent(following) < contentIndent) break;
                        body.push(""); i++; continue;
                    }
                    if (indent(next) > base) { body.push(next.slice(Math.min(indent(next), contentIndent))); i++; continue; }
                    if (!startsBlock(next) && !blank(body.at(-1)) && !ITEM.test(next)) { body.push(next.trim()); i++; continue; }
                    break;
                }
                let task = null;
                const marker = body[0].match(TASK);
                if (marker) { task = TASK_STATUS[marker[1]]; body[0] = body[0].slice(marker[0].length); }
                list.items.push({ task, blocks: parseBlocks(body) });
                while (i < lines.length && blank(lines[i])) {
                    const following = lines.slice(i).find(item => !blank(item));
                    const again = following?.match(ITEM);
                    if (!again || indent(following) !== base) break;
                    i++;
                }
            }
            blocks.push(list);
            continue;
        }
        const body = [];
        while (i < lines.length && !blank(lines[i]) && (body.length === 0 || !startsBlock(lines[i]))) {
            if (body.length && lines[i].includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) break;
            body.push(lines[i++]);
        }
        blocks.push({ type: "paragraph", inline: parseInline(body.map((item, index) => index < body.length - 1 && /( {2,}|\\)$/.test(item)
            ? item.replace(/( {2,}|\\)$/, "\u0000") : item.trim()).join("\n")) });
    }
    return blocks;
}

export function parse(source) {
    return parseBlocks(stripComments(String(source ?? "").replace(/\r\n?/g, "\n").split("\n")));
}

export function safeHref(href) {
    const value = String(href || "").trim();
    if (!value) return null;
    if (/^(https?:|mailto:)/i.test(value)) return { kind: "external", href: value };
    if (value.startsWith("#")) return { kind: "anchor", href: value };
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\")) return null;
    return { kind: "relative", href: value };
}

function linkTarget(text) {
    const title = text.match(/^(\S+)\s+["'(].*["')]$/);
    return (title ? title[1] : text).replace(/^<|>$/g, "");
}

function findClosing(text, start, delimiter) {
    let index = start;
    while ((index = text.indexOf(delimiter, index)) >= 0) {
        if (text[index - 1] !== " " && text[index - 1] !== "\\" && index > start) return index;
        index += delimiter.length;
    }
    return -1;
}

function findParen(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "\\") { i++; continue; }
        if (text[i] === "(") depth++;
        if (text[i] === ")" && --depth === 0) return i;
    }
    return -1;
}

function findBracket(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "\\") { i++; continue; }
        if (text[i] === "[") depth++;
        if (text[i] === "]" && --depth === 0) return i;
    }
    return -1;
}

export function parseInline(text) {
    const nodes = [];
    let buffer = "";
    const flush = () => { if (buffer) { nodes.push({ type: "text", text: buffer }); buffer = ""; } };
    for (let i = 0; i < text.length;) {
        const char = text[i], rest = text.slice(i);
        if (char === "\u0000") { flush(); nodes.push({ type: "break" }); i++; continue; }
        if (char === "\n") { buffer += " "; i++; continue; }
        if (char === "\\" && /[\\`*_{}\[\]()#+\-.!|<>~]/.test(text[i + 1] || "")) { buffer += text[i + 1]; i += 2; continue; }
        if (char === "`") {
            const run = rest.match(/^`+/)[0];
            const end = text.indexOf(run, i + run.length);
            if (end > 0) { flush(); nodes.push({ type: "code", text: text.slice(i + run.length, end).trim() }); i = end + run.length; continue; }
            buffer += run; i += run.length; continue;
        }
        if ((char === "!" && text[i + 1] === "[") || char === "[") {
            const open = char === "!" ? i + 1 : i;
            const close = findBracket(text, open);
            if (close > 0 && text[close + 1] === "(") {
                const end = findParen(text, close + 1);
                if (end > 0) {
                    flush();
                    const label = text.slice(open + 1, close), target = linkTarget(text.slice(close + 2, end).trim());
                    nodes.push(char === "!" ? { type: "image", alt: label, src: target }
                        : { type: "link", href: target, children: parseInline(label) });
                    i = end + 1; continue;
                }
            }
        }
        const autolink = rest.match(/^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i);
        if (autolink) { flush(); nodes.push({ type: "link", href: autolink[1], children: [{ type: "text", text: autolink[1] }] }); i += autolink[0].length; continue; }
        const bare = /[\s(]/.test(text[i - 1] || " ") && rest.match(/^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/i);
        if (bare) { flush(); nodes.push({ type: "link", href: bare[0], children: [{ type: "text", text: bare[0] }] }); i += bare[0].length; continue; }
        const strong = rest.match(/^(\*\*|__)(?=\S)/);
        if (strong && (strong[1] === "**" || !/\w/.test(text[i - 1] || ""))) {
            const end = findClosing(text, i + 2, strong[1]);
            if (end > 0 && (strong[1] === "**" || !/\w/.test(text[end + 2] || ""))) {
                flush(); nodes.push({ type: "strong", children: parseInline(text.slice(i + 2, end)) }); i = end + 2; continue;
            }
        }
        if ((char === "*" || char === "_") && /\S/.test(text[i + 1] || "") && text[i + 1] !== char && (char === "*" || !/\w/.test(text[i - 1] || ""))) {
            const end = findClosing(text, i + 1, char);
            if (end > 0 && (char === "*" || !/\w/.test(text[end + 1] || ""))) {
                flush(); nodes.push({ type: "em", children: parseInline(text.slice(i + 1, end)) }); i = end + 1; continue;
            }
        }
        buffer += char; i++;
    }
    flush();
    return nodes;
}

export function slug(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

function plain(nodes) {
    return nodes.map(node => node.text ?? (node.children ? plain(node.children) : node.alt ?? "")).join("");
}

// options: { link(href) -> {kind, open?} , chip(status) -> Node, imageText(alt, src) -> string }
export function render(blocks, doc, options = {}) {
    const fragment = doc.createDocumentFragment();
    const make = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
    const inline = (nodes, parent) => {
        for (const node of nodes) {
            if (node.type === "text") parent.append(doc.createTextNode(node.text));
            else if (node.type === "break") parent.append(make("br"));
            else if (node.type === "code") parent.append(make("code", node.text));
            else if (node.type === "strong" || node.type === "em") { const child = make(node.type); inline(node.children, child); parent.append(child); }
            else if (node.type === "image") parent.append(make("span", options.imageText ? options.imageText(node.alt, node.src) : node.alt));
            else if (node.type === "link") {
                const safe = safeHref(node.href);
                const decided = safe && (options.link ? options.link(safe) : safe);
                if (!decided) { const span = make("span"); inline(node.children, span); parent.append(span); continue; }
                const anchor = make("a"); inline(node.children, anchor);
                if (decided.kind === "external") {
                    anchor.href = decided.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
                } else if (decided.kind === "anchor") {
                    anchor.href = "#"; anchor.addEventListener("click", event => {
                        event.preventDefault();
                        doc.getElementById(`md-${decodeURIComponent(decided.href.slice(1))}`)?.scrollIntoView({ block: "start" });
                    });
                } else if (decided.open) {
                    anchor.href = "#"; anchor.title = decided.href;
                    anchor.addEventListener("click", event => { event.preventDefault(); decided.open(); });
                } else { const span = make("span"); inline(node.children, span); span.title = decided.href; parent.append(span); continue; }
                parent.append(anchor);
            }
        }
        return parent;
    };
    const block = (item, parent) => {
        if (item.type === "heading") {
            const node = inline(item.inline, make(`h${item.level}`));
            node.id = `md-${slug(plain(item.inline))}`; parent.append(node);
        } else if (item.type === "paragraph") parent.append(inline(item.inline, make("p")));
        else if (item.type === "rule") parent.append(make("hr"));
        else if (item.type === "code") {
            const pre = make("pre"), code = make("code", item.text);
            if (item.lang) pre.dataset.lang = item.lang;
            pre.append(code); parent.append(pre);
        } else if (item.type === "quote") {
            const quote = make("blockquote"); for (const child of item.blocks) block(child, quote); parent.append(quote);
        } else if (item.type === "list") {
            const list = make(item.ordered ? "ol" : "ul");
            if (item.ordered && item.start !== 1) list.start = item.start;
            for (const entry of item.items) {
                const li = make("li");
                if (entry.task) { li.className = "task-item"; if (options.chip) li.append(options.chip(entry.task), doc.createTextNode(" ")); }
                // A single paragraph stays inline in the item, like GitHub renders tight lists.
                if (entry.blocks.length && entry.blocks[0].type === "paragraph") {
                    inline(entry.blocks[0].inline, li);
                    for (const child of entry.blocks.slice(1)) block(child, li);
                } else for (const child of entry.blocks) block(child, li);
                list.append(li);
            }
            parent.append(list);
        } else if (item.type === "table") {
            const wrap = make("div"); wrap.className = "table-wrap";
            const table = make("table"), head = make("thead"), row = make("tr");
            item.header.forEach((cell, index) => {
                const th = inline(cell, make("th")); th.scope = "col";
                if (item.align[index]) th.style.textAlign = item.align[index];
                row.append(th);
            });
            head.append(row); table.append(head);
            const body = make("tbody");
            for (const cells of item.rows) {
                const tr = make("tr");
                cells.forEach((cell, index) => {
                    const td = inline(cell, make("td"));
                    if (item.align[index]) td.style.textAlign = item.align[index];
                    tr.append(td);
                });
                body.append(tr);
            }
            table.append(body); wrap.append(table); parent.append(wrap);
        }
    };
    for (const item of blocks) block(item, fragment);
    return fragment;
}
