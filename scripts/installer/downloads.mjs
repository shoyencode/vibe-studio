import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export function verifyIntegrity(bytes, integrity) {
    const match = /^(sha256|sha512)([:-])([A-Za-z0-9+/=]+)$/.exec(integrity);
    if (!match) throw new Error("Unsupported download integrity.");
    if (createHash(match[1]).update(bytes).digest(match[2] === ":" ? "hex" : "base64") !== match[3]) throw new Error("Download integrity mismatch.");
}

export async function download(asset, destination) {
    await mkdir(path.dirname(destination), { recursive: true });
    try {
        verifyIntegrity(await readFile(destination), asset.integrity);
        return destination;
    } catch (error) {
        if (error.code !== "ENOENT" && error.message !== "Download integrity mismatch.") throw error;
    }
    const temporary = `${destination}.partial`;
    try {
        const response = await fetch(asset.url, { signal: AbortSignal.timeout(300_000) });
        if (!response.ok) throw new Error(`Download failed: ${response.status} ${asset.url}`);
        await pipeline(response.body, createWriteStream(temporary), { signal: AbortSignal.timeout(300_000) });
        verifyIntegrity(await readFile(temporary), asset.integrity);
        await rename(temporary, destination);
        return destination;
    } finally {
        await rm(temporary, { force: true });
    }
}
