import AppKit
import UniformTypeIdentifiers
import WebKit

private let appName = "Исследование операций"

final class LabWindow: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let environment = ProcessInfo.processInfo.environment
    private var project: URL {
        if let path = environment["LAB_ROOT"] {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return Bundle.main.resourceURL ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let ui = project.appendingPathComponent("ui", isDirectory: true)
        let configuration = WKWebViewConfiguration()
        for command in ["copy", "save"] {
            configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: command)
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1370, height: 850),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = appName
        window.contentMinSize = NSSize(width: 760, height: 520)
        window.contentView = webView
        window.center()
        NSApp.mainMenu = makeMenu()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadFileURL(ui.appendingPathComponent("index.html"), allowingReadAccessTo: ui)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        let application = NSMenuItem()
        application.submenu = NSMenu(title: appName)
        application.submenu?.addItem(withTitle: "Закрыть приложение", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(application)
        let edit = NSMenuItem()
        let editing = NSMenu(title: "Правка")
        editing.addItem(withTitle: "Вырезать", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editing.addItem(withTitle: "Копировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editing.addItem(withTitle: "Вставить", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editing.addItem(withTitle: "Выделить всё", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editing
        menu.addItem(edit)
        return menu
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let page = project.appendingPathComponent("ui/index.html").resolvingSymlinksInPath().standardizedFileURL
        decisionHandler(navigationAction.request.url?.resolvingSymlinksInPath().standardizedFileURL == page ? .allow : .cancel)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame else {
            replyHandler(nil, "Недоступное действие.")
            return
        }
        switch message.name {
        case "copy":
            guard let text = message.body as? String else { replyHandler(nil, "Нет отчёта."); return }
            NSPasteboard.general.clearContents()
            replyHandler(NSPasteboard.general.setString(text, forType: .string), nil)
        case "save":
            guard let text = message.body as? String else { replyHandler(nil, "Нет отчёта."); return }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = "решение.txt"
            panel.allowedContentTypes = [.plainText]
            panel.beginSheetModal(for: window) { action in
                guard action == .OK, let destination = panel.url else { replyHandler(false, nil); return }
                do {
                    try text.write(to: destination, atomically: true, encoding: .utf8)
                    replyHandler(true, nil)
                } catch {
                    replyHandler(nil, "Не удалось сохранить отчёт.")
                }
            }
        default:
            replyHandler(nil, "Недоступное действие.")
        }
    }
}

let app = NSApplication.shared
let delegate = LabWindow()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
