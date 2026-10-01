import { app } from "electron";
import path from "path";

/**
 * Resolve a path to a bundled asset in both a checkout and a packaged build. A
 * packaged build reads from app.asar.unpacked, so every asset that getAssetPath()
 * resolves must have an entry under asarUnpack in package.json. An uncovered
 * asset builds cleanly and fails only at runtime.
 */
export function getAssetPath(...parts: string[]): string {
 const base = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked")
  : path.join(__dirname, "..");
 return path.join(base, ...parts);
}

interface PackageJson {
 description?: string;
 license?: string;
}

/** Product details shared by the About window and tray. */
export interface ProductInfo {
 productName: string;
 description: string;
 license: string;
}

let cachedProductInfo: ProductInfo | null = null;

/**
 * Read and cache product details from package.json and Electron's application name.
 * require() reads package.json through the asar archive, so it needs no
 * asarUnpack entry.
 */
export function getProductInfo(): ProductInfo {
 if (cachedProductInfo) {
  return cachedProductInfo;
 }

 const pkg = require(path.join(__dirname, "..", "package.json")) as PackageJson;
 cachedProductInfo = {
  productName: app.getName(),
  description: pkg.description ?? "",
  license: pkg.license ?? "",
 };

 return cachedProductInfo;
}
