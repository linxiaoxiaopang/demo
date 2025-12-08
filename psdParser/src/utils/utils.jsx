
// 清理文件名
function sanitizeFileName(name) {
  // 移除非法字符
  // return name.replace(/[\\/:*?"<>|]/g, "_");
  return name.replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").replace(/\./, '_')
}


// 辅助函数
function getLayerType(layer) {
  if (layer.typename === "LayerSet") return "Group"
  try {
    switch (layer.kind) {
      case LayerKind.NORMAL:
        return "Normal"
      case LayerKind.TEXT:
        return "Text"
      case LayerKind.SMARTOBJECT:
        return "SmartObject"
      case LayerKind.SOLIDFILL:
        return "Shape"
      default:
        return "Other"
    }
  } catch (e) {
    return "Unknown"
  }
}
