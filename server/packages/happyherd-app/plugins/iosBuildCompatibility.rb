# Resource bundles can retain older podspec targets even when the app targets iOS 16.
installer.pods_project.targets.each do |target|
  target.build_configurations.each do |config|
    current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
    if current.nil? || current.to_f < 16.0
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
    end
  end
end

# RevenueCat 5.65.0: Swift in Xcode 27 synthesizes an initializer that collides
# with the public stringRepresentation initializer. A designated initializer
# inside the struct suppresses synthesis; preserve its body and private access.
color_path = File.join(installer.sandbox.root.to_s, 'RevenueCat/Sources/Paywalls/PaywallColor.swift')
if File.file?(color_path)
  source = File.read(color_path)
  initializer = <<~'SWIFT'.lines.map { |line| "    #{line}" }.join
    /// "Designated" initializer
    private init(stringRepresentation: String, underlyingColor: (any Sendable)?) {
        self.stringRepresentation = stringRepresentation
        self._underlyingColor = underlyingColor
    }
  SWIFT
  struct_end = "    fileprivate var _underlyingColor: (any Sendable)?\n\n}"
  # Only modify the known layout. Upstream-fixed or changed sources stay intact.
  if source.scan(initializer).length == 1 && source.scan(struct_end).length == 1 &&
      source.index('private extension PaywallColor {')&.<(source.index(initializer))
    patched = source.sub(initializer, '').sub(struct_end,
      "    fileprivate var _underlyingColor: (any Sendable)?\n\n#{initializer}\n}")
    # CocoaPods may install cached sources read-only.
    File.chmod(File.stat(color_path).mode | 0200, color_path)
    File.write(color_path, patched)
  end
end
