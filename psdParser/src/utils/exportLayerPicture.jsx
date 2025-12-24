#include '../../node_modules/lodash/lodash.js'
#include './utils.jsx'
#include './get.jsx'
#include './md5.jsx'

function ExportLayerPicture() {
  this.app = app
  this.doc = this.app.activeDocument
  this.exportFolder = this.getExportFolder()
  this.layers = []
}

ExportLayerPicture.prototype.validDocuments = function () {
  if (this.app.documents.length === 0) throw '请先打开一个文档！'
}

ExportLayerPicture.prototype.getExportFolder = function () {
  var docPath = this.doc.path
  var docName = this.doc.name.replace(/\.[^\.]+$/, '')
  // 创建导出文件夹
  var exportFolder = new Folder(docPath + "/" + docName + "_layers")
  if (!exportFolder.exists) exportFolder.create()
  return exportFolder
}

// 递归收集所有图层对象
ExportLayerPicture.prototype.collectLayers = function (container, result, path) {
  for (var i = 0; i < container.layers.length; i++) {
    var layer = container.layers[i]
    path = path || ''
    if (path) path = path + '/'
    var currentPath = path + layer.name

    if (layer.typename === "LayerSet") {
      // 图层组，递归搜索
      this.collectLayers(layer, result, currentPath)
      continue
    }
    if (layer.kind === LayerKind.SMARTOBJECT) {
      this.layers.push(new SmartObject({
        layer: layer,
        currentPath: currentPath,
        parent: this
      }))
      continue
    }

    this.layers.push(new NormalObject({
      layer: layer,
      currentPath: currentPath,
      parent: this
    }))
  }
}


ExportLayerPicture.prototype.uniqLayers = function () {
  var uniqLayers = []
  var layers = this.layers
  for (var i = 0; i < layers.length; i++) {
    var item = layers[i]
    var key = item.key
    var fIndex = _.findIndex(uniqLayers, (function (sItem) {
        var sKey = sItem.key
        return sKey == key
      })
    )
    if (fIndex < 0) {
      uniqLayers.push(item)
    }
  }
  this.layers = uniqLayers
}

ExportLayerPicture.prototype.export = function () {
  var layers = this.layers
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i]
    layer.savePNG()
  }
}

ExportLayerPicture.prototype.action = function () {
  try {
    this.validDocuments()
    this.collectLayers(this.doc, this.layers)
    this.uniqLayers()
    if (!this.layers.length) throw '文档中没有找到对象'
    this.export()
    return this.layers.length
  } catch (err) {
    alert(err)
  }
}


function NormalObject(option) {
  this.parent = option.parent
  this.layer = option.layer
  this.currentPath = option.currentPath
  this.app = this.parent.app
  this.doc = this.parent.doc
  this.exportFolder = this.parent.exportFolder
  this.type = getLayerType(this.layer)
  this.id = this.layer.id
  this.key = this.type + '_' + this.id
}

NormalObject.prototype.duplicateLayerToNewDoc = function () {
  var app = this.parent.app
  var doc = this.parent.doc
  var layer = this.layer
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
  // dupLayer.translate(
  //   UnitValue(-bounds[0].as("px"), "px"),
  //   UnitValue(-bounds[1].as("px"), "px")
  // )

  // 裁剪
  try {
    newDoc.trim(TrimType.TRANSPARENT)
  } catch (e) {
  }

  // 合并
  newDoc.flatten()

  return newDoc
}

NormalObject.prototype.savePNG = function () {
  var layer = this.layer
  var folder = this.exportFolder
  var fileName = layer.name
  var newDoc = this.duplicateLayerToNewDoc()
  var filePath = folder + "/" + this.key + '_' + fileName + '.png'
  var file = new File(filePath)
  var opts = new PNGSaveOptions()
  opts.compression = 6
  opts.interlaced = false
  newDoc.saveAs(file, opts, true, Extension.LOWERCASE)
  newDoc.close(SaveOptions.DONOTSAVECHANGES)
}


function SmartObject(option) {
  this.parent = option.parent
  this.layer = option.layer
  this.currentPath = option.currentPath
  this.doc = this.parent.doc
  this.exportFolder = this.parent.exportFolder
  var info = this.getInfo()
  this.smartLayerName = info.fileName
  this.smartObjSourceId = info.smartObjSourceId
  this.id = this.layer.id
  this.type = getLayerType(this.layer)
  this.key = this.type + '_' + this.smartObjSourceId
}

SmartObject.prototype.getInfo = function () {
  var so = {
    fileName: '',
    smartObjSourceId: ''
  }
  this.doc.activeLayer = this.layer
  var ref = new ActionReference()
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"))
  var desc = executeActionGet(ref)
  // var smartObjSourceId = stringIDToTypeID("placedLayerExportContents")
  var soDesc = safeGetObject(desc, stringIDToTypeID("smartObject"))
   // 获取文档 ID（同一源文件的所有实例共享此 ID）
  so.smartObjSourceId = md5(soDesc.getString(stringIDToTypeID('documentID')))
  so.filePath = safeGetString(soDesc, stringIDToTypeID("fileReference"))

  if (so.filePath) {
    var parts = so.filePath.replace(/\\/g, "/").split("/")
    so.fileName = parts[parts.length - 1]
  }
  return so
}

SmartObject.prototype.savePNG = function () {
  var layer = this.layer
  var folder = this.exportFolder
  var fileName = sanitizeFileName(this.smartLayerName)
  var fullPath = folder + '/' + this.key + '_' + fileName  + ".png"
  this.doc.activeLayer = layer
  // 打开智能对象
  var idplacedLayerEditContents = stringIDToTypeID("placedLayerEditContents")
  var desc = new ActionDescriptor()
  executeAction(idplacedLayerEditContents, desc, DialogModes.NO)
  var soDoc = app.activeDocument
   exportPNGKeepTransparency(soDoc, fullPath)
  soDoc.close(SaveOptions.DONOTSAVECHANGES)
}

function exportPNGKeepTransparency(sourceDoc, filePath) {
    var tempDoc = null
    
    try {
        // 步骤1：创建新的透明背景文档
        tempDoc = app.documents.add(
            sourceDoc.width,
            sourceDoc.height,
            sourceDoc.resolution,
            "temp_export",
            NewDocumentMode.RGB,
            DocumentFill.TRANSPARENT  // 【关键】透明背景！
        )
        
        // 步骤2：从源文档复制合并的图像
        app.activeDocument = sourceDoc
        sourceDoc.selection.selectAll()
        sourceDoc.selection.copy(true)  // true = 合并拷贝所有可见图层
        
        // 步骤3：粘贴到透明文档
        app.activeDocument = tempDoc
        tempDoc.paste()
        
        // 步骤4：删除底部的空白透明层（粘贴会创建新图层）
        removeEmptyBottomLayer(tempDoc)
        
        // 步骤5：【关键】不要用 flatten()！使用 mergeVisibleLayers()
        if (tempDoc.layers.length > 1) {
            tempDoc.mergeVisibleLayers()
        }
        
        // 步骤6：导出 PNG
        var opts = new ExportOptionsSaveForWeb()
        opts.format = SaveDocumentType.PNG
        opts.PNG8 = false
        opts.transparency = true
        opts.interlaced = false
        opts.quality = 100
        
        tempDoc.exportDocument(new File(filePath), ExportType.SAVEFORWEB, opts)
        
    } finally {
        // 关闭临时文档
        if (tempDoc) {
            try { tempDoc.close(SaveOptions.DONOTSAVECHANGES) } catch (e) {}
        }
    }
}

// 删除底部空白图层
function removeEmptyBottomLayer(doc) {
    try {
        if (doc.layers.length > 1) {
            var bottomLayer = doc.layers[doc.layers.length - 1]
            
            // 检查是否为空白图层
            var bounds = bottomLayer.bounds
            var w = bounds[2].as("px") - bounds[0].as("px")
            var h = bounds[3].as("px") - bounds[1].as("px")
            
            if (w === 0 && h === 0) {
                bottomLayer.remove()
            }
        }
    } catch (e) {}
}