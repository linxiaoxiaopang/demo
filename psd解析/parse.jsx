/*
 * PSD 图层解析脚本 - v4
 * 支持解析智能对象的缩放、旋转、位置、翻转
 * corners: 输出变换前的原始坐标（逆旋转、逆翻转后的轴对齐矩形）
 * 坐标系：文档左上角为原点 (0,0)
 */

#target photoshop

function main() {
  if (app.documents.length === 0) {
    alert("请先打开一个 PSD 文件！");
    return;
  }

  var doc = app.activeDocument;

  var result = {
    document: {
      name: doc.name,
      path: getDocPath(doc),
      width: pxVal(doc.width),
      height: pxVal(doc.height),
      resolution: doc.resolution,
      colorMode: getColorMode(doc.mode)
    },
    layers: []
  };

  parseLayers(doc.layers, result.layers, 0);
  showResultDialog(result);
}

function getDocPath(doc) {
  try {
    return doc.path.fsName;
  } catch (e) {
    return "";
  }
}

function pxVal(v) {
  try {
    return Math.round(v.as("px"));
  } catch (e) {
    return 0;
  }
}

function r2(n) {
  return Math.round(n * 100000) / 100000;
}

function r1(n) {
  return Math.round(n * 10) / 10;
}

function dist(a, b) {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

// 安全获取函数
function safeGetString(desc, key) {
  try { if (desc.hasKey(key)) return desc.getString(key); } catch (e) {}
  return "";
}

function safeGetDouble(desc, key) {
  try { if (desc.hasKey(key)) return desc.getDouble(key); } catch (e) {}
  return 0;
}

function safeGetBoolean(desc, key) {
  try { if (desc.hasKey(key)) return desc.getBoolean(key); } catch (e) {}
  return false;
}

function safeGetObject(desc, key) {
  try { if (desc.hasKey(key)) return desc.getObjectValue(key); } catch (e) {}
  return null;
}

function safeGetList(desc, key) {
  try { if (desc.hasKey(key)) return desc.getList(key); } catch (e) {}
  return null;
}

// 递归解析图层
function parseLayers(layers, target, depth) {
  for (var i = 0; i < layers.length; i++) {
    try {
      var layer = layers[i];
      var info = parseLayer(layer, depth);
      target.push(info);

      if (layer.typename === "LayerSet" && layer.layers.length > 0) {
        info.children = [];
        parseLayers(layer.layers, info.children, depth + 1);
      }
    } catch (e) {}
  }
}

// 解析单个图层
function parseLayer(layer, depth) {
  var doc = app.activeDocument;
  var savedLayer = null;

  try { savedLayer = doc.activeLayer; } catch (e) {}
  try { doc.activeLayer = layer; } catch (e) {}

  var info = {
    name: layer.name,
    type: getLayerType(layer),
    visible: layer.visible,
    opacity: Math.round(layer.opacity),
    blendMode: getBlendMode(layer),
    depth: depth
  };

  // 边界
  try {
    var b = layer.bounds;
    var x = pxVal(b[0]);
    var y = pxVal(b[1]);
    var w = pxVal(b[2]) - x;
    var h = pxVal(b[3]) - y;

    info.bounds = {
      x: x, y: y,
      width: w, height: h,
      centerX: Math.round(x + w / 2),
      centerY: Math.round(y + h / 2)
    };
  } catch (e) {}

  // 智能对象
  try {
    if (layer.kind === LayerKind.SMARTOBJECT) {
      info.smartObject = parseSmartObject(layer, info.bounds);
    }
  } catch (e) {}

  // 文字
  try {
    if (layer.kind === LayerKind.TEXT) {
      info.text = parseTextLayer(layer);
    }
  } catch (e) {}

  if (savedLayer) {
    try { doc.activeLayer = savedLayer; } catch (e) {}
  }

  return info;
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
  };

  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var desc = executeActionGet(ref);

    // 智能对象基本信息
    var soDesc = safeGetObject(desc, stringIDToTypeID("smartObject"));
    if (soDesc) {
      so.linked = safeGetBoolean(soDesc, stringIDToTypeID("linked"));

      var linkDesc = safeGetObject(soDesc, stringIDToTypeID("link"));
      if (linkDesc) {
        so.filePath = safeGetString(linkDesc, charIDToTypeID("Nm  "));
        if (!so.filePath) {
          so.filePath = safeGetString(linkDesc, stringIDToTypeID("fullPath"));
        }
      }
      if (!so.filePath) {
        so.filePath = safeGetString(soDesc, stringIDToTypeID("fileReference"));
      }

      if (so.filePath) {
        var parts = so.filePath.replace(/\\/g, "/").split("/");
        so.fileName = parts[parts.length - 1];
      }
    }

    // 变换信息
    var more = safeGetObject(desc, stringIDToTypeID("smartObjectMore"));
    if (more) {
      // 原始尺寸
      var sizeDesc = safeGetObject(more, stringIDToTypeID("size"));
      var origW = 0, origH = 0;
      if (sizeDesc) {
        origW = safeGetDouble(sizeDesc, stringIDToTypeID("width"));
        origH = safeGetDouble(sizeDesc, stringIDToTypeID("height"));
        so.originalSize = { width: r2(origW), height: r2(origH) };
      }

      // 裁剪
      var cropL = 0, cropT = 0, cropR = 0, cropB = 0;
      var cropDesc = safeGetObject(more, stringIDToTypeID("crop"));
      if (cropDesc) {
        cropT = safeGetDouble(cropDesc, stringIDToTypeID("top"));
        cropL = safeGetDouble(cropDesc, stringIDToTypeID("left"));
        cropB = safeGetDouble(cropDesc, stringIDToTypeID("bottom"));
        cropR = safeGetDouble(cropDesc, stringIDToTypeID("right"));
      }

      var effectiveW = origW - cropL - cropR;
      var effectiveH = origH - cropT - cropB;

      // 四角坐标
      var tfList = safeGetList(more, stringIDToTypeID("transform"));
      if (tfList && tfList.count === 8) {
        var raw = {
          tl: { x: tfList.getDouble(0), y: tfList.getDouble(1) },
          tr: { x: tfList.getDouble(2), y: tfList.getDouble(3) },
          br: { x: tfList.getDouble(4), y: tfList.getDouble(5) },
          bl: { x: tfList.getDouble(6), y: tfList.getDouble(7) }
        };

        // 存储变换后的实际坐标
        so.cornersTransformed = {
          topLeft: { x: r1(raw.tl.x), y: r1(raw.tl.y) },
          topRight: { x: r1(raw.tr.x), y: r1(raw.tr.y) },
          bottomRight: { x: r1(raw.br.x), y: r1(raw.br.y) },
          bottomLeft: { x: r1(raw.bl.x), y: r1(raw.bl.y) }
        };

        // 计算中心点
        var center = {
          x: (raw.tl.x + raw.tr.x + raw.br.x + raw.bl.x) / 4,
          y: (raw.tl.y + raw.tr.y + raw.br.y + raw.bl.y) / 4
        };

        // 检测翻转
        var flipResult = detectFlip(raw.tl, raw.tr, raw.br, raw.bl);
        so.transform.flipHorizontal = flipResult.horizontal;
        so.transform.flipVertical = flipResult.vertical;

        // 当前尺寸
        var currentW = dist(raw.tl, raw.tr);
        var currentH = dist(raw.tl, raw.bl);
        so.currentSize = { width: r1(currentW), height: r1(currentH) };

        // 旋转角度
        var dx = raw.tr.x - raw.tl.x;
        var dy = raw.tr.y - raw.tl.y;
        var rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;

        // 根据翻转调整角度
        var rotation = adjustRotationForFlip(rawAngle, flipResult);
        so.transform.rotation = r2(rotation);

        // 缩放
        if (effectiveW > 0 && effectiveH > 0) {
          so.transform.scaleX = r2((currentW / effectiveW) * 100);
          so.transform.scaleY = r2((currentH / effectiveH) * 100);
        }

        // ========== 核心：计算变换前的原始坐标 ==========
        so.corners = calculateOriginalCorners(center, currentW, currentH);
      }

      // 备选
      if (!so.corners && layerBounds) {
        so.corners = {
          topLeft: { x: layerBounds.x, y: layerBounds.y },
          topRight: { x: layerBounds.x + layerBounds.width, y: layerBounds.y },
          bottomRight: { x: layerBounds.x + layerBounds.width, y: layerBounds.y + layerBounds.height },
          bottomLeft: { x: layerBounds.x, y: layerBounds.y + layerBounds.height }
        };
      }
    }

  } catch (e) {
    so.error = e.message;
  }

  return so;
}

// ========== 翻转检测 ==========
function detectFlip(tl, tr, br, bl) {
  var result = { horizontal: false, vertical: false };

  var vecTop = { x: tr.x - tl.x, y: tr.y - tl.y };
  var vecLeft = { x: bl.x - tl.x, y: bl.y - tl.y };

  // 叉积判断
  var cross = vecTop.x * vecLeft.y - vecTop.y * vecLeft.x;

  if (cross < 0) {
    // 通过角度判断翻转类型
    var topAngle = Math.atan2(vecTop.y, vecTop.x) * 180 / Math.PI;
    var leftAngle = Math.atan2(vecLeft.y, vecLeft.x) * 180 / Math.PI;

    // 标准化
    topAngle = normalizeAngle(topAngle);
    leftAngle = normalizeAngle(leftAngle);

    // 判断哪个方向翻转
    // 正常: topAngle ≈ 0°, leftAngle ≈ 90°
    // 水平翻转: topAngle ≈ ±180°
    // 垂直翻转: leftAngle ≈ -90°

    var topReversed = Math.abs(topAngle) > 90;
    var leftReversed = leftAngle < 0;

    if (topReversed && !leftReversed) {
      result.horizontal = true;
    } else if (!topReversed && leftReversed) {
      result.vertical = true;
    } else if (topReversed && leftReversed) {
      // 双翻转或复杂情况
      result.horizontal = true;
    } else {
      result.horizontal = true; // 默认
    }
  }

  return result;
}

function normalizeAngle(angle) {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

// 根据翻转调整旋转角度显示
function adjustRotationForFlip(rawAngle, flipResult) {
  var angle = rawAngle;

  if (flipResult.horizontal) {
    // 水平翻转时，角度需要取反并调整
    angle = 180 - angle;
  }
  if (flipResult.vertical) {
    // 垂直翻转时
    angle = -angle;
  }

  return normalizeAngle(angle);
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
  var halfW = width / 2;
  var halfH = height / 2;

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
  };
}

// 解析文字图层
function parseTextLayer(layer) {
  var t = {
    content: "",
    font: "",
    size: 0,
    color: "#000000",
    position: null
  };

  try {
    var ti = layer.textItem;
    t.content = ti.contents;
    t.font = ti.font;
    t.size = Math.round(ti.size.as("px"));
    t.color = rgbToHex(ti.color.rgb);
    t.position = {
      x: pxVal(ti.position[0]),
      y: pxVal(ti.position[1])
    };
  } catch (e) {}

  return t;
}

// 辅助函数
function getLayerType(layer) {
  if (layer.typename === "LayerSet") return "Group";
  try {
    switch (layer.kind) {
      case LayerKind.NORMAL: return "Normal";
      case LayerKind.TEXT: return "Text";
      case LayerKind.SMARTOBJECT: return "SmartObject";
      case LayerKind.SOLIDFILL: return "Shape";
      default: return "Other";
    }
  } catch (e) { return "Unknown"; }
}

function getColorMode(mode) {
  switch (mode) {
    case DocumentMode.RGB: return "RGB";
    case DocumentMode.CMYK: return "CMYK";
    case DocumentMode.GRAYSCALE: return "Grayscale";
    default: return "Other";
  }
}

function getBlendMode(layer) {
  try { return layer.blendMode.toString().replace("BlendMode.", ""); }
  catch (e) { return "Normal"; }
}

function rgbToHex(rgb) {
  function hex(n) {
    var h = Math.round(n).toString(16).toUpperCase();
    return h.length < 2 ? "0" + h : h;
  }
  return "#" + hex(rgb.red) + hex(rgb.green) + hex(rgb.blue);
}

// ================== 对话框 ==================
function showResultDialog(result) {
  var report = generateReport(result);

  var dlg = new Window("dialog", "PSD 图层解析结果 v4");
  dlg.orientation = "column";
  dlg.alignChildren = ["fill", "fill"];

  var txt = dlg.add("edittext", undefined, report, {
    multiline: true, scrolling: true, readonly: true
  });
  txt.preferredSize = [780, 550];

  var btnGroup = dlg.add("group");
  btnGroup.alignment = ["center", "bottom"];

  var btnJSON = btnGroup.add("button", undefined, "保存 JSON");
  var btnTXT = btnGroup.add("button", undefined, "保存 TXT");
  var btnBoth = btnGroup.add("button", undefined, "保存全部");
  var btnClose = btnGroup.add("button", undefined, "关闭");

  btnJSON.onClick = function() { saveJSON(result); };
  btnTXT.onClick = function() { saveTXT(report); };
  btnBoth.onClick = function() { saveJSON(result); saveTXT(report); };
  btnClose.onClick = function() { dlg.close(); };

  dlg.show();
}

// 生成报告
function generateReport(data) {
  var lines = [];

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("              PSD 图层解析报告 v4");
  lines.push("           坐标系：左上角原点 (0,0)");
  lines.push("     corners: 变换前的原始坐标（轴对齐矩形）");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");
  lines.push("【文档信息】");
  lines.push("  文件名: " + data.document.name);
  if (data.document.path) lines.push("  路径: " + data.document.path);
  lines.push("  尺寸: " + data.document.width + " x " + data.document.height + " px");
  lines.push("  分辨率: " + data.document.resolution + " ppi");
  lines.push("  颜色模式: " + data.document.colorMode);
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("                    图层列表");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");

  formatLayers(data.layers, lines, "");

  return lines.join("\n");
}

function formatLayers(layers, lines, indent) {
  for (var i = 0; i < layers.length; i++) {
    var L = layers[i];

    var icon;
    switch (L.type) {
      case "SmartObject": icon = "◆"; break;
      case "Text": icon = "T"; break;
      case "Group": icon = "▶"; break;
      case "Shape": icon = "■"; break;
      default: icon = "○";
    }

    var vis = L.visible ? "●" : "○";
    lines.push(indent + "[" + icon + "] " + vis + " " + L.name);

    var sub = indent + "    ";

    if (L.bounds) {
      lines.push(sub + "位置: (" + L.bounds.x + ", " + L.bounds.y + ")");
      lines.push(sub + "尺寸: " + L.bounds.width + " × " + L.bounds.height + " px");
      lines.push(sub + "中心: (" + L.bounds.centerX + ", " + L.bounds.centerY + ")");
    }

    lines.push(sub + "不透明度: " + L.opacity + "% | 混合: " + L.blendMode);

    // 智能对象
    if (L.smartObject) {
      var so = L.smartObject;
      lines.push(sub + "┌─── 智能对象 " + (so.linked ? "[链接]" : "[嵌入]") + " ───┐");

      if (so.fileName) lines.push(sub + "│ 文件: " + so.fileName);
      if (so.originalSize) {
        lines.push(sub + "│ 原始尺寸: " + so.originalSize.width + " × " + so.originalSize.height);
      }
      if (so.currentSize) {
        lines.push(sub + "│ 当前尺寸: " + so.currentSize.width + " × " + so.currentSize.height);
      }

      lines.push(sub + "│");
      lines.push(sub + "│ 【变换参数】");
      lines.push(sub + "│ 缩放: X=" + so.transform.scaleX + "%, Y=" + so.transform.scaleY + "%");
      lines.push(sub + "│ 旋转: " + so.transform.rotation + "°");

      var flipStr = [];
      if (so.transform.flipHorizontal) flipStr.push("水平");
      if (so.transform.flipVertical) flipStr.push("垂直");
      lines.push(sub + "│ 翻转: " + (flipStr.length > 0 ? flipStr.join(" + ") : "无"));

      // 变换前坐标（核心输出）
      if (so.corners) {
        lines.push(sub + "│");
        lines.push(sub + "│ 【变换前坐标】（轴对齐矩形）");
        lines.push(sub + "│   左上: (" + so.corners.topLeft.x + ", " + so.corners.topLeft.y + ")");
        lines.push(sub + "│   右上: (" + so.corners.topRight.x + ", " + so.corners.topRight.y + ")");
        lines.push(sub + "│   右下: (" + so.corners.bottomRight.x + ", " + so.corners.bottomRight.y + ")");
        lines.push(sub + "│   左下: (" + so.corners.bottomLeft.x + ", " + so.corners.bottomLeft.y + ")");
      }

      // 变换后坐标
      if (so.cornersTransformed) {
        lines.push(sub + "│");
        lines.push(sub + "│ 【变换后坐标】（实际位置）");
        lines.push(sub + "│   左上: (" + so.cornersTransformed.topLeft.x + ", " + so.cornersTransformed.topLeft.y + ")");
        lines.push(sub + "│   右上: (" + so.cornersTransformed.topRight.x + ", " + so.cornersTransformed.topRight.y + ")");
        lines.push(sub + "│   右下: (" + so.cornersTransformed.bottomRight.x + ", " + so.cornersTransformed.bottomRight.y + ")");
        lines.push(sub + "│   左下: (" + so.cornersTransformed.bottomLeft.x + ", " + so.cornersTransformed.bottomLeft.y + ")");
      }

      lines.push(sub + "└────────────────────────────┘");
    }

    // 文字
    if (L.text) {
      var t = L.text;
      var preview = t.content.replace(/[\r\n]/g, " ");
      if (preview.length > 25) preview = preview.substring(0, 25) + "...";

      lines.push(sub + "┌─── 文字 ───┐");
      lines.push(sub + "│ 内容: \"" + preview + "\"");
      lines.push(sub + "│ 字体: " + t.font);
      lines.push(sub + "│ 大小: " + t.size + "px | 颜色: " + t.color);
      if (t.position) {
        lines.push(sub + "│ 位置: (" + t.position.x + ", " + t.position.y + ")");
      }
      lines.push(sub + "└─────────────┘");
    }

    lines.push("");

    if (L.children) {
      formatLayers(L.children, lines, indent + "  ");
    }
  }
}

// 保存文件
function saveJSON(data) {
  var file = File.saveDialog("保存 JSON 文件", "*.json");
  if (file) {
    file.encoding = "UTF-8";
    file.open("w");
    file.write(toJSON(data, "  "));
    file.close();
    alert("JSON 已保存:\n" + file.fsName);
  }
}

function saveTXT(report) {
  var file = File.saveDialog("保存文本文件", "*.txt");
  if (file) {
    file.encoding = "UTF-8";
    file.open("w");
    file.write(report);
    file.close();
    alert("TXT 已保存:\n" + file.fsName);
  }
}

// JSON 序列化
function toJSON(obj, indent) {
  return _json(obj, indent || "", "");
}

function _json(val, indent, cur) {
  if (val === null || val === undefined) return "null";
  var t = typeof val;
  if (t === "string") {
    return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
  }
  if (t === "number") return isFinite(val) ? String(val) : "null";
  if (t === "boolean") return String(val);
  if (val instanceof Array) {
    if (val.length === 0) return "[]";
    var arr = [], ni = cur + indent;
    for (var i = 0; i < val.length; i++) arr.push(ni + _json(val[i], indent, ni));
    return "[\n" + arr.join(",\n") + "\n" + cur + "]";
  }
  if (t === "object") {
    var props = [], ni = cur + indent;
    for (var k in val) {
      if (val.hasOwnProperty(k)) props.push(ni + '"' + k + '": ' + _json(val[k], indent, ni));
    }
    if (props.length === 0) return "{}";
    return "{\n" + props.join(",\n") + "\n" + cur + "}";
  }
  return "null";
}

// 执行
main();
