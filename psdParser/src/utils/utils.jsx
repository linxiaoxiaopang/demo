
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


function getSmartObjectUniqueId(soDesc) {
  var documentID = soDesc.getString(stringIDToTypeID('documentID'))
  // 2. 如果为空，尝试 fileReference
  if (!documentID) {
    try {
      documentID = soDesc.getString(stringIDToTypeID("fileReference"))
    } catch (e) {
    }
  }

  // 3. 如果还是空，尝试 link
  if (!documentID) {
    try {
      var linkDesc = soDesc.getObjectValue(stringIDToTypeID("link"))
      documentID = linkDesc.getString(stringIDToTypeID("name"))
    } catch (e) {
    }
  }
  return documentID
}
