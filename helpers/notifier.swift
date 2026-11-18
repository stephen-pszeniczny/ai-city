// The Asteroid Belt notifier: posts one Mac notification, or opens the app when
// a notification is clicked. Built into build/Asteroid Belt Notifier.app by
// scripts/build_notifier.py (nothing downloaded); notifications show as
// "Asteroid Belt" with the app's icon.
//
//   notifier --title T --body B   post a notification, then quit
//   notifier --clear              remove all of this app's notifications, then quit
//   notifier                      (macOS starts it like this when a notification is
//                                  clicked) open the app, then quit
//
// The first time, macOS asks the owner to allow notifications. Opening the app:
// the Safari Dock app "Asteroid Belt" if it exists, otherwise the page in the
// default browser.
import AppKit
import UserNotifications

let pageURL = URL(string: "http://127.0.0.1:8765")!
let dockApp = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Applications/Asteroid Belt.app")

func value(after flag: String, in args: [String]) -> String? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func openTheApp() {
    if FileManager.default.fileExists(atPath: dockApp.path) {
        NSWorkspace.shared.openApplication(at: dockApp, configuration: .init()) { _, _ in }
    } else {
        NSWorkspace.shared.open(pageURL)
    }
}

final class ClickHandler: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler done: @escaping () -> Void
    ) {
        openTheApp()
        done()
        // Give the open a moment to be handed over before quitting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSApp.terminate(nil) }
    }
}

let args = CommandLine.arguments
let center = UNUserNotificationCenter.current()

if args.contains("--clear") {
    center.removeAllDeliveredNotifications()
    center.removeAllPendingNotificationRequests()
    Thread.sleep(forTimeInterval: 0.5)  // let the request reach Notification Centre
    exit(0)
}

if let title = value(after: "--title", in: args), let body = value(after: "--body", in: args) {
    // Post one notification and quit.
    let finished = DispatchSemaphore(value: 0)
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
        guard granted else { finished.signal(); return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(request) { _ in finished.signal() }
    }
    _ = finished.wait(timeout: .now() + 10)
    exit(0)
}

// Started by a click: wait for macOS to hand over the click, open the app, quit.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let handler = ClickHandler()
center.delegate = handler
DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
    // Started some other way (e.g. double-clicked): just open the app.
    openTheApp()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSApp.terminate(nil) }
}
app.run()
