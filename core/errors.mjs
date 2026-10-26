import { t } from "./i18n.mjs";

// A user-facing error: the message is English, the key and values let each screen translate it.
export class UserError extends Error {
    constructor(key, vars = {}) {
        super(t("en", key, vars));
        this.key = key;
        this.vars = vars;
    }
}

export function localize(error, language) {
    return error instanceof UserError ? t(language, error.key, error.vars) : null;
}
