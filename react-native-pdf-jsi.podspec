# encoding: utf-8
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json'), encoding: 'utf-8'))

Pod::Spec.new do |s|
  s.name           = package['name']
  s.version        = package['version']
  s.summary        = package['summary']
  s.description    = package['description']
  s.author         = { package['author']['name'] => package['author']['email'] }
  s.license        = package['license']
  s.homepage       = package['homepage']
  s.source         = { :git => 'https://github.com/126punith/react-native-pdf-jsi.git', :tag => "v#{s.version}" }
  s.requires_arc   = true
  s.frameworks     = 'PDFKit', 'Vision'
  s.platforms      = { ios: '13.0', tvos: '13.0' }
  s.module_name    = 'NitroPdfJsi'
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/RNPDFPdf" "$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++"',
    'SWIFT_OBJC_INTEROP_MODE' => 'objcxx',
    'PRODUCT_MODULE_NAME' => 'NitroPdfJsi'
  }
  install_modules_dependencies(s)
  load File.join(__dir__, 'nitrogen/generated/ios/NitroPdfJsi+autolinking.rb')
  add_nitrogen_files(s)
end
