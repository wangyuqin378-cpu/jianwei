import AppKit
import CoreGraphics
import Foundation

let output = CommandLine.arguments.dropFirst().first ?? "Jianwei/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
let width = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
    data: nil,
    width: width,
    height: width,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else {
    fatalError("Unable to create icon context")
}

context.setFillColor(CGColor(red: 0.96, green: 0.94, blue: 0.89, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: width, height: width))

context.setStrokeColor(CGColor(red: 0.21, green: 0.36, blue: 0.29, alpha: 1))
context.setLineWidth(78)
context.strokeEllipse(in: CGRect(x: 235, y: 205, width: 430, height: 430))

context.setLineCap(.round)
context.move(to: CGPoint(x: 635, y: 595))
context.addLine(to: CGPoint(x: 805, y: 765))
context.strokePath()

context.setFillColor(CGColor(red: 0.54, green: 0.35, blue: 0.27, alpha: 1))
context.fillEllipse(in: CGRect(x: 625, y: 205, width: 118, height: 118))

context.setStrokeColor(CGColor(red: 0.54, green: 0.35, blue: 0.27, alpha: 1))
context.setLineWidth(24)
context.move(to: CGPoint(x: 684, y: 154))
context.addLine(to: CGPoint(x: 684, y: 114))
context.move(to: CGPoint(x: 759, y: 220))
context.addLine(to: CGPoint(x: 800, y: 206))
context.strokePath()

guard let image = context.makeImage() else { fatalError("Unable to render icon") }
let representation = NSBitmapImageRep(cgImage: image)
guard let data = representation.representation(using: .png, properties: [:]) else {
    fatalError("Unable to encode icon")
}
try data.write(to: URL(fileURLWithPath: output), options: .atomic)
