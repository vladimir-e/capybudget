#!/usr/bin/env node
// Generate the App Store listing icon: a 1024×1024 PNG with NO alpha channel,
// which App Store Connect requires (it rejects any transparency). The app
// bundle's icon.icns keeps its shaped/transparent reps untouched — this is a
// separate marketing asset uploaded through App Store Connect, not bundled.
//
// Source is the 1024 (512@2x) representation already inside icon.icns. The
// rounded-corner transparency is filled with the icon's own gradient (the icon
// drawn oversized underneath), so nothing odd shows if Apple's store UI masks
// the corners differently than the artwork's own radius.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { SRC_TAURI, fail } from "./mas-common.mjs";

const ICNS = resolve(SRC_TAURI, "icons/icon.icns");
const OUT = resolve(SRC_TAURI, "icons/AppStore-1024.png");

if (!existsSync(ICNS)) fail(`no icon at ${ICNS}`);

const work = mkdtempSync(join(tmpdir(), "mas-store-icon-"));
const iconset = join(work, "icon.iconset");
try {
  execFileSync("iconutil", ["--convert", "iconset", ICNS, "--output", iconset]);
} catch (err) {
  rmSync(work, { recursive: true, force: true });
  fail(`iconutil failed to expand icon.icns: ${err.message}`);
}

const src = join(iconset, "icon_512x512@2x.png");
if (!existsSync(src)) {
  rmSync(work, { recursive: true, force: true });
  fail(
    "icon.icns has no 512x512@2x (1024px) representation.\n" +
      "       The store icon must be 1024px and can't be upscaled — regenerate\n" +
      "       icon.icns from a ≥1024px master (e.g. `npm run tauri icon <master.png>`).",
  );
}

// Flatten with CoreGraphics. The icon is drawn into an RGBA buffer, then each
// row's transparent ends (the rounded corners) are filled with that row's
// nearest opaque pixel — the icon's gradient is vertical, so this reconstructs
// smooth square corners with no visible seam. The opaque result is copied into
// an RGBX (noneSkipLast) context so the PNG carries no alpha channel, which
// App Store Connect requires.
const SWIFT = `
import CoreGraphics
import ImageIO
import Foundation
let a = CommandLine.arguments
let src = a[a.count - 2], out = a[a.count - 1]
let size = 1024, bpr = size * 4
guard let isrc = CGImageSourceCreateWithURL(URL(fileURLWithPath: src) as CFURL, nil),
  let img = CGImageSourceCreateImageAtIndex(isrc, 0, nil) else { fputs("load failed\\n", stderr); exit(1) }
let rgb = CGColorSpaceCreateDeviceRGB()
guard let ca = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
  bytesPerRow: bpr, space: rgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
  let buf = ca.data else { fputs("alloc failed\\n", stderr); exit(1) }
ca.draw(img, in: CGRect(x: 0, y: 0, width: size, height: size))
let p = buf.bindMemory(to: UInt8.self, capacity: bpr * size)
for y in 0..<size {
  let row = y * bpr
  var first = -1, last = -1
  for x in 0..<size where p[row + x * 4 + 3] == 255 { if first < 0 { first = x }; last = x }
  if first < 0 { continue }
  for (edge, range) in [(first, 0..<first), (last, (last + 1)..<size)] {
    let e = row + edge * 4
    for x in range {
      let o = row + x * 4
      p[o] = p[e]; p[o + 1] = p[e + 1]; p[o + 2] = p[e + 2]; p[o + 3] = 255
    }
  }
}
guard let flat = ca.makeImage(),
  let cb = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: 0, space: rgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
  else { fputs("encode failed\\n", stderr); exit(1) }
cb.draw(flat, in: CGRect(x: 0, y: 0, width: size, height: size))
guard let outImg = cb.makeImage(),
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)
  else { fputs("encode failed\\n", stderr); exit(1) }
CGImageDestinationAddImage(dest, outImg, nil)
guard CGImageDestinationFinalize(dest) else { fputs("write failed\\n", stderr); exit(1) }
`;

const swiftFile = join(work, "flatten.swift");
const bin = join(work, "flatten");
try {
  writeFileSync(swiftFile, SWIFT);
  execFileSync("swiftc", ["-O", "-o", bin, swiftFile]);
  execFileSync(bin, [src, OUT]);
} catch (err) {
  rmSync(work, { recursive: true, force: true });
  fail(`swift flatten failed: ${err.message}`);
}

rmSync(work, { recursive: true, force: true });

const info = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", OUT], {
  encoding: "utf8",
});
if (!/pixelWidth:\s*1024/.test(info) || !/pixelHeight:\s*1024/.test(info)) {
  fail(`output is not 1024x1024:\n${info}`);
}
if (!/hasAlpha:\s*no/.test(info)) {
  fail(`output still has an alpha channel — App Store Connect will reject it:\n${info}`);
}

console.log(`Wrote ${OUT} (1024x1024, no alpha).`);
console.log("Upload it as the app icon in App Store Connect › App Information.");
