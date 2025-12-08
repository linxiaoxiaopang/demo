
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
