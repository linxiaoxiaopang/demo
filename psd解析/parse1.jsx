// Photoshop 图层图片解析+批量导出脚本（ES5 兼容版）
// 功能：解析普通图片/智能对象图层，导出图片到指定文件夹（适配旧版JS环境）
#target photoshop

// 检查是否打开 PSD 文档
if (app.documents.length === 0) {
  alert("请先打开一个 PSD 文档！");
  exit();
}

var doc = app.activeDocument;
var result = {
  documentName: doc.name,
  documentSize: { width: doc.width + "px", height: doc.height + "px" },
  totalLayers: 0,
  normalImageLayers: [],
  smartObjectLayers: [],
  exportedFiles: []
};

if (typeof JSON === 'undefined') {
  JSON = {};
  JSON.stringify = function(obj) {
    var type = typeof obj;
    if (type !== 'object' || obj === null) {
      if (type === 'string') obj = '"' + obj.replace(/"/g, '\\"') + '"';
      return String(obj);
    } else {
      var json = [];
      var arr = Array.isArray(obj);
      for (var k in obj) {
        var v = obj[k];
        var type = typeof v;
        if (obj.hasOwnProperty(k)) {
          if (type === 'string') v = '"' + v.replace(/"/g, '\\"') + '"';
          else if (type === 'object' && v !== null) v = JSON.stringify(v);
          json.push((arr ? '' : '"' + k + '":') + String(v));
        }
      }
      return (arr ? '[' : '{') + json.join(',') + (arr ? ']' : '}');
    }
  };
}

// 全局变量：目标文件夹
var targetFolder = null;

/**
 * 递归遍历图层（处理分组嵌套）
 * @param {Layer/LayerSet} parent - 父图层/分组
 */
function traverseLayers(parent) {
  var i;
  // 遍历普通图层
  for (i = 0; i < parent.artLayers.length; i++) {
    var layer = parent.artLayers[i];
    result.totalLayers++;

    // 1. 普通图片图层（像素图层）- 导出为 PNG
    if (layer.bounds.length === 4 && !isNaN(layer.bounds[0]) && !isNaN(layer.bounds[2]) && layer.bounds[2] > layer.bounds[0] && layer.bounds[3] > layer.bounds[1]) {
      // 后续逻辑
      var layerInfo = {
        layerName: layer.name,
        type: "普通图片图层（像素图层）",
        position: { x: layer.bounds[0] + "px", y: layer.bounds[1] + "px" },
        size: { width: (layer.bounds[2] - layer.bounds[0]) + "px", height: (layer.bounds[3] - layer.bounds[1]) + "px" },
        visibility: layer.visible ? "显示" : "隐藏",
        opacity: layer.opacity + "%",
        exportedPath: ""
      };

      // 只导出可见图层
      if (layer.visible) {
        var exportPath = exportNormalLayer(layer);
        layerInfo.exportedPath = exportPath;
        result.exportedFiles.push(exportPath);
      }

      result.normalImageLayers.push(layerInfo);
    }

    // 2. 智能对象图层 - 区分嵌入/链接并导出
    else if (layer.kind === LayerKind.SMARTOBJECT) {
      var smartObjInfo = {
        layerName: layer.name,
        type: "智能对象图层",
        position: { x: layer.bounds[0] + "px", y: layer.bounds[1] + "px" },
        size: { width: (layer.bounds[2] - layer.bounds[0]) + "px", height: (layer.bounds[3] - layer.bounds[1]) + "px" },
        visibility: layer.visible ? "显示" : "隐藏",
        opacity: layer.opacity + "%",
        isLinked: false,
        sourcePath: "无（嵌入智能对象）",
        exportedPath: ""
      };

      // 检查链接智能对象
      try {
        if (layer.smartObject.linkedFile !== undefined && layer.smartObject.linkedFile.exists) {
          smartObjInfo.isLinked = true;
          smartObjInfo.sourcePath = layer.smartObject.linkedFile.fsName;

          // 导出链接智能对象（复制原始文件）
          if (layer.visible) {
            var soLinkPath = exportLinkedSmartObject(layer);
            smartObjInfo.exportedPath = soLinkPath;
            result.exportedFiles.push(soLinkPath);
          }
        } else {
          // 导出嵌入智能对象（提取原始数据）
          if (layer.visible) {
            var soEmbedPath = exportEmbeddedSmartObject(layer);
            smartObjInfo.exportedPath = soEmbedPath;
            result.exportedFiles.push(soEmbedPath);
          }
        }
      } catch (e) {
        smartObjInfo.sourcePath = "嵌入智能对象（读取失败）";
        smartObjInfo.exportedPath = "导出失败";
      }

      result.smartObjectLayers.push(smartObjInfo);
    }
  }

  // 递归处理分组
  for (i = 0; i < parent.layerSets.length; i++) {
    traverseLayers(parent.layerSets[i]);
  }
}

/**
 * 导出普通图片图层（像素图层）
 * @param {ArtLayer} layer - 普通图片图层
 * @returns {string} 导出文件路径
 */
function exportNormalLayer(layer) {
  // 创建临时文档
  var layerWidth = layer.bounds[2] - layer.bounds[0];
  var layerHeight = layer.bounds[3] - layer.bounds[1];
// 创建临时文档后，复制图层的完整逻辑：
  var tempDoc = app.documents.add(layerWidth, layerHeight, doc.resolution, "临时文档", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

// 检查layer是否有效
  if (layer === undefined || !layer.isValid) {
    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
    return "图层无效，无法导出";
  }

// 复制图层（用数值0替代枚举）
  var duplicatedLayer = layer.duplicate(tempDoc, 0);
  // 复制图层到临时文档
  duplicatedLayer.translate(-layer.bounds[0], -layer.bounds[1]);

  // 构建导出路径
  var normalFolder = new Folder(targetFolder.fsName + "/普通图片");
  if (!normalFolder.exists) {
    normalFolder.create();
  }
  var safeName = sanitizeFileName(layer.name);
  var timeStamp = new Date().getTime();
  var fileName = safeName + "_" + timeStamp + ".png";
  var exportPath = normalFolder.fsName + "/" + fileName;

  // 导出为 PNG
  var pngOptions = new PNGSaveOptions();
  pngOptions.compression = 6;
  tempDoc.saveAs(new File(exportPath), pngOptions, true);
  tempDoc.close(SaveOptions.DONOTSAVECHANGES);

  return exportPath;
}

/**
 * 导出链接智能对象（复制原始文件）
 * @param {ArtLayer} layer - 链接智能对象图层
 * @returns {string} 导出文件路径
 */
function exportLinkedSmartObject(layer) {
  var sourceFile = new File(layer.smartObject.linkedFile.fsName);
  if (!sourceFile.exists) {
    return "源文件不存在";
  }

  // 构建导出路径
  var linkFolder = new Folder(targetFolder.fsName + "/智能对象-链接");
  if (!linkFolder.exists) {
    linkFolder.create();
  }
  var safeName = sanitizeFileName(layer.name);
  var originalFileName = sourceFile.name;
  var fileName = safeName + "_" + originalFileName;
  var exportPath = linkFolder.fsName + "/" + fileName;

  // 复制文件（覆盖已存在文件）
  sourceFile.copy(exportPath, true);
  return exportPath;
}

/**
 * 导出嵌入智能对象（提取原始数据）
 * @param {ArtLayer} layer - 嵌入智能对象图层
 * @returns {string} 导出文件路径
 */
function exportEmbeddedSmartObject(layer) {
  // 临时文件夹
  var tempFolder = new Folder(Folder.temp.fsName + "/PS_Embedded_SO");
  if (!tempFolder.exists) {
    tempFolder.create();
  }
  var timeStamp = new Date().getTime();
  var tempFile = new File(tempFolder.fsName + "/temp_" + timeStamp + ".png");

  // 提取嵌入智能对象并保存到临时文件
  layer.smartObject.exportTo(tempFile, ExportFormat.PNG);

  // 构建最终导出路径
  var embedFolder = new Folder(targetFolder.fsName + "/智能对象-嵌入");
  if (!embedFolder.exists) {
    embedFolder.create();
  }
  var safeName = sanitizeFileName(layer.name);
  var fileName = safeName + "_" + timeStamp + ".png";
  var exportPath = embedFolder.fsName + "/" + fileName;

  // 复制临时文件到目标路径
  tempFile.copy(exportPath, true);
  tempFile.remove();

  return exportPath;
}

/**
 * 文件名 sanitize（去除非法字符）
 * @param {string} name - 原始图层名
 * @returns {string} 安全文件名
 */
function sanitizeFileName(name) {
  // 去除 Windows/Mac 非法文件名字符（\/:*?"<>|）
  return name.replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

/**
 * 导出结果 JSON + 图片文件
 */
function exportAll() {
  // 选择目标文件夹
  targetFolder = Folder.selectDialog("选择图片导出的目标文件夹");
  if (!targetFolder) {
    alert("取消导出！");
    return;
  }

  // 开始遍历图层（解析+导出）
  traverseLayers(doc);

  // 导出结果 JSON
  var jsonFile = new File(targetFolder.fsName + "/图层解析结果.json");
  jsonFile.open("w");
  jsonFile.write(JSON.stringify(result, null, 2));
  jsonFile.close();

  // 统计导出成功的文件数（ES5 兼容写法：替换箭头函数为普通函数）
  var totalExported = 0;
  if (result.exportedFiles && result.exportedFiles.length > 0) {
    totalExported = result.exportedFiles.filter(function(path) {
      return path !== "" && path !== "导出失败" && path !== "源文件不存在";
    }).length;
  }

  // 统计各类型导出数
  var normalExported = 0;
  for (var i = 0; i < result.normalImageLayers.length; i++) {
    if (result.normalImageLayers[i].exportedPath !== "") {
      normalExported++;
    }
  }

  var soExported = 0;
  var soLinkedCount = 0;
  for (var j = 0; j < result.smartObjectLayers.length; j++) {
    var soLayer = result.smartObjectLayers[j];
    if (soLayer.isLinked) {
      soLinkedCount++;
    }
    if (soLayer.exportedPath !== "" && soLayer.exportedPath !== "导出失败") {
      soExported++;
    }
  }

  // 弹出结果提示（替换模板字符串为字符串拼接）
  alert(
    "解析+导出完成！\n" +
    "文档：" + doc.name + "\n" +
    "总图层数：" + result.totalLayers + "\n" +
    "普通图片图层：" + result.normalImageLayers.length + " 个（导出：" + normalExported + " 个）\n" +
    "智能对象图层：" + result.smartObjectLayers.length + " 个（链接：" + soLinkedCount + " 个，导出：" + soExported + " 个）\n" +
    "总计导出图片：" + totalExported + " 张\n" +
    "文件保存至：" + targetFolder.fsName + "\n" +
    "解析结果：" + jsonFile.fsName
  );
}

// 执行主流程
exportAll();
