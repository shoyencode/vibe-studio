import path from "node:path";

export function profilePath(appData, override = "") {
    return path.resolve(override || path.join(appData, "Vibe Studio"));
}
