import SwiftUI
import UIKit

enum JianweiBrand {
    static let ink = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.93, green: 0.92, blue: 0.87, alpha: 1)
            : UIColor(red: 0.12, green: 0.15, blue: 0.13, alpha: 1)
    })
    static let forest = Color(red: 0.21, green: 0.36, blue: 0.29)
    static let rust = Color(red: 0.54, green: 0.35, blue: 0.27)
    static let mutedText = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.72, green: 0.72, blue: 0.68, alpha: 1)
            : UIColor(red: 0.31, green: 0.33, blue: 0.30, alpha: 1)
    })
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.08, green: 0.10, blue: 0.09, alpha: 1)
            : UIColor(red: 0.96, green: 0.94, blue: 0.89, alpha: 1)
    })
    static let surface = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.13, green: 0.15, blue: 0.14, alpha: 1)
            : UIColor(red: 0.995, green: 0.99, blue: 0.97, alpha: 1)
    })
    static let secondarySurface = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.18, green: 0.20, blue: 0.19, alpha: 1)
            : UIColor(red: 0.91, green: 0.89, blue: 0.84, alpha: 1)
    })
}

struct JianweiMark: View {
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            Circle()
                .stroke(JianweiBrand.forest, lineWidth: size * 0.12)
                .frame(width: size * 0.62, height: size * 0.62)
                .offset(x: -size * 0.08, y: -size * 0.08)
            Capsule()
                .fill(JianweiBrand.forest)
                .frame(width: size * 0.13, height: size * 0.4)
                .rotationEffect(.degrees(-43))
                .offset(x: size * 0.24, y: size * 0.25)
            Circle()
                .fill(JianweiBrand.rust)
                .frame(width: size * 0.18, height: size * 0.18)
                .offset(x: size * 0.17, y: -size * 0.19)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct PillLabel: View {
    let icon: String
    let text: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .background(.black.opacity(0.62), in: Capsule())
    }
}

struct CardPhoto: View {
    let data: Data?
    let objectName: String

    var body: some View {
        GeometryReader { proxy in
            if let data, let image = UIImage(data: data) {
                let preservesWholeImage = CardPhotoLayout.preservesWholeImage(image.size)
                let fittedSize = CardPhotoLayout.fittedSize(image.size, in: proxy.size)
                ZStack {
                    if preservesWholeImage {
                        Image(uiImage: image)
                            .resizable()
                            // This layer is intentionally stretched: after a
                            // heavy blur it is only ambient color, and its exact
                            // frame prevents a panorama's intrinsic width from
                            // escaping the card layout.
                            .frame(width: proxy.size.width, height: proxy.size.height)
                            .blur(radius: 18)
                            .overlay(.black.opacity(0.16))
                        Image(uiImage: image)
                            .resizable()
                            .frame(width: fittedSize.width, height: fittedSize.height)
                    } else {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: proxy.size.width, height: proxy.size.height)
                    }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipped()
            } else {
                ZStack {
                    LinearGradient(
                        colors: [JianweiBrand.secondarySurface, JianweiBrand.forest.opacity(0.24)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "photo")
                        .font(.system(size: 34, weight: .light))
                        .foregroundStyle(JianweiBrand.forest.opacity(0.62))
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        // The surrounding card or saved row already exposes the recognized
        // object, title and source. A scaled-to-fill UIImage otherwise keeps
        // its uncropped accessibility frame and can cover nearby controls.
        .accessibilityHidden(true)
    }

}

extension View {
    func jianweiCard(cornerRadius: CGFloat = 24) -> some View {
        background(JianweiBrand.surface, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(JianweiBrand.ink.opacity(0.06), lineWidth: 0.5)
            }
            .shadow(color: .black.opacity(0.06), radius: 18, y: 8)
    }
}
