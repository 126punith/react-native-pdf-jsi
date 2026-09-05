# encoding: utf-8
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json'), encoding: 'utf-8'))

fabric_enabled = ENV['RCT_NEW_ARCH_ENABLED'] == '1'

Pod::Spec.new do |s|
  s.name           = package['name']
  s.version        = package['version']
  s.summary        = package['summary']
  s.description    = package['description']
  s.author         = { package['author']['name'] => package['author']['email'] }
  s.license        = package['license']
  s.homepage       = package['homepage']
  s.source         = { :git => 'https://github.com/126punith/react-native-pdf-enhanced.git', :tag => "v#{s.version}" }
  s.requires_arc   = true
  s.frameworks   = "PDFKit", "Vision"

  if fabric_enabled
    s.platforms       = { ios: '11.0', tvos: '11.0' }
    s.source_files    = 'ios/**/*.{h,m,mm,cpp}'
    s.requires_arc    = true
    install_modules_dependencies(s)

  else
    s.platform       = :ios, '8.0'
    s.source_files   = 'ios/**/*.{h,m,mm}'
    s.dependency     'React-Core'
  end
end
