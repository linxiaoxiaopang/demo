/*
 * Photoshop 智能对象导出脚本
 * 功能：导出文档中所有智能对象图层
 */

#target
photoshop

if (!Array.prototype.findIndex) {
  Array.prototype.findIndex = function (callback) {
    // 校验回调函数是否有效
    if (typeof callback !== "function") {
      throw new TypeError("回调函数必须是函数")
    }
    // 遍历数组，执行回调，返回第一个匹配元素的索引
    for (var i = 0; i < this.length; i++) {
      if (callback(this[i], i, this)) {
        return i
      }
    }
    // 未找到匹配元素，返回 -1（与原生 findIndex 行为一致）
    return -1
  }
}
// 确保有文档打开
if (app.documents.length === 0) {
  alert("请先打开一个文档！")
} else {
  main()
}

function main() {
  var options = {}
  var doc = app.activeDocument
  var docPath = doc.path
  var docName = doc.name.replace(/\.[^\.]+$/, '') // 移除扩展名

  // 创建导出文件夹
  var exportFolder = new Folder(docPath + "/" + docName + "_layers")
  if (!exportFolder.exists) {
    exportFolder.create()
  }

  // 保存当前状态
  var savedState = doc.activeHistoryState

  // 收集所有智能对象
  var layers = []
  collectLayers(doc, layers, "")

  if (layers.length === 0) {
    alert("文档中没有找到对象！")
    return
  }
  var uniqLayers = []
  for (var i = 0; i < layers.length; i++) {
    var item = layers[i]
    var key = item.smartObjSourceId || item.id
    var fIndex = uniqLayers.findIndex(function (sItem) {
      var sKey = sItem.smartObjSourceId || sItem.id
      return sKey == key
    })
    if (fIndex < 0) {
      uniqLayers.push(item)
    }
  }
  layers = uniqLayers

  // 显示选项对话框
  // 导出智能对象
  var exportedCount = 0
  for (var i = 0; i < layers.length; i++) {
    try {
      if (layers[i].layer.kind === LayerKind.SMARTOBJECT) {
        exportSmartObject(layers[i], exportFolder, options, i + 1)
      } else {
        exportSingleLayer(layers[i], exportFolder, options, i + 1)
      }
      exportedCount++
    } catch (e) {
      $.writeln("导出失败: " + layers[i].layer.name + " - " + e)
    }
  }

  // 恢复状态
  doc.activeHistoryState = savedState

  alert("导出完成！\n共导出 " + exportedCount + " 个智能对象\n保存位置: " + exportFolder.fsName)
}

// 递归收集所有智能对象
function collectLayers(container, result, path) {
  for (var i = 0; i < container.layers.length; i++) {
    var layer = container.layers[i]
    var currentPath = path ? path + "/" + layer.name : layer.name

    if (layer.typename === "LayerSet") {
      // 图层组，递归搜索
      collectLayers(layer, result, currentPath)
    } else if (layer.kind === LayerKind.SMARTOBJECT) {
      var so = getSmartObjSourceRefID(layer)
      result.push({
        id: layer.id,
        layer: layer,
        path: currentPath,
        smartObjSourceId: so.smartObjSourceId,
        smartObjFileName: so.fileName
      })
    } else {
      result.push({
        id: layer.id,
        layer: layer,
        path: currentPath
      })
    }
  }
}

// 导出单个智能对象
function exportSmartObject(soInfo, baseFolder, options, index) {
  var layer = soInfo.layer
  // 确定保存路径
  var saveFolder = baseFolder

  var fileName = soInfo.smartObjFileName || layer.name
  // 生成文件名
  fileName = sanitizeFileName(fileName)
  if (options.addIndex) {
    fileName = index + "_" + fileName
  }

  // 转换格式导出
  exportAsPng(layer, saveFolder, fileName, options.format)
}

// 转换格式导出
function exportAsPng(layer, folder, fileName) {
  var doc = app.activeDocument

  // 复制智能对象内容到新文档
  doc.activeLayer = layer
  // 打开智能对象
  var idplacedLayerEditContents = stringIDToTypeID("placedLayerEditContents")
  var desc = new ActionDescriptor()
  executeAction(idplacedLayerEditContents, desc, DialogModes.NO)
  var soDoc = app.activeDocument

  // 根据格式保存
  var saveFile = new File(folder + "/" + fileName)

  var pngOpts = new PNGSaveOptions()
  pngOpts.compression = 6
  pngOpts.interlaced = false
  soDoc.saveAs(new File(saveFile + ".png"), pngOpts, true, Extension.LOWERCASE)

  // 关闭智能对象文档（不保存更改）
  soDoc.close(SaveOptions.DONOTSAVECHANGES)
}

// 清理文件名
function sanitizeFileName(name) {
  // 移除非法字符
  // return name.replace(/[\\/:*?"<>|]/g, "_");
  return name.replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").replace(/\.$/, '_')
}


function getSmartObjSourceRefID(layer) {
  try {
    var so = {
      fileName: '',
      smartObjSourceId: ''
    }
    var doc = app.activeDocument
    doc.activeLayer = layer
    var ref = new ActionReference()
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"))
    var desc = executeActionGet(ref)
    var idplacedLayerExportContents = stringIDToTypeID("placedLayerExportContents")
    var soDesc = safeGetObject(desc, stringIDToTypeID("smartObject"))
    if (soDesc) {
      var linkDesc = safeGetObject(soDesc, stringIDToTypeID("link"))
      if (linkDesc) {
        so.filePath = safeGetString(linkDesc, charIDToTypeID("Nm  "))
        if (soDesc.filePath) {
          var parts = so.filePath.replace(/\\/g, "/").split("/")
          so.fileName = parts[parts.length - 1]
        }
      }
    }

    if (!so.filePath) {
      so.filePath = safeGetString(soDesc, stringIDToTypeID("fileReference"))
    }

    if (so.filePath) {
      var parts = so.filePath.replace(/\\/g, "/").split("/")
      so.fileName = parts[parts.length - 1]
    }


    so.smartObjSourceId = idplacedLayerExportContents
    return so
  } catch (e) {
    alert("获取智能对象源引用 ID 失败：" + e.message)
    return null
  }
}

function safeGetObject(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getObjectValue(key)
  } catch (e) {
  }
  return null
}


// 安全获取函数
function safeGetString(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getString(key)
  } catch (e) {
  }
  return ""
}

function exportSingleLayer(soInfo, folder, settings) {
  var layer = soInfo.layer
  var newDoc = null
  var fileName = layer.name
  try {
    newDoc = duplicateLayerToNewDoc(layer, settings.trim)
    // 保存
    if (newDoc) {
      var filePath = folder + "/" + fileName
      savePNG(newDoc, filePath + ".png")
    }

  } finally {
    if (newDoc) {
      newDoc.close(SaveOptions.DONOTSAVECHANGES)
    }
  }
}


function savePNG(doc, path) {
  var file = new File(path)
  var opts = new PNGSaveOptions()
  opts.compression = 6
  opts.interlaced = false
  doc.saveAs(file, opts, true, Extension.LOWERCASE)
}


// 复制图层到新文档
function duplicateLayerToNewDoc(layer, trim) {
  var doc = app.activeDocument

  var bounds = layer.bounds
  var width = bounds[2].as("px") - bounds[0].as("px")
  var height = bounds[3].as("px") - bounds[1].as("px")

  if (width <= 0 || height <= 0) {
    width = doc.width.as("px")
    height = doc.height.as("px")
  }

  // 创建新文档
  var newDoc = app.documents.add(
    UnitValue(width, "px"),
    UnitValue(height, "px"),
    doc.resolution,
    "export_temp",
    NewDocumentMode.RGB,
    DocumentFill.TRANSPARENT
  )

  // 复制图层
  app.activeDocument = doc
  var dupLayer = layer.duplicate(newDoc, ElementPlacement.PLACEATBEGINNING)

  // 移动位置
  app.activeDocument = newDoc
  dupLayer.translate(
    UnitValue(-bounds[0].as("px"), "px"),
    UnitValue(-bounds[1].as("px"), "px")
  )

  // 裁剪
  if (trim) {
    try {
      newDoc.trim(TrimType.TRANSPARENT)
    } catch (e) {
    }
  }

  // 合并
  newDoc.flatten()

  return newDoc
}
