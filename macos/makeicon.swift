// Renders the app icon (rounded orange square + white Y) to appicon_1024.png.
// Run: swift makeicon.swift <output.png>
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "appicon_1024.png"

let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

// macOS icons float inside the canvas with a margin (~10%).
let margin = size * 0.10
let rect = NSRect(x: margin, y: margin, width: size - margin * 2, height: size - margin * 2)
let path = NSBezierPath(roundedRect: rect, xRadius: size * 0.16, yRadius: size * 0.16)

// Subtle vertical gradient of HN orange.
let gradient = NSGradient(
    starting: NSColor(calibratedRed: 1.0, green: 0.54, blue: 0.24, alpha: 1),
    ending: NSColor(calibratedRed: 1.0, green: 0.40, blue: 0.0, alpha: 1)
)
gradient?.draw(in: path, angle: -90)

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let font = NSFont(name: "Verdana-Bold", size: size * 0.52) ?? NSFont.boldSystemFont(ofSize: size * 0.52)
let attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: NSColor.white,
    .paragraphStyle: paragraph,
]
let str = NSAttributedString(string: "Y", attributes: attrs)
let textSize = str.size()
str.draw(at: NSPoint(x: (size - textSize.width) / 2, y: (size - textSize.height) / 2))

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("could not render icon")
}
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
