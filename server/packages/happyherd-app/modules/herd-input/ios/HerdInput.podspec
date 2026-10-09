Pod::Spec.new do |s|
  s.name = 'HerdInput'
  s.version = '1.0.0'
  s.summary = 'HappyHerd hardware keyboard input'
  s.description = 'Responder-scoped native UI shortcuts for HappyHerd.'
  s.license = { :type => 'MIT' }
  s.author = 'HappyHerd Maintainers'
  s.homepage = 'https://github.com/NickGuAI/HappyHerd'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => 'https://github.com/NickGuAI/HappyHerd' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
