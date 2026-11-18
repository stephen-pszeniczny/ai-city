// Draws the notifier's icon (a small space station on a deep blue tile) as PNGs
// for every size an .icns needs. Run by scripts/build_notifier.py:
//   swift helpers/notifier_icon.swift <iconset folder>
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    // Tile: rounded square, black to royal blue.
    let tile = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s),
                            xRadius: s * 0.22, yRadius: s * 0.22)
    NSGradient(starting: NSColor(red: 0.02, green: 0.03, blue: 0.08, alpha: 1),
               ending: NSColor(red: 0.20, green: 0.34, blue: 0.88, alpha: 1))!.draw(in: tile, angle: 90)

    // A few stars.
    NSColor(white: 1, alpha: 0.85).setFill()
    for (x, y, r) in [(0.18, 0.80, 0.012), (0.80, 0.84, 0.009), (0.86, 0.22, 0.010), (0.12, 0.30, 0.008)] {
        NSBezierPath(ovalIn: NSRect(x: s * x, y: s * y, width: s * r * 2, height: s * r * 2)).fill()
    }

    // The station: two modules joined to a hub, with solar panels.
    let white = NSColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1)
    let gold = NSColor(red: 0.82, green: 0.60, blue: 0.21, alpha: 1)
    let panel = NSColor(red: 0.16, green: 0.30, blue: 0.75, alpha: 1)
    panel.setFill()
    NSBezierPath(rect: NSRect(x: s * 0.10, y: s * 0.30, width: s * 0.16, height: s * 0.40)).fill()
    NSBezierPath(rect: NSRect(x: s * 0.74, y: s * 0.30, width: s * 0.16, height: s * 0.40)).fill()
    white.setFill()
    NSBezierPath(rect: NSRect(x: s * 0.26, y: s * 0.485, width: s * 0.48, height: s * 0.03)).fill()
    NSBezierPath(roundedRect: NSRect(x: s * 0.24, y: s * 0.43, width: s * 0.18, height: s * 0.14),
                 xRadius: s * 0.05, yRadius: s * 0.05).fill()
    gold.setFill()
    NSBezierPath(roundedRect: NSRect(x: s * 0.58, y: s * 0.43, width: s * 0.18, height: s * 0.14),
                 xRadius: s * 0.05, yRadius: s * 0.05).fill()
    NSColor(red: 0.35, green: 0.48, blue: 0.92, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: s * 0.44, y: s * 0.44, width: s * 0.12, height: s * 0.12)).fill()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try! draw(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
    try! draw(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
