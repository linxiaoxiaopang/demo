#include '../../node_modules/lodash/lodash.js'
#include './utils.jsx'
#include './math.jsx'
#include './get.jsx'
#include './json.jsx'
#include './md5.jsx'

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
    depth: depth,
    id: layer.id,
    key: null
  }

  info.key = info.type + '_' + info.id
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
      info.key = info.type + '_' +  info.smartObject.id
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
  var fileName = 'layers'
  var filePath = folder + "/" + fileName + '.json'
  var file = new File(filePath)
  file.encoding = "UTF-8"
  file.open("w")
  file.write(toJSON(data, "  "))
  file.close()
}

Parser.prototype.action = function () {
  try {
    this.parseLayers(this.doc.layers, this.result.layers, 0)
    this.saveJSON()
  } catch (err) {
    alert(err)
  }
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

// ========== 核心：解析智能对象 ==========
function parseSmartObject(layer, layerBounds) {
  var so = {
    linked: false,
    filePath: "",
    fileName: "",
    originalSize: null,
    currentSize: null,
    id: null,
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
    var documentID = getSmartObjectUniqueId(soDesc)
    so.id = md5(documentID)

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


