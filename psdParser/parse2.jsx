/*
 * Photoshop 智能对象导出脚本
 * 功能：导出文档中所有智能对象图层
 */

#target photoshop

// 确保有文档打开
if (app.documents.length === 0) {
  alert("请先打开一个文档！");
} else {
  main();
}

function main() {
  var doc = app.activeDocument;
  var docPath = doc.path;
  var docName = doc.name.replace(/\.[^\.]+$/, ''); // 移除扩展名

  // 创建导出文件夹
  var exportFolder = new Folder(docPath + "/" + docName + "_SmartObjects");
  if (!exportFolder.exists) {
    exportFolder.create();
  }

  // 保存当前状态
  var savedState = doc.activeHistoryState;

  // 收集所有智能对象
  var smartObjects = [];
  collectSmartObjects(doc, smartObjects, "");

  if (smartObjects.length === 0) {
    alert("文档中没有找到智能对象！");
    return;
  }

  // 显示选项对话框
  var options = showOptionsDialog(smartObjects.length);
  if (!options) return; // 用户取消
  smartObjects = [smartObjects[0]]
  // 导出智能对象
  var exportedCount = 0;
  for (var i = 0; i < smartObjects.length; i++) {
    try {
      exportSmartObject(smartObjects[i], exportFolder, options, i + 1);
      exportedCount++;
    } catch (e) {
      $.writeln("导出失败: " + smartObjects[i].layer.name + " - " + e);
    }
  }

  // 恢复状态
  doc.activeHistoryState = savedState;

  alert("导出完成！\n共导出 " + exportedCount + " 个智能对象\n保存位置: " + exportFolder.fsName);
}

// 递归收集所有智能对象
function collectSmartObjects(container, result, path) {
  for (var i = 0; i < container.layers.length; i++) {
    var layer = container.layers[i];
    var currentPath = path ? path + "/" + layer.name : layer.name;

    if (layer.typename === "LayerSet") {
      // 图层组，递归搜索
      collectSmartObjects(layer, result, currentPath);
    } else if (layer.kind === LayerKind.SMARTOBJECT) {
      result.push({
        layer: layer,
        path: currentPath
      });
    }
  }
}

// 显示选项对话框
function showOptionsDialog(count) {
  var dialog = new Window('dialog', '导出智能对象');

  dialog.add('statictext', undefined, '找到 ' + count + ' 个智能对象');

  // 格式选择
  var formatPanel = dialog.add('panel', undefined, '导出格式');
  formatPanel.alignChildren = 'left';
  var formatPNG = formatPanel.add('radiobutton', undefined, 'PNG');
  var formatPSD = formatPanel.add('radiobutton', undefined, 'PSD (保留图层)');
  var formatJPG = formatPanel.add('radiobutton', undefined, 'JPG');
  var formatOriginal = formatPanel.add('radiobutton', undefined, '原始格式 (直接提取)');
  formatPNG.value = true;

  // 命名选项
  var namePanel = dialog.add('panel', undefined, '命名方式');
  namePanel.alignChildren = 'left';
  var nameOriginal = namePanel.add('radiobutton', undefined, '使用图层名');
  var nameWithIndex = namePanel.add('radiobutton', undefined, '图层名 + 序号');
  nameOriginal.value = true;

  // 其他选项
  var optPanel = dialog.add('panel', undefined, '其他选项');
  optPanel.alignChildren = 'left';
  var keepStructure = optPanel.add('checkbox', undefined, '保持图层组结构');
  var skipHidden = optPanel.add('checkbox', undefined, '跳过隐藏图层');

  // 按钮
  var btnGroup = dialog.add('group');
  btnGroup.add('button', undefined, '导出', {name: 'ok'});
  btnGroup.add('button', undefined, '取消', {name: 'cancel'});

  if (dialog.show() === 1) {
    var format = 'png';
    if (formatPSD.value) format = 'psd';
    if (formatJPG.value) format = 'jpg';
    if (formatOriginal.value) format = 'original';

    return {
      format: format,
      addIndex: nameWithIndex.value,
      keepStructure: keepStructure.value,
      skipHidden: skipHidden.value
    };
  }
  return null;
}

// 导出单个智能对象
function exportSmartObject(soInfo, baseFolder, options, index) {
  var layer = soInfo.layer;

  // 跳过隐藏图层
  if (options.skipHidden && !layer.visible) {
    return;
  }

  // 确定保存路径
  var saveFolder = baseFolder;
  if (options.keepStructure) {
    var pathParts = soInfo.path.split('/');
    pathParts.pop(); // 移除图层名
    for (var i = 0; i < pathParts.length; i++) {
      saveFolder = new Folder(saveFolder + "/" + sanitizeFileName(pathParts[i]));
      if (!saveFolder.exists) saveFolder.create();
    }
  }

  // 生成文件名
  var fileName = sanitizeFileName(layer.name);
  if (options.addIndex) {
    fileName = index + "_" + fileName;
  }

  // 选择导出方式
  if (options.format === 'original') {
    // 直接提取智能对象内容
    extractSmartObjectContent(layer, saveFolder, fileName);
  } else {
    // 转换格式导出
    exportAsFormat(layer, saveFolder, fileName, options.format);
  }
}

// 直接提取智能对象内容
function extractSmartObjectContent(layer, folder, fileName) {
  var doc = app.activeDocument;
  doc.activeLayer = layer;

  // 使用 Action Manager 提取智能对象
  var idplacedLayerExportContents = stringIDToTypeID("placedLayerExportContents");
  var desc = new ActionDescriptor();
  var idnull = charIDToTypeID("null");

  // 尝试确定原始格式
  var ext = ".psd"; // 默认扩展名
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var layerDesc = executeActionGet(ref);
    var smartObjDesc = layerDesc.getObjectValue(stringIDToTypeID("smartObject"));
    if (smartObjDesc.hasKey(stringIDToTypeID("fileReference"))) {
      var fileRef = smartObjDesc.getString(stringIDToTypeID("fileReference"));
      var match = fileRef.match(/\.[^\.]+$/);
      if (match) ext = match[0];
    }
  } catch (e) {}

  desc.putPath(idnull, new File(folder + "/" + fileName + ext));
  executeAction(idplacedLayerExportContents, desc, DialogModes.NO);
}

// 转换格式导出
function exportAsFormat(layer, folder, fileName, format) {
  var doc = app.activeDocument;

  // 复制智能对象内容到新文档
  doc.activeLayer = layer;

  // 打开智能对象
  var idplacedLayerEditContents = stringIDToTypeID("placedLayerEditContents");
  var desc = new ActionDescriptor();
  executeAction(idplacedLayerEditContents, desc, DialogModes.NO);

  var soDoc = app.activeDocument;

  // 根据格式保存
  var saveFile = new File(folder + "/" + fileName);

  switch (format) {
    case 'png':
      var pngOpts = new PNGSaveOptions();
      pngOpts.compression = 6;
      pngOpts.interlaced = false;
      soDoc.saveAs(new File(saveFile + ".png"), pngOpts, true, Extension.LOWERCASE);
      break;

    case 'jpg':
      var jpgOpts = new JPEGSaveOptions();
      jpgOpts.quality = 10;
      jpgOpts.embedColorProfile = true;
      soDoc.saveAs(new File(saveFile + ".jpg"), jpgOpts, true, Extension.LOWERCASE);
      break;

    case 'psd':
      var psdOpts = new PhotoshopSaveOptions();
      psdOpts.layers = true;
      psdOpts.embedColorProfile = true;
      soDoc.saveAs(new File(saveFile + ".psd"), psdOpts, true, Extension.LOWERCASE);
      break;
  }

  // 关闭智能对象文档（不保存更改）
  soDoc.close(SaveOptions.DONOTSAVECHANGES);
}

// 清理文件名
function sanitizeFileName(name) {
  // 移除非法字符
  // return name.replace(/[\\/:*?"<>|]/g, "_");
  return name.replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");

}
