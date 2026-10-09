import ExpoModulesCore
import UIKit

struct HerdCommand: Record {
  @Field var id: String = ""
  @Field var key: String = ""
  @Field var meta: Bool = false
  @Field var alt: Bool = false
  @Field var shift: Bool = false
  @Field var scope: String = "global"
  @Field var target: String = ""
  @Field var allowEditable: Bool = false
  @Field var requireText: Bool = false

  var flags: UIKeyModifierFlags {
    var result: UIKeyModifierFlags = []
    if meta { result.insert(.command) }
    if alt { result.insert(.alternate) }
    if shift { result.insert(.shift) }
    return result
  }
  var input: String {
    switch key {
    case "Escape": return UIKeyCommand.inputEscape
    case "ArrowUp": return UIKeyCommand.inputUpArrow
    case "ArrowDown": return UIKeyCommand.inputDownArrow
    case "Tab": return "\t"
    case "Enter": return "\r"
    default: return key
    }
  }
}

public final class HerdInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdInput")
    AsyncFunction("restoreFocus") {
      HerdInputView.restoreIdleHosts()
    }.runOnQueue(.main)
    View(HerdInputView.self) {
      Events("onCommand")
      Prop("host") { (view: HerdInputView, value: Bool) in
        view.host = value
        view.restoreResponderIfIdle()
      }
      Prop("targetId") { (view: HerdInputView, value: String) in view.targetID = value }
      Prop("commands") { (view: HerdInputView, value: [HerdCommand]) in view.commands = value }
    }
  }
}

final class HerdInputView: ExpoView {
  let onCommand = EventDispatcher()
  private static let hosts = NSHashTable<HerdInputView>.weakObjects()
  var host = false {
    didSet {
      if host { Self.hosts.add(self) }
      else { Self.hosts.remove(self) }
    }
  }
  static func restoreIdleHosts() {
    hosts.allObjects.forEach { $0.restoreResponderIfIdle() }
  }
  var targetID = ""
  var commands: [HerdCommand] = []
  private var heldDigits = Set<UIKeyboardHIDUsage>()
  private var observers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    for name in [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification, UIWindow.didBecomeKeyNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.restoreResponderIfIdle()
      })
    }
  }

  deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

  override var canBecomeFirstResponder: Bool { host }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { heldDigits.removeAll() }
    restoreResponderIfIdle()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    restoreResponderIfIdle()
  }

  override func resignFirstResponder() -> Bool {
    let resigned = super.resignFirstResponder()
    if resigned { heldDigits.removeAll() }
    return resigned
  }

  private func firstResponder(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    for child in view.subviews {
      if let found = firstResponder(in: child) { return found }
    }
    return nil
  }

  private func target(_ id: String, in view: UIView) -> HerdInputView? {
    if let candidate = view as? HerdInputView, candidate.targetID == id { return candidate }
    for child in view.subviews {
      if let found = target(id, in: child) { return found }
    }
    return nil
  }

  // A root host must not reclaim focus from a presented native modal or text field.
  private var activeHost: Bool {
    guard host, let window, window.isKeyWindow, !isHidden, alpha > 0 else { return false }
    var top = window.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    guard let topView = top?.view, isDescendant(of: topView) else { return false }
    return visible(self, in: window)
  }

  func restoreResponderIfIdle() {
    guard host else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, self.activeHost, let window = self.window,
            self.firstResponder(in: window) == nil else { return }
      self.becomeFirstResponder()
    }
  }

  private func visible(_ view: UIView, in window: UIWindow) -> Bool {
    guard view.window === window else { return false }
    var rect = view.convert(view.bounds, to: window).intersection(window.bounds)
    var ancestor: UIView? = view
    while let node = ancestor {
      if node.isHidden || node.alpha <= 0.01 { return false }
      if node.clipsToBounds { rect = rect.intersection(node.convert(node.bounds, to: window)) }
      ancestor = node.superview
    }
    if rect.isNull || rect.isEmpty { return false }
    let insetX = min(CGFloat(4), rect.width / 2)
    let insetY = min(CGFloat(4), rect.height / 2)
    for x in [rect.minX + insetX, rect.midX, rect.maxX - insetX] {
      for y in [rect.minY + insetY, rect.midY, rect.maxY - insetY] {
        if let hit = window.hitTest(CGPoint(x: x, y: y), with: nil), hit.isDescendant(of: view) { return true }
      }
    }
    return false
  }

  private func eligible(_ command: HerdCommand) -> Bool {
    guard activeHost, let window else { return false }
    let responder = firstResponder(in: window)
    let input = responder as? UITextInput
    if input?.markedTextRange != nil { return false }
    if command.requireText {
      let text = (responder as? UITextView)?.text ?? (responder as? UITextField)?.text ?? ""
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
    }
    switch command.scope {
    case "composer":
      guard let responder, let anchor = target(command.target, in: self) else { return false }
      return responder.isDescendant(of: anchor) && visible(anchor, in: window)
    case "permission":
      if input != nil || commands.contains(where: { $0.scope == "overlay" }) { return false }
      guard let anchor = target(command.target, in: self) else { return false }
      return visible(anchor, in: window)
    case "overlay": return command.allowEditable || input == nil
    default: return true
    }
  }

  override var keyCommands: [UIKeyCommand]? {
    var seen = Set<String>()
    return commands.filter { $0.scope != "permission" && eligible($0) }.compactMap { descriptor in
      let chord = "\(descriptor.input):\(descriptor.flags.rawValue)"
      guard seen.insert(chord).inserted else { return nil }
      let command = UIKeyCommand(input: descriptor.input, modifierFlags: descriptor.flags, action: #selector(runCommand(_:)))
      // Advertised only after focus and marked-text checks, so UIKit text editing
      // keeps all keys that this currently focused UI does not handle.
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
  }

  @objc private func runCommand(_ command: UIKeyCommand) {
    guard let descriptor = commands.first(where: {
      $0.scope != "permission" && $0.input == command.input && $0.flags == command.modifierFlags && eligible($0)
    }) else { return }
    emit(descriptor)
  }

  private func emit(_ command: HerdCommand) {
    onCommand(["id": command.id, "key": command.key, "meta": command.meta, "alt": command.alt, "shift": command.shift])
  }

  // Number answers need physical press lifetime, which UIKeyCommand does not
  // expose on older supported iOS versions. Keep a held key consumed after its
  // first card disappears, until release, so it cannot approve the next card.
  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var remaining = Set<UIPress>()
    for press in presses {
      guard let key = press.key else { remaining.insert(press); continue }
      if heldDigits.contains(key.keyCode) { continue }
      let modifiers = key.modifierFlags.intersection([.command, .control, .alternate, .shift])
      guard modifiers.isEmpty,
            let oldest = commands.first(where: { $0.scope == "permission" && eligible($0) }),
            let descriptor = commands.first(where: { $0.scope == "permission" && $0.target == oldest.target && $0.key == key.characters })
      else { remaining.insert(press); continue }
      heldDigits.insert(key.keyCode)
      emit(descriptor)
    }
    if !remaining.isEmpty { super.pressesBegan(remaining, with: event) }
  }

  override func pressesChanged(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let remaining = presses.filter { $0.key.map { !heldDigits.contains($0.keyCode) } ?? true }
    if !remaining.isEmpty { super.pressesChanged(Set(remaining), with: event) }
  }

  private func finish(_ presses: Set<UIPress>) -> Set<UIPress> {
    var remaining = Set<UIPress>()
    for press in presses {
      if let key = press.key, heldDigits.remove(key.keyCode) != nil { continue }
      remaining.insert(press)
    }
    return remaining
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let remaining = finish(presses)
    if !remaining.isEmpty { super.pressesEnded(remaining, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let remaining = finish(presses)
    if !remaining.isEmpty { super.pressesCancelled(remaining, with: event) }
  }
}
