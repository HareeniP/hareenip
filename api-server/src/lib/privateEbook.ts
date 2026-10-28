import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const privateEbookPath = fileURLToPath(
  new URL("../private/ebook.pdf", import.meta.url),
);

export async function assertPrivateEbookAvailable(): Promise<void> {
  try {
    await access(privateEbookPath, constants.R_OK);
    const metadata = await stat(privateEbookPath);
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error("Invalid private ebook asset.");
    }
  } catch {
    throw new Error("Private ebook asset is missing or unreadable.");
  }
}
