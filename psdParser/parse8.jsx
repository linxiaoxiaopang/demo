
#target photoshop
#include './node_modules/lodash/lodash.js';


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
    alert("导出完成！\n共导出 " + this.layers.length + " 个智能对象\n保存位置: " + this.exportFolder)
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
  this.type = 'normalObject'
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
  dupLayer.translate(
    UnitValue(-bounds[0].as("px"), "px"),
    UnitValue(-bounds[1].as("px"), "px")
  )

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
  var filePath = folder + "/" + fileName + '.png'
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
  this.type = 'smartObject'
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
  var smartObjSourceId = stringIDToTypeID("placedLayerExportContents")
  var soDesc = safeGetObject(desc, stringIDToTypeID("smartObject"))
  so.filePath = safeGetString(soDesc, stringIDToTypeID("fileReference"))

  if (so.filePath) {
    var parts = so.filePath.replace(/\\/g, "/").split("/")
    so.fileName = parts[parts.length - 1]
  }
  so.smartObjSourceId = smartObjSourceId
  return so
}

SmartObject.prototype.savePNG = function () {
  var layer = this.layer
  var folder = this.exportFolder
  var fileName = sanitizeFileName(this.smartLayerName)
  var fullPath = folder + "/" + fileName
  this.doc.activeLayer = layer
  // 打开智能对象
  var idplacedLayerEditContents = stringIDToTypeID("placedLayerEditContents")
  var desc = new ActionDescriptor()
  executeAction(idplacedLayerEditContents, desc, DialogModes.NO)
  var soDoc = app.activeDocument

  // 根据格式保存
  var saveFile = new File(fullPath)

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
  return name.replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").replace(/\./, '_')
}


function Parser() {
  this.app = app
  this.doc = this.app.activeDocument
  this.exportFolder = this.getExportFolder()
  this.result = this.initResult()
}

Parser.prototype.initResult = function () {
  var doc = this.doc
  return {
    document: {
      name: doc.name,
      path: getDocPath(doc),
      width: pxVal(doc.width),
      height: pxVal(doc.height),
      resolution: doc.resolution,
      colorMode: getColorMode(doc.mode)
    },
    layers: []
  }
}

Parser.prototype.getExportFolder = function () {
  var docPath = this.doc.path
  var docName = this.doc.name.replace(/\.[^\.]+$/, '')
  // 创建导出文件夹
  var exportFolder = new Folder(docPath + "/" + docName + "_layers")
  if (!exportFolder.exists) exportFolder.create()
  return exportFolder
}

Parser.prototype.parseLayers = function (layers, target, depth) {
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i]
    var info = this.parseLayer(layer, depth)
    target.push(info)

    if (layer.typename === "LayerSet" && layer.layers.length > 0) {
      info.children = []
      this.parseLayers(layer.layers, info.children, depth + 1)
    }
  }
}

Parser.prototype.parseLayer = function (layer, depth) {
  var doc = this.doc
  var savedLayer = null

  try {
    savedLayer = doc.activeLayer
  } catch (e) {
  }
  try {
    doc.activeLayer = layer
  } catch (e) {
  }

  var info = {
    name: layer.name,
    type: getLayerType(layer),
    visible: layer.visible,
    opacity: Math.round(layer.opacity),
    blendMode: getBlendMode(layer),
    depth: depth
  }

  // 边界
  try {
    var b = layer.bounds
    var x = pxVal(b[0])
    var y = pxVal(b[1])
    var w = pxVal(b[2]) - x
    var h = pxVal(b[3]) - y

    info.bounds = {
      x: x, y: y,
      width: w, height: h,
      centerX: Math.round(x + w / 2),
      centerY: Math.round(y + h / 2)
    }
  } catch (e) {
  }

  // 智能对象
  try {
    if (layer.kind === LayerKind.SMARTOBJECT) {
      info.smartObject = parseSmartObject(layer, info.bounds)
    }
  } catch (e) {
  }

  // 文字
  try {
    if (layer.kind === LayerKind.TEXT) {
      info.text = parseTextLayer(layer)
    }
  } catch (e) {
  }

  if (savedLayer) {
    try {
      doc.activeLayer = savedLayer
    } catch (e) {
    }
  }

  return info
}

Parser.prototype.saveJSON = function () {
  var data = this.result
  var folder = this.exportFolder
  var fileName = 'json'
  var filePath = folder + "/" + fileName + '.json'
  var file = new File(filePath)
  if (file) {
    file.encoding = "UTF-8"
    file.open("w")
    file.write(toJSON(data, "  "))
    file.close()
    alert("JSON 已保存:\n" + file.fsName)
  }
}

Parser.prototype.action = function () {
  try {
    this.parseLayers(this.doc.layers, this.result.layers, 0)
    this.saveJSON()
  } catch (err) {
    alert(err)
  }
}

main()

function main() {
  var parserInstance = new Parser()
  parserInstance.action()
  var exporter = new ExportLayerPicture()
  exporter.action()
}


function getDocPath(doc) {
  try {
    return doc.path.fsName
  } catch (e) {
    return ""
  }
}

function pxVal(v) {
  try {
    return Math.round(v.as("px"))
  } catch (e) {
    return 0
  }
}

function r2(n) {
  return Math.round(n * 100) / 100
}

function r1(n) {
  return Math.round(n * 10) / 10
}

function dist(a, b) {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2))
}

// 安全获取函数
function safeGetString(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getString(key)
  } catch (e) {
  }
  return ""
}

function safeGetDouble(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getDouble(key)
  } catch (e) {
  }
  return 0
}

function safeGetBoolean(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getBoolean(key)
  } catch (e) {
  }
  return false
}

function safeGetObject(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getObjectValue(key)
  } catch (e) {
  }
  return null
}

function safeGetList(desc, key) {
  try {
    if (desc.hasKey(key)) return desc.getList(key)
  } catch (e) {
  }
  return null
}


// ========== 核心：解析智能对象 ==========
function parseSmartObject(layer, layerBounds) {
  var so = {
    linked: false,
    filePath: "",
    fileName: "",
    originalSize: null,
    currentSize: null,
    transform: {
      scaleX: 100,
      scaleY: 100,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false
    },
    corners: null,           // 变换前的原始坐标（轴对齐矩形）
    cornersTransformed: null // 变换后的实际坐标
  }

  try {
    var ref = new ActionReference()
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"))
    var desc = executeActionGet(ref)

    // 智能对象基本信息
    var soDesc = safeGetObject(desc, stringIDToTypeID("smartObject"))
    if (soDesc) {
      so.linked = safeGetBoolean(soDesc, stringIDToTypeID("linked"))

      var linkDesc = safeGetObject(soDesc, stringIDToTypeID("link"))
      if (linkDesc) {
        so.filePath = safeGetString(linkDesc, charIDToTypeID("Nm  "))
        if (!so.filePath) {
          so.filePath = safeGetString(linkDesc, stringIDToTypeID("fullPath"))
        }
      }
      if (!so.filePath) {
        so.filePath = safeGetString(soDesc, stringIDToTypeID("fileReference"))
      }

      if (so.filePath) {
        var parts = so.filePath.replace(/\\/g, "/").split("/")
        so.fileName = parts[parts.length - 1]
      }
    }

    // 变换信息
    var more = safeGetObject(desc, stringIDToTypeID("smartObjectMore"))
    if (more) {
      // 原始尺寸
      var sizeDesc = safeGetObject(more, stringIDToTypeID("size"))
      var origW = 0, origH = 0
      if (sizeDesc) {
        origW = safeGetDouble(sizeDesc, stringIDToTypeID("width"))
        origH = safeGetDouble(sizeDesc, stringIDToTypeID("height"))
        so.originalSize = { width: r2(origW), height: r2(origH) }
      }

      // 裁剪
      var cropL = 0, cropT = 0, cropR = 0, cropB = 0
      var cropDesc = safeGetObject(more, stringIDToTypeID("crop"))
      if (cropDesc) {
        cropT = safeGetDouble(cropDesc, stringIDToTypeID("top"))
        cropL = safeGetDouble(cropDesc, stringIDToTypeID("left"))
        cropB = safeGetDouble(cropDesc, stringIDToTypeID("bottom"))
        cropR = safeGetDouble(cropDesc, stringIDToTypeID("right"))
      }

      var effectiveW = origW - cropL - cropR
      var effectiveH = origH - cropT - cropB

      // 四角坐标
      var tfList = safeGetList(more, stringIDToTypeID("transform"))
      if (tfList && tfList.count === 8) {
        var raw = {
          tl: { x: tfList.getDouble(0), y: tfList.getDouble(1) },
          tr: { x: tfList.getDouble(2), y: tfList.getDouble(3) },
          br: { x: tfList.getDouble(4), y: tfList.getDouble(5) },
          bl: { x: tfList.getDouble(6), y: tfList.getDouble(7) }
        }

        // 存储变换后的实际坐标
        so.cornersTransformed = {
          topLeft: { x: r1(raw.tl.x), y: r1(raw.tl.y) },
          topRight: { x: r1(raw.tr.x), y: r1(raw.tr.y) },
          bottomRight: { x: r1(raw.br.x), y: r1(raw.br.y) },
          bottomLeft: { x: r1(raw.bl.x), y: r1(raw.bl.y) }
        }

        // 计算中心点
        var center = {
          x: (raw.tl.x + raw.tr.x + raw.br.x + raw.bl.x) / 4,
          y: (raw.tl.y + raw.tr.y + raw.br.y + raw.bl.y) / 4
        }

        // 检测翻转
        var flipResult = detectFlip(raw.tl, raw.tr, raw.br, raw.bl)
        so.transform.flipHorizontal = flipResult.horizontal
        so.transform.flipVertical = flipResult.vertical

        // 当前尺寸
        var currentW = dist(raw.tl, raw.tr)
        var currentH = dist(raw.tl, raw.bl)
        so.currentSize = { width: r1(currentW), height: r1(currentH) }

        // 旋转角度
        var dx = raw.tr.x - raw.tl.x
        var dy = raw.tr.y - raw.tl.y
        var rawAngle = Math.atan2(dy, dx) * 180 / Math.PI

        // 根据翻转调整角度
        var rotation = adjustRotationForFlip(rawAngle, flipResult)
        so.transform.rotation = r2(rotation)

        // 缩放
        if (effectiveW > 0 && effectiveH > 0) {
          so.transform.scaleX = r2((currentW / effectiveW) * 100)
          so.transform.scaleY = r2((currentH / effectiveH) * 100)
        }

        // ========== 核心：计算变换前的原始坐标 ==========
        so.corners = calculateOriginalCorners(center, currentW, currentH)
      }

      // 备选
      if (!so.corners && layerBounds) {
        so.corners = {
          topLeft: { x: layerBounds.x, y: layerBounds.y },
          topRight: { x: layerBounds.x + layerBounds.width, y: layerBounds.y },
          bottomRight: { x: layerBounds.x + layerBounds.width, y: layerBounds.y + layerBounds.height },
          bottomLeft: { x: layerBounds.x, y: layerBounds.y + layerBounds.height }
        }
      }
    }

  } catch (e) {
    so.error = e.message
  }

  return so
}

// ========== 翻转检测 ==========
function detectFlip(tl, tr, br, bl) {
  var result = { horizontal: false, vertical: false }

  var vecTop = { x: tr.x - tl.x, y: tr.y - tl.y }
  var vecLeft = { x: bl.x - tl.x, y: bl.y - tl.y }

  // 叉积判断
  var cross = vecTop.x * vecLeft.y - vecTop.y * vecLeft.x

  if (cross < 0) {
    // 通过角度判断翻转类型
    var topAngle = Math.atan2(vecTop.y, vecTop.x) * 180 / Math.PI
    var leftAngle = Math.atan2(vecLeft.y, vecLeft.x) * 180 / Math.PI

    // 标准化
    topAngle = normalizeAngle(topAngle)
    leftAngle = normalizeAngle(leftAngle)

    // 判断哪个方向翻转
    // 正常: topAngle ≈ 0°, leftAngle ≈ 90°
    // 水平翻转: topAngle ≈ ±180°
    // 垂直翻转: leftAngle ≈ -90°

    var topReversed = Math.abs(topAngle) > 90
    var leftReversed = leftAngle < 0

    if (topReversed && !leftReversed) {
      result.horizontal = true
    } else if (!topReversed && leftReversed) {
      result.vertical = true
    } else if (topReversed && leftReversed) {
      // 双翻转或复杂情况
      result.horizontal = true
    } else {
      result.horizontal = true // 默认
    }
  }

  return result
}

function normalizeAngle(angle) {
  while (angle > 180) angle -= 360
  while (angle < -180) angle += 360
  return angle
}

// 根据翻转调整旋转角度显示
function adjustRotationForFlip(rawAngle, flipResult) {
  var angle = rawAngle

  if (flipResult.horizontal) {
    // 水平翻转时，角度需要取反并调整
    angle = 180 - angle
  }
  if (flipResult.vertical) {
    // 垂直翻转时
    angle = -angle
  }

  return normalizeAngle(angle)
}

// ========== 核心：计算变换前的原始坐标 ==========
/**
 * 计算智能对象在没有旋转和翻转时的坐标
 * 保持中心点不变，返回轴对齐的矩形
 *
 * @param center 变换后的中心点
 * @param width 当前宽度（缩放后）
 * @param height 当前高度（缩放后）
 * @returns 轴对齐的四角坐标
 */
function calculateOriginalCorners(center, width, height) {
  var halfW = width / 2
  var halfH = height / 2

  return {
    topLeft: {
      x: r1(center.x - halfW),
      y: r1(center.y - halfH)
    },
    topRight: {
      x: r1(center.x + halfW),
      y: r1(center.y - halfH)
    },
    bottomRight: {
      x: r1(center.x + halfW),
      y: r1(center.y + halfH)
    },
    bottomLeft: {
      x: r1(center.x - halfW),
      y: r1(center.y + halfH)
    }
  }
}

// 解析文字图层
function parseTextLayer(layer) {
  var t = {
    content: "",
    font: "",
    size: 0,
    color: "#000000",
    position: null
  }

  try {
    var ti = layer.textItem
    t.content = ti.contents
    t.font = ti.font
    t.size = Math.round(ti.size.as("px"))
    t.color = rgbToHex(ti.color.rgb)
    t.position = {
      x: pxVal(ti.position[0]),
      y: pxVal(ti.position[1])
    }
  } catch (e) {
  }

  return t
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

function getColorMode(mode) {
  switch (mode) {
    case DocumentMode.RGB:
      return "RGB"
    case DocumentMode.CMYK:
      return "CMYK"
    case DocumentMode.GRAYSCALE:
      return "Grayscale"
    default:
      return "Other"
  }
}

function getBlendMode(layer) {
  try {
    return layer.blendMode.toString().replace("BlendMode.", "")
  } catch (e) {
    return "Normal"
  }
}

function rgbToHex(rgb) {
  function hex(n) {
    var h = Math.round(n).toString(16).toUpperCase()
    return h.length < 2 ? "0" + h : h
  }

  return "#" + hex(rgb.red) + hex(rgb.green) + hex(rgb.blue)
}


// 保存文件
function saveJSON(data) {

}


// JSON 序列化
function toJSON(obj, indent) {
  return _json(obj, indent || "", "")
}

function _json(val, indent, cur) {
  if (val === null || val === undefined) return "null"
  var t = typeof val
  if (t === "string") {
    return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"'
  }
  if (t === "number") return isFinite(val) ? String(val) : "null"
  if (t === "boolean") return String(val)
  if (val instanceof Array) {
    if (val.length === 0) return "[]"
    var arr = [], ni = cur + indent
    for (var i = 0; i < val.length; i++) arr.push(ni + _json(val[i], indent, ni))
    return "[\n" + arr.join(",\n") + "\n" + cur + "]"
  }
  if (t === "object") {
    var props = [], ni = cur + indent
    for (var k in val) {
      if (val.hasOwnProperty(k)) props.push(ni + '"' + k + '": ' + _json(val[k], indent, ni))
    }
    if (props.length === 0) return "{}"
    return "{\n" + props.join(",\n") + "\n" + cur + "}"
  }
  return "null"
}


