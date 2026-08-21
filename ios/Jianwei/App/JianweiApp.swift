import SwiftUI

@main
struct JianweiApp: App {
    @State private var model: AppModel

    init() {
        do {
            let environment = try AppEnvironment.live()
            BackgroundDiscoveryController.register(environment: environment)
            _model = State(initialValue: AppModel(environment: environment))
        } catch {
            fatalError("Unable to initialize Jianwei local storage: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
                .onOpenURL { model.open(url: $0) }
        }
    }
}
