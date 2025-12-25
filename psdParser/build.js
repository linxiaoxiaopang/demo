// build.js
const fs = require('fs')
const path = require('path')

// ========== 配置 ==========
const ENTRY_FILE = './src/main.jsx'
const OUTPUT_FILE = './dist/bundle.jsx'

// ==========================

function bundleJSX(entryFile, outputFile) {
  if (!fs.existsSync(entryFile)) {
    console.error(`❌ 入口文件不存在: ${entryFile}`)
    process.exit(1)
  }

  const processedFiles = new Set()

  function resolveIncludes(filePath) {
    const absolutePath = path.resolve(filePath)

    if (processedFiles.has(absolutePath)) {
      return ''
    }
    processedFiles.add(absolutePath)

    if (!fs.existsSync(absolutePath)) {
      console.error(`❌ 文件不存在: ${absolutePath}`)
      return ''
    }

    console.log(`📄 处理: ${absolutePath}`)

    let content = fs.readFileSync(absolutePath, 'utf-8')

    // 移除 BOM 头
    content = content.replace(/^\uFEFF/, '')

    const baseDir = path.dirname(absolutePath)
    const includeRegex = /^#include\s+['"](.+?)['"]\s*$/gm

    content = content.replace(includeRegex, (match, includePath) => {
      const includeAbsPath = path.resolve(baseDir, includePath)
      console.log(`  📦 包含: ${includePath}`)
      return resolveIncludes(includeAbsPath)
    })

    return content + '\n'
  }

  console.log('🔧 开始打包...\n')

  let bundled = resolveIncludes(path.resolve(entryFile))

  // 保留 #target 在最顶部
  const targetMatch = bundled.match(/^#target\s+\w+\s*$/m)
  if (targetMatch) {
    bundled = bundled.replace(targetMatch[0], '')
    bundled = targetMatch[0] + '\n\n' + bundled
  }

  // 清理多余空行
  bundled = bundled.replace(/\n{3,}/g, '\n\n').trim()

  // 确保输出目录存在
  const outputDir = path.dirname(outputFile)
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // ⭐ 关键：使用 UTF-8 with BOM 编码保存
  const BOM = '\uFEFF'
  fs.writeFileSync(outputFile, BOM + bundled + '\n', { encoding: 'utf8' })

  console.log(`\n✅ 打包完成: ${outputFile}`)
  console.log(`📊 文件大小: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`)
}

bundleJSX(ENTRY_FILE, OUTPUT_FILE)
