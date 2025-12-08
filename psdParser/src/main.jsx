#target photoshop
#include './utils/exportLayerPicture.jsx'
#include './utils/parser.jsx'

function main() {
  var exporter = new ExportLayerPicture()
  exporter.action()
  var parser = new Parser()
  parser.action()
  alert('操作成功，请查看导出目录')
  return true
}

main()
