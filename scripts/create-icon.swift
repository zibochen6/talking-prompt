import AppKit

let size = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let context = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
let bg = NSBezierPath(roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928), xRadius: 220, yRadius: 220)
NSColor(calibratedRed: 0.07, green: 0.09, blue: 0.07, alpha: 1).setFill()
bg.fill()
NSColor(calibratedRed: 0.77, green: 0.96, blue: 0.65, alpha: 1).setStroke()
for (y, end) in [(650.0, 740.0), (512.0, 605.0), (374.0, 690.0)] {
  let line = NSBezierPath()
  line.lineWidth = 46
  line.lineCapStyle = .round
  line.move(to: NSPoint(x: 284, y: y))
  line.line(to: NSPoint(x: end, y: y))
  line.stroke()
}
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
let data = bitmap.representation(using: .png, properties: [:])!
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
