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
