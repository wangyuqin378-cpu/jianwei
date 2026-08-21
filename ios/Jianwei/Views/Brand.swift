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
            .foregroundStyle(JianweiBrand.forest)
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .background(JianweiBrand.forest.opacity(0.11), in: Capsule())
    }
}

struct CardPhoto: View {
    let data: Data?
    let objectName: String

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
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
            }
        }
        .accessibilityLabel(data == nil ? "照片缩略图暂不可用" : "\(objectName)的原照片")
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
