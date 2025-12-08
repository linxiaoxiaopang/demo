/*
 * PSD 图层解析 + 导出脚本
 * 仅导出：普通图层 + 智能对象
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
    showMainDialog(result);
}

// ================== 基础函数 ==================

function getDocPath(doc) {
    try { return doc.path.fsName; } catch (e) { return ""; }
}

function pxVal(v) {
    try { return Math.round(v.as("px")); } catch (e) { return 0; }
}

function r2(n) {
    return Math.round(n * 100) / 100;
}

function dist(a, b) {
    return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

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

// ================== 图层解析 ==================

function parseLayers(layers, target, depth) {
    for (var i = 0; i < layers.length; i++) {
        try {
            var layer = layers[i];
            var info = parseLayer(layer, depth);
            
            // 只添加普通图层和智能对象
            if (info.type === "Normal" || info.type === "SmartObject") {
                info.layerRef = layer;
                target.push(info);
            }
            
            // 递归处理图层组
            if (layer.typename === "LayerSet" && layer.layers.length > 0) {
                parseLayers(layer.layers, target, depth + 1);
            }
        } catch (e) {}
    }
}

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
    
    // 智能对象信息
    if (layer.kind === LayerKind.SMARTOBJECT) {
        info.smartObject = parseSmartObject(layer, info.bounds);
    }
    
    if (savedLayer) {
        try { doc.activeLayer = savedLayer; } catch (e) {}
    }
    
    return info;
}

function parseSmartObject(layer, layerBounds) {
    var so = {
        linked: false,
        filePath: "",
        fileName: "",
        originalSize: null,
        currentSize: null,
        transform: { scaleX: 100, scaleY: 100, rotation: 0 },
        corners: null
    };
    
    try {
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);
        
        var soDesc = safeGetObject(desc, stringIDToTypeID("smartObject"));
        if (soDesc) {
            so.linked = safeGetBoolean(soDesc, stringIDToTypeID("linked"));
            
            // 获取文件路径
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
            var sizeDesc = safeGetObject(more, stringIDToTypeID("size"));
            var origW = 0, origH = 0;
            if (sizeDesc) {
                origW = safeGetDouble(sizeDesc, stringIDToTypeID("width"));
                origH = safeGetDouble(sizeDesc, stringIDToTypeID("height"));
                so.originalSize = { width: r2(origW), height: r2(origH) };
            }
            
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
            
            var tfList = safeGetList(more, stringIDToTypeID("transform"));
            if (tfList && tfList.count === 8) {
                var tl = { x: tfList.getDouble(0), y: tfList.getDouble(1) };
                var tr = { x: tfList.getDouble(2), y: tfList.getDouble(3) };
                var br = { x: tfList.getDouble(4), y: tfList.getDouble(5) };
                var bl = { x: tfList.getDouble(6), y: tfList.getDouble(7) };
                
                so.corners = {
                    topLeft: { x: r2(tl.x), y: r2(tl.y) },
                    topRight: { x: r2(tr.x), y: r2(tr.y) },
                    bottomRight: { x: r2(br.x), y: r2(br.y) },
                    bottomLeft: { x: r2(bl.x), y: r2(bl.y) }
                };
                
                var currentW = dist(tl, tr);
                var currentH = dist(tl, bl);
                so.currentSize = { width: r2(currentW), height: r2(currentH) };
                
                so.transform.rotation = r2(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
                
                if (effectiveW > 0 && effectiveH > 0) {
                    so.transform.scaleX = r2((currentW / effectiveW) * 100);
                    so.transform.scaleY = r2((currentH / effectiveH) * 100);
                }
            }
            
            if (so.transform.scaleX === 100 && so.transform.scaleY === 100 && layerBounds) {
                if (effectiveW > 0 && effectiveH > 0 && so.transform.rotation === 0) {
                    so.transform.scaleX = r2((layerBounds.width / effectiveW) * 100);
                    so.transform.scaleY = r2((layerBounds.height / effectiveH) * 100);
                    so.currentSize = { width: layerBounds.width, height: layerBounds.height };
                }
            }
        }
    } catch (e) {
        so.error = e.message;
    }
    
    return so;
}

// ================== 辅助函数 ==================

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

function sanitizeFileName(name) {
    return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

// ================== 主对话框 ==================

function showMainDialog(result) {
    var report = generateReport(result);
    
    var dlg = new Window("dialog", "PSD 图层解析与导出（普通图层 + 智能对象）");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "fill"];
    
    // 标签页
    var tabs = dlg.add("tabbedpanel");
    tabs.alignChildren = ["fill", "fill"];
    tabs.preferredSize = [700, 500];
    
    // === 图层信息标签 ===
    var tabInfo = tabs.add("tab", undefined, "图层信息");
    tabInfo.alignChildren = ["fill", "fill"];
    var txtInfo = tabInfo.add("edittext", undefined, report, {
        multiline: true, scrolling: true, readonly: true
    });
    txtInfo.preferredSize = [680, 420];
    
    // === 导出设置标签 ===
    var tabExport = tabs.add("tab", undefined, "导出图层");
    tabExport.alignChildren = ["fill", "top"];
    tabExport.orientation = "column";
    
    // 导出格式
    var grpFormat = tabExport.add("panel", undefined, "导出格式");
    grpFormat.alignChildren = ["left", "center"];
    grpFormat.orientation = "row";
    
    var rbPNG = grpFormat.add("radiobutton", undefined, "PNG");
    var rbJPG = grpFormat.add("radiobutton", undefined, "JPG");
    rbPNG.value = true;
    
    grpFormat.add("statictext", undefined, "   JPG质量:");
    var sliderQuality = grpFormat.add("slider", undefined, 80, 1, 100);
    sliderQuality.preferredSize = [100, 20];
    var lblQuality = grpFormat.add("statictext", undefined, "80");
    lblQuality.characters = 3;
    sliderQuality.onChanging = function() {
        lblQuality.text = Math.round(sliderQuality.value);
    };
    
    // 导出选项
    var grpOptions = tabExport.add("panel", undefined, "导出选项");
    grpOptions.alignChildren = ["left", "center"];
    grpOptions.orientation = "column";
    
    var cbVisibleOnly = grpOptions.add("checkbox", undefined, "仅导出可见图层");
    cbVisibleOnly.value = true;
    
    var cbTrim = grpOptions.add("checkbox", undefined, "裁剪透明区域");
    cbTrim.value = true;
    
    // 缩放
    var grpScale = tabExport.add("panel", undefined, "导出缩放");
    grpScale.alignChildren = ["left", "center"];
    grpScale.orientation = "row";
    
    grpScale.add("statictext", undefined, "缩放比例:");
    var ddScale = grpScale.add("dropdownlist", undefined, 
        ["100%", "200%", "50%", "25%", "75%", "150%", "300%"]);
    ddScale.selection = 0;
    
    grpScale.add("statictext", undefined, "  自定义:");
    var inputScale = grpScale.add("edittext", undefined, "100");
    inputScale.characters = 5;
    grpScale.add("statictext", undefined, "%");
    
    // 命名
    var grpNaming = tabExport.add("panel", undefined, "文件命名");
    grpNaming.alignChildren = ["left", "center"];
    grpNaming.orientation = "row";
    
    grpNaming.add("statictext", undefined, "前缀:");
    var inputPrefix = grpNaming.add("edittext", undefined, "");
    inputPrefix.characters = 8;
    
    grpNaming.add("statictext", undefined, "后缀:");
    var inputSuffix = grpNaming.add("edittext", undefined, "");
    inputSuffix.characters = 8;
    
    var cbAddIndex = grpNaming.add("checkbox", undefined, "添加序号");
    cbAddIndex.value = false;
    
    // 图层列表
    var grpList = tabExport.add("panel", undefined, "选择导出图层（仅显示普通图层和智能对象）");
    grpList.alignChildren = ["fill", "fill"];
    
    var layerList = grpList.add("listbox", undefined, [], { multiselect: true });
    layerList.preferredSize = [660, 140];
    
    // 填充列表
    var allLayers = [];
    for (var i = 0; i < result.layers.length; i++) {
        var L = result.layers[i];
        var icon = L.type === "SmartObject" ? "[SO]" : "[L]";
        var vis = L.visible ? "[v]" : "[ ]";
        var item = layerList.add("item", icon + " " + vis + " " + L.name);
        item.layerData = L;
        allLayers.push({ item: item, data: L });
    }
    
    // 选择按钮
    var grpSelectBtn = grpList.add("group");
    grpSelectBtn.alignment = ["left", "center"];
    
    var btnSelectAll = grpSelectBtn.add("button", undefined, "全选");
    var btnSelectNone = grpSelectBtn.add("button", undefined, "取消");
    var btnSelectVisible = grpSelectBtn.add("button", undefined, "可见");
    var btnSelectSO = grpSelectBtn.add("button", undefined, "智能对象");
    var btnSelectNormal = grpSelectBtn.add("button", undefined, "普通图层");
    
    btnSelectAll.onClick = function() {
        for (var i = 0; i < layerList.items.length; i++) {
            layerList.items[i].selected = true;
        }
    };
    
    btnSelectNone.onClick = function() {
        for (var i = 0; i < layerList.items.length; i++) {
            layerList.items[i].selected = false;
        }
    };
    
    btnSelectVisible.onClick = function() {
        for (var i = 0; i < allLayers.length; i++) {
            allLayers[i].item.selected = allLayers[i].data.visible;
        }
    };
    
    btnSelectSO.onClick = function() {
        for (var i = 0; i < allLayers.length; i++) {
            allLayers[i].item.selected = (allLayers[i].data.type === "SmartObject");
        }
    };
    
    btnSelectNormal.onClick = function() {
        for (var i = 0; i < allLayers.length; i++) {
            allLayers[i].item.selected = (allLayers[i].data.type === "Normal");
        }
    };
    
    // 底部按钮
    var btnGroup = dlg.add("group");
    btnGroup.alignment = ["center", "bottom"];
    
    var btnExport = btnGroup.add("button", undefined, "导出选中");
    var btnExportAll = btnGroup.add("button", undefined, "导出全部");
    var btnSaveJSON = btnGroup.add("button", undefined, "保存JSON");
    var btnSaveTXT = btnGroup.add("button", undefined, "保存TXT");
    var btnClose = btnGroup.add("button", undefined, "关闭");
    
    // 获取设置
    function getSettings() {
        var scale = 100;
        if (inputScale.text && !isNaN(parseFloat(inputScale.text))) {
            scale = parseFloat(inputScale.text);
        } else if (ddScale.selection) {
            scale = parseFloat(ddScale.selection.text);
        }
        
        return {
            format: rbPNG.value ? "PNG" : "JPG",
            quality: Math.round(sliderQuality.value),
            scale: scale,
            visibleOnly: cbVisibleOnly.value,
            trim: cbTrim.value,
            prefix: inputPrefix.text,
            suffix: inputSuffix.text,
            addIndex: cbAddIndex.value
        };
    }
    
    // 导出选中
    btnExport.onClick = function() {
        var selected = [];
        for (var i = 0; i < allLayers.length; i++) {
            if (allLayers[i].item.selected) {
                selected.push(allLayers[i].data);
            }
        }
        
        if (selected.length === 0) {
            alert("请选择要导出的图层！");
            return;
        }
        
        var folder = Folder.selectDialog("选择导出目录");
        if (!folder) return;
        
        exportLayers(selected, folder, getSettings());
    };
    
    // 导出全部
    btnExportAll.onClick = function() {
        var folder = Folder.selectDialog("选择导出目录");
        if (!folder) return;
        
        var settings = getSettings();
        var toExport = [];
        
        for (var i = 0; i < result.layers.length; i++) {
            var L = result.layers[i];
            if (settings.visibleOnly && !L.visible) continue;
            toExport.push(L);
        }
        
        if (toExport.length === 0) {
            alert("没有符合条件的图层！");
            return;
        }
        
        exportLayers(toExport, folder, settings);
    };
    
    btnSaveJSON.onClick = function() { saveJSON(result); };
    btnSaveTXT.onClick = function() { saveTXT(report); };
    btnClose.onClick = function() { dlg.close(); };
    
    dlg.show();
}

// ================== 导出功能 ==================

function exportLayers(layers, folder, settings) {
    var doc = app.activeDocument;
    var count = 0;
    var errors = [];
    
    // 保存原始状态
    var originalState = doc.activeHistoryState;
    
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        var layer = L.layerRef;
        
        if (!layer) continue;
        
        try {
            // 生成文件名
            var fileName = settings.prefix + sanitizeFileName(L.name) + settings.suffix;
            if (settings.addIndex) {
                fileName = padNumber(i + 1, 3) + "_" + fileName;
            }
            
            // 导出图层
            exportSingleLayer(layer, folder, fileName, settings, L.type);
            count++;
            
        } catch (e) {
            errors.push(L.name + ": " + e.message);
        }
        
        // 恢复状态
        try {
            doc.activeHistoryState = originalState;
        } catch (e) {}
    }
    
    // 显示结果
    var msg = "导出完成！\n\n";
    msg += "成功: " + count + " 个图层\n";
    msg += "目录: " + folder.fsName;
    
    if (errors.length > 0) {
        msg += "\n\n失败 (" + errors.length + "):\n" + errors.slice(0, 5).join("\n");
        if (errors.length > 5) msg += "\n...等";
    }
    
    alert(msg);
}

function exportSingleLayer(layer, folder, fileName, settings, layerType) {
    var doc = app.activeDocument;
    var newDoc = null;
    
    try {
        // 智能对象：导出原始内容
        if (layerType === "SmartObject" && settings.exportOriginal !== false) {
            newDoc = exportSmartObjectContent(layer, settings);
        }
        
        // 普通图层或智能对象回退
        if (!newDoc) {
            newDoc = duplicateLayerToNewDoc(layer, settings.trim);
        }
        
        // 缩放
        if (settings.scale !== 100 && newDoc) {
            var newW = newDoc.width.as("px") * (settings.scale / 100);
            var newH = newDoc.height.as("px") * (settings.scale / 100);
            newDoc.resizeImage(
                UnitValue(newW, "px"),
                UnitValue(newH, "px"),
                newDoc.resolution,
                ResampleMethod.BICUBIC
            );
        }
        
        // 保存
        if (newDoc) {
            var filePath = folder.fsName + "/" + fileName;
            
            if (settings.format === "PNG") {
                savePNG(newDoc, filePath + ".png");
            } else {
                saveJPG(newDoc, filePath + ".jpg", settings.quality);
            }
        }
        
    } finally {
        if (newDoc) {
            newDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    }
}

// 导出智能对象原始内容
function exportSmartObjectContent(layer, settings) {
    var doc = app.activeDocument;
    var newDoc = null;
    
    try {
        // 选中智能对象图层
        doc.activeLayer = layer;
        
        // 尝试编辑智能对象内容
        var idnewPlacedLayer = stringIDToTypeID("placedLayerEditContents");
        var desc = new ActionDescriptor();
        executeAction(idnewPlacedLayer, desc, DialogModes.NO);
        
        // 获取打开的智能对象文档
        if (app.documents.length > 1) {
            var soDoc = app.activeDocument;
            
            // 复制整个文档
            newDoc = soDoc.duplicate();
            
            // 合并
            newDoc.flatten();
            
            // 裁剪
            if (settings.trim) {
                try {
                    newDoc.trim(TrimType.TRANSPARENT);
                } catch (e) {}
            }
            
            // 关闭智能对象文档
            soDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
        
    } catch (e) {
        // 回退到普通复制方式
        try {
            if (app.activeDocument !== doc) {
                app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (e2) {}
        
        return duplicateLayerToNewDoc(layer, settings.trim);
    }
    
    return newDoc;
}

// 复制图层到新文档
function duplicateLayerToNewDoc(layer, trim) {
    var doc = app.activeDocument;
    
    var bounds = layer.bounds;
    var width = bounds[2].as("px") - bounds[0].as("px");
    var height = bounds[3].as("px") - bounds[1].as("px");
    
    if (width <= 0 || height <= 0) {
        width = doc.width.as("px");
        height = doc.height.as("px");
    }
    
    // 创建新文档
    var newDoc = app.documents.add(
        UnitValue(width, "px"),
        UnitValue(height, "px"),
        doc.resolution,
        "export_temp",
        NewDocumentMode.RGB,
        DocumentFill.TRANSPARENT
    );
    
    // 复制图层
    app.activeDocument = doc;
    var dupLayer = layer.duplicate(newDoc, ElementPlacement.PLACEATBEGINNING);
    
    // 移动位置
    app.activeDocument = newDoc;
    dupLayer.translate(
        UnitValue(-bounds[0].as("px"), "px"),
        UnitValue(-bounds[1].as("px"), "px")
    );
    
    // 删除空白层
    try {
        if (newDoc.layers.length > 1) {
            var lastLayer = newDoc.layers[newDoc.layers.length - 1];
            if (lastLayer !== dupLayer) {
                if (lastLayer.isBackgroundLayer) {
                    lastLayer.isBackgroundLayer = false;
                }
                lastLayer.remove();
            }
        }
    } catch (e) {}
    
    // 裁剪
    if (trim) {
        try {
            newDoc.trim(TrimType.TRANSPARENT);
        } catch (e) {}
    }
    
    // 合并
    newDoc.flatten();
    
    return newDoc;
}

// 保存 PNG
function savePNG(doc, path) {
    var file = new File(path);
    var opts = new PNGSaveOptions();
    opts.compression = 6;
    opts.interlaced = false;
    doc.saveAs(file, opts, true, Extension.LOWERCASE);
}

// 保存 JPG
function saveJPG(doc, path, quality) {
    var file = new File(path);
    var opts = new JPEGSaveOptions();
    opts.quality = quality;
    opts.embedColorProfile = true;
    doc.saveAs(file, opts, true, Extension.LOWERCASE);
}

function padNumber(num, len) {
    var s = num.toString();
    while (s.length < len) s = "0" + s;
    return s;
}

// ================== 报告生成 ==================

function generateReport(data) {
    var lines = [];
    
    lines.push("========================================");
    lines.push("   PSD 图层解析报告");
    lines.push("   (仅普通图层 + 智能对象)");
    lines.push("   坐标系：左上角 (0,0)");
    lines.push("========================================");
    lines.push("");
    lines.push("【文档】");
    lines.push("  文件: " + data.document.name);
    if (data.document.path) {
        lines.push("  路径: " + data.document.path);
    }
    lines.push("  尺寸: " + data.document.width + " x " + data.document.height + " px");
    lines.push("  分辨率: " + data.document.resolution + " ppi");
    lines.push("");
    lines.push("【图层列表】共 " + data.layers.length + " 个");
    lines.push("----------------------------------------");
    lines.push("");
    
    for (var i = 0; i < data.layers.length; i++) {
        var L = data.layers[i];
        
        var icon = L.type === "SmartObject" ? "[SO]" : "[L]";
        var vis = L.visible ? "[可见]" : "[隐藏]";
        
        lines.push((i + 1) + ". " + icon + " " + L.name + " " + vis);
        lines.push("   位置: X=" + L.bounds.x + ", Y=" + L.bounds.y);
        lines.push("   尺寸: " + L.bounds.width + " x " + L.bounds.height + " px");
        lines.push("   中心: (" + L.bounds.centerX + ", " + L.bounds.centerY + ")");
        lines.push("   不透明度: " + L.opacity + "%");
        
        if (L.smartObject) {
            var so = L.smartObject;
            lines.push("   --- 智能对象 " + (so.linked ? "(链接)" : "(嵌入)") + " ---");
            
            if (so.fileName) {
                lines.push("   文件名: " + so.fileName);
            }
            if (so.filePath) {
                lines.push("   路径: " + so.filePath);
            }
            if (so.originalSize) {
                lines.push("   原始尺寸: " + so.originalSize.width + " x " + so.originalSize.height);
            }
            lines.push("   缩放: X=" + so.transform.scaleX + "%, Y=" + so.transform.scaleY + "%");
            lines.push("   旋转: " + so.transform.rotation + " 度");
            
            if (so.corners) {
                lines.push("   四角坐标:");
                lines.push("     左上: (" + so.corners.topLeft.x + ", " + so.corners.topLeft.y + ")");
                lines.push("     右上: (" + so.corners.topRight.x + ", " + so.corners.topRight.y + ")");
                lines.push("     右下: (" + so.corners.bottomRight.x + ", " + so.corners.bottomRight.y + ")");
                lines.push("     左下: (" + so.corners.bottomLeft.x + ", " + so.corners.bottomLeft.y + ")");
            }
        }
        
        lines.push("");
    }
    
    return lines.join("\n");
}

// ================== 保存文件 ==================

function saveJSON(data) {
    var file = File.saveDialog("保存 JSON", "*.json");
    if (file) {
        file.encoding = "UTF-8";
        file.open("w");
        file.write(toJSON(data, "  "));
        file.close();
        alert("已保存: " + file.fsName);
    }
}

function saveTXT(report) {
    var file = File.saveDialog("保存 TXT", "*.txt");
    if (file) {
        file.encoding = "UTF-8";
        file.open("w");
        file.write(report);
        file.close();
        alert("已保存: " + file.fsName);
    }
}

function toJSON(obj, indent) {
    return _json(obj, indent || "", "");
}

function _json(val, indent, cur) {
    if (val === null || val === undefined) return "null";
    
    var t = typeof val;
    if (t === "function") return "null";
    if (val.typename !== undefined) return "null"; // 跳过PS对象
    
    if (t === "string") {
        return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
    }
    if (t === "number") return isFinite(val) ? String(val) : "null";
    if (t === "boolean") return String(val);
    
    if (val instanceof Array) {
        if (val.length === 0) return "[]";
        var arr = [], ni = cur + indent;
        for (var i = 0; i < val.length; i++) {
            arr.push(ni + _json(val[i], indent, ni));
        }
        return "[\n" + arr.join(",\n") + "\n" + cur + "]";
    }
    
    if (t === "object") {
        var props = [], ni = cur + indent;
        for (var k in val) {
            if (val.hasOwnProperty(k) && k !== "layerRef") {
                var v = _json(val[k], indent, ni);
                if (v !== "null" || val[k] === null) {
                    props.push(ni + '"' + k + '": ' + v);
                }
            }
        }
        if (props.length === 0) return "{}";
        return "{\n" + props.join(",\n") + "\n" + cur + "}";
    }
    
    return "null";
}

// 执行
main();