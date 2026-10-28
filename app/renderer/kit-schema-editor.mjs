// Generic contract editor for the expert view: renders any part of the protocol-2 schema as a form.
export function createSchemaEditor({ el, button, t, schema }) {
    const resolve = value => value?.$ref
        ? { ...schema.$defs[value.$ref.split("/").at(-1)], ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref")) }
        : value || {};
    const initial = raw => {
        const def = resolve(raw);
        if (def.oneOf || def.anyOf) return initial((def.oneOf || def.anyOf)[0]);
        if (Array.isArray(def.type) && def.type.includes("null")) return null;
        if (def.const !== undefined) return def.const;
        if (def.default !== undefined) return structuredClone(def.default);
        if (def.enum) return def.enum[0];
        if (def.type === "array") return [];
        if (def.type === "object" || def.properties) return Object.fromEntries((def.required || []).map(key => [key, initial(def.properties?.[key])]));
        if (def.type === "boolean") return false;
        if (def.type === "integer" || def.type === "number") return def.minimum || 0;
        return "";
    };
    const labelFor = key => {
        const numbered = key.match(/^(.*) (\d+)$/);
        if (numbered) return `${labelFor(numbered[1])} ${numbered[2]}`;
        const translated = t(`author.field.${key}`);
        return translated === `author.field.${key}` ? key.replace(/([a-z])([A-Z])/g, "$1 $2") : translated;
    };
    function editor(raw, value, set, name) {
        const def = resolve(raw), box = el("div", undefined, "schema-field");
        const label = labelFor(name);
        if (def.oneOf || def.anyOf) {
            const variants = def.oneOf || def.anyOf;
            let index = variants.findIndex(candidate => resolve(candidate).type === (Array.isArray(value) ? "array" : typeof value));
            if (index < 0) index = 0;
            const choice = el("select"), row = el("label", label), content = el("div");
            variants.forEach((candidate, optionIndex) => {
                const option = el("option", t(resolve(candidate).type === "array" ? "author.multiple" : "author.single"));
                option.value = optionIndex; choice.append(option);
            });
            choice.value = index;
            const draw = () => { content.replaceChildren(editor(variants[index], value, next => { value = next; set(next); }, name)); };
            choice.addEventListener("change", () => {
                index = Number(choice.value);
                value = resolve(variants[index]).type === "array" ? [value] : Array.isArray(value) ? value[0] || initial(variants[index]) : value;
                set(value); draw();
            });
            row.append(choice); box.append(row, content); draw(); return box;
        }
        if (def.const !== undefined) { box.append(el("span", `${label}: ${def.const}`, "muted")); return box; }
        if (Array.isArray(def.type) && def.type.includes("null")) {
            const toggle = el("input"); toggle.type = "checkbox"; toggle.checked = value !== null;
            const row = el("label", label, "schema-check"); row.prepend(toggle); box.append(row);
            const content = el("div");
            const plain = { ...def, type: def.type.find(type => type !== "null") };
            const draw = () => { content.replaceChildren(); if (value !== null) content.append(editor(plain, value, next => { value = next; set(next); }, name)); };
            toggle.addEventListener("change", () => { value = toggle.checked ? initial(plain) : null; set(value); draw(); });
            draw(); box.append(content); return box;
        }
        if (def.type === "object" || def.properties || (value && typeof value === "object" && !Array.isArray(value))) {
            const properties = def.properties || {}, object = value || {};
            const body = el("div", undefined, "schema-object");
            const draw = () => {
                body.replaceChildren();
                for (const key of Object.keys(object)) {
                    const row = el("div", undefined, "schema-property");
                    row.append(editor(properties[key] || (typeof def.additionalProperties === "object" ? def.additionalProperties : { type: typeof object[key] }),
                        object[key], next => { object[key] = next; set(object); }, key));
                    if (!(def.required || []).includes(key)) row.append(button(t("author.remove"), () => { delete object[key]; set(object); draw(); }, "quiet"));
                    body.append(row);
                }
                const available = [...Object.keys(properties), ...(def.propertyNames?.enum || [])].filter(key => !(key in object));
                if (available.length || def.additionalProperties !== false) {
                    const actions = el("div", undefined, "actions");
                    const keyInput = available.length ? el("select") : el("input");
                    keyInput.setAttribute("aria-label", t("author.addField"));
                    for (const key of available) { const option = el("option", labelFor(key)); option.value = key; keyInput.append(option); }
                    if (!available.length) keyInput.placeholder = t("author.propertyName");
                    actions.append(keyInput, button(t("author.addField"), () => {
                        const key = keyInput.value.trim();
                        if (!key || Object.hasOwn(object, key) || ["__proto__", "constructor", "prototype"].includes(key)) return;
                        object[key] = initial(properties[key] || def.additionalProperties);
                        set(object); draw();
                    }));
                    body.append(actions);
                }
            };
            const group = el("fieldset"); group.append(el("legend", label), body); box.append(group); draw(); return box;
        }
        if (def.type === "array" || Array.isArray(value)) {
            const list = value || [], group = el("fieldset"), body = el("div");
            group.append(el("legend", label), body); box.append(group);
            const draw = () => {
                body.replaceChildren();
                list.forEach((item, index) => {
                    const row = el("div", undefined, "schema-item");
                    row.append(editor(def.items || {}, item, next => { list[index] = next; set(list); }, `${name} ${index + 1}`));
                    const actions = el("div", undefined, "actions");
                    if (index) actions.append(button(t("author.moveUp"), () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; set(list); draw(); }, "quiet"));
                    actions.append(button(t("author.remove"), () => { list.splice(index, 1); set(list); draw(); }, "quiet"));
                    row.append(actions); body.append(row);
                });
                const add = button(t("author.addItem"), () => { list.push(initial(def.items)); set(list); draw(); });
                add.disabled = list.length >= (def.maxItems ?? 500); body.append(add);
            };
            draw(); return box;
        }
        const row = el("label", label);
        let input;
        if (def.enum) {
            input = el("select");
            for (const entry of def.enum) { const option = el("option", String(entry)); option.value = String(entry); input.append(option); }
        } else if (def.type === "boolean") { input = el("input"); input.type = "checkbox"; input.checked = !!value; row.className = "schema-check"; }
        else if (def.type === "number" || def.type === "integer") {
            input = el("input"); input.type = "number"; input.step = def.type === "integer" ? "1" : "any";
            if (def.minimum !== undefined) input.min = def.minimum;
        } else {
            input = el(/summary|description|returns|about|reason/i.test(name) ? "textarea" : "input");
            if (input.tagName === "TEXTAREA") input.rows = 3;
        }
        if (input.type !== "checkbox") input.value = value ?? "";
        input.addEventListener("input", () => set(input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value));
        if (input.type === "checkbox") row.prepend(input); else row.append(input);
        box.append(row);
        return box;
    }
    return { editor, initial, resolve };
}
