
// 清理文件名
function sanitizeFileName(name) {
  // 移除非法字符
  // return name.replace(/[\\/:*?"<>|]/g, "_");
  return name.replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").replace(/\./, '_')
}


// 辅助函数
function getLayerType(layer) {
  if (layer.typename === "LayerSet") return "group"
  try {
    switch (layer.kind) {
      case LayerKind.NORMAL:
        return "normal"
      case LayerKind.TEXT:
        return "text"
      case LayerKind.SMARTOBJECT:
        return "smartObject"
      case LayerKind.SOLIDFILL:
        return "shape"
      default:
        return "other"
    }
  } catch (e) {
    return "unknown"
  }
}
